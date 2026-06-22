import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { context, propagation, trace } from '@opentelemetry/api';

/**
 * TraceMiddleware
 *
 * Injects W3C traceparent/tracestate headers into the outbound response
 * so downstream consumers can correlate traces.
 *
 * Ported from nest-template/observability/middlewares/trace.middleware.ts.
 */
@Injectable()
export class TraceMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction): void {
    const currentSpan = trace.getSpan(context.active());
    if (currentSpan) {
      propagation.inject(context.active(), res, {
        set: (_carrier: unknown, key: string, value: string) => {
          res.setHeader(key, value);
        },
      });
    }
    next();
  }
}
