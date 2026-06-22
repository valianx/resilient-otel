import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { trace, context } from '@opentelemetry/api';
import { normalizeRoute } from '../utils/route.js';
import { emitLog } from '../logbridge/bridge.js';
import type { Scrubber } from '../types/index.js';

const EXCLUDED_ENDPOINTS = [
  /\/health\/status$/,
  /\/health$/,
  /^\/\.well-known\/acme-challenge/,
];

/**
 * LoggingMiddleware
 *
 * Logs incoming requests and responses with scrubbed headers/body.
 * Uses core `normalizeRoute` to set the parent span name to the route pattern
 * (AC-5 of PR-3).
 *
 * Ported from nest-template/observability/middlewares/logging.middleware.ts.
 */
@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  constructor(private readonly scrubber: Scrubber) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const { method, originalUrl, headers: reqHeaders } = req;

    if (EXCLUDED_ENDPOINTS.some((re) => re.test(originalUrl))) {
      next();
      return;
    }

    const route = normalizeRoute(originalUrl);
    const parentSpan = trace.getSpan(context.active());
    if (parentSpan) {
      parentSpan.updateName(`${method} ${route}`);
      parentSpan.setAttribute('http.route', route);
    }

    const sanitizedHeaders = this.scrubber.scrubAttrs(
      reqHeaders as Record<string, unknown>,
    );

    emitLog('info', {
      operation: 'request',
      msg: `Incoming request: ${method} ${originalUrl}`,
      method,
      url: originalUrl,
      headers: JSON.stringify(sanitizedHeaders),
    });

    const originalSend = res.send.bind(res);
    let responseBody: unknown;

    res.send = (body: unknown) => {
      const contentType = res.getHeader('content-type')?.toString() ?? '';
      if (contentType.includes('application/json') && typeof body === 'string') {
        try {
          responseBody = JSON.parse(body);
        } catch {
          responseBody = body;
        }
      } else {
        responseBody = body;
      }
      return (originalSend as (body: unknown) => Response)(body);
    };

    res.on('finish', () => {
      const { statusCode, statusMessage } = res;
      const isSuccess = statusCode >= 200 && statusCode < 400;
      if (!isSuccess) return; // Errors handled by HttpExceptionFilter

      const sanitizedResponse = this.scrubber.scrubAttrs(
        (responseBody as Record<string, unknown>) ?? {},
      );

      emitLog('info', {
        operation: 'response',
        msg: `Response for: ${method} ${originalUrl}`,
        method,
        url: originalUrl,
        statusCode: String(statusCode),
        statusMessage,
        duration: String(Date.now()),
        body: JSON.stringify(sanitizedResponse),
      });
    });

    next();
  }
}
