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

// Instrumentation scope name for the per-request child span. This labels the
// emitter, not the service — the service name comes from the SDK resource.
const TRACER_NAME = 'resilient-otel/nestjs';

/** JSON.stringify that never throws (circular refs → String fallback). */
function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * LoggingMiddleware
 *
 * Logs incoming requests and successful responses with scrubbed headers/body,
 * and opens a per-request child span so downstream work is grouped under it.
 *
 * - Sets the parent (HTTP-instrumentation) span name to the normalised route
 *   pattern via `normalizeRoute`, so APM groups transactions by route.
 * - Opens an `HTTP Request: …` child span, makes it the active span for the
 *   request lifetime, records `http.status_code`/`http.status_message`, and
 *   ends it on `finish`.
 * - Logs the real elapsed `duration` (ms), response headers and response size.
 *
 * Redaction is delegated to the injected `Scrubber`. Errors are handled by
 * `HttpExceptionFilter`, so only successful responses are logged here.
 */
@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  constructor(private readonly scrubber: Scrubber) {}

  /** Scrub object-shaped values; pass primitives through unchanged. */
  private scrub(value: unknown): unknown {
    if (value && typeof value === 'object') {
      return this.scrubber.scrubAttrs(value as Record<string, unknown>);
    }
    return value;
  }

  use(req: Request, res: Response, next: NextFunction): void {
    const { method, originalUrl, headers: reqHeaders, body: reqBody } = req;
    const start = Date.now();

    if (EXCLUDED_ENDPOINTS.some((re) => re.test(originalUrl))) {
      next();
      return;
    }

    // Rename the parent span (from HTTP instrumentation) to the route pattern
    // so APM groups transactions by route (e.g. "POST /bank-accounts").
    const route = normalizeRoute(originalUrl);
    const parentSpan = trace.getSpan(context.active());
    if (parentSpan) {
      parentSpan.updateName(`${method} ${route}`);
      parentSpan.setAttribute('http.route', route);
    }

    const tracer = trace.getTracer(TRACER_NAME);
    const span = tracer.startSpan(`HTTP Request: ${method} ${originalUrl}`, {
      attributes: {
        'http.method': method,
        'http.url': originalUrl,
      },
    });

    emitLog('info', {
      operation: 'request',
      msg: `Incoming request: ${method} ${originalUrl}`,
      method,
      url: originalUrl,
      headers: safeJson(this.scrub(reqHeaders)),
      body: safeJson(this.scrub(reqBody)),
    });

    const originalSend = res.send.bind(res);
    let responseBody: unknown;

    res.send = (body: unknown) => {
      const contentType = res.getHeader('content-type')?.toString() ?? '';
      if (
        contentType.includes('application/json') &&
        typeof body === 'string'
      ) {
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

    context.with(trace.setSpan(context.active(), span), () => {
      res.on('finish', () => {
        const duration = Date.now() - start;
        const responseSize =
          res.getHeader('content-length')?.toString() ?? 'unknown';
        const { statusCode, statusMessage } = res;
        const isSuccess = statusCode >= 200 && statusCode < 400;

        span.setAttribute('http.status_code', statusCode);
        if (statusMessage) {
          span.setAttribute('http.status_message', statusMessage);
        }

        // Only log successful responses (errors go through HttpExceptionFilter).
        if (isSuccess) {
          emitLog('info', {
            operation: 'response',
            msg: `Response for: ${method} ${originalUrl}`,
            method,
            url: originalUrl,
            statusCode: String(statusCode),
            statusMessage,
            headers: safeJson(this.scrub(res.getHeaders())),
            responseSize: String(responseSize),
            duration: String(duration),
            body: safeJson(this.scrub(responseBody)),
          });
        }

        span.end();
      });

      next();
    });
  }
}
