import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { trace, SpanStatusCode, context } from '@opentelemetry/api';
import { emitLog } from '../logbridge/bridge.js';
import type { Scrubber } from '../types/index.js';

const EXCLUDED_ENDPOINTS = [
  /\/health\/status$/,
  /^\/\.well-known\/acme-challenge/,
];

/**
 * HttpExceptionFilter
 *
 * Catches all exceptions, logs them with scrubbed headers, records the error
 * on the active OTel span, and returns a structured JSON response.
 *
 * Ported from nest-template/observability/middlewares/exception.filter.ts.
 */
@Catch()
@Injectable()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly scrubber: Scrubber) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (EXCLUDED_ENDPOINTS.some((re) => re.test(request.url))) {
      response.status(HttpStatus.NOT_FOUND).send();
      return;
    }

    const sanitizedHeaders = this.scrubber.scrubAttrs(
      request.headers as Record<string, unknown>,
    );

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message =
      exception instanceof HttpException
        ? exception.message
        : ((exception as { message?: string }).message ?? 'Internal server error');

    const bodyResponse =
      exception instanceof HttpException
        ? exception.getResponse()
        : message;

    emitLog('error', {
      operation: 'exception',
      headers: JSON.stringify(sanitizedHeaders),
      statusCode: status,
      url: request.url,
      msg: message,
      body: typeof bodyResponse === 'object'
        ? JSON.stringify(bodyResponse)
        : String(bodyResponse),
      ...(exception instanceof Error ? { stack: exception.stack } : {}),
    });

    const span = trace.getSpan(context.active());
    if (span) {
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      span.setAttribute('http.status_code', status);
      span.setAttribute('error.message', message);
      if (exception instanceof Error && exception.stack) {
        span.setAttribute('error.stack', exception.stack);
      }
    }

    response.status(status).json(bodyResponse);
  }
}
