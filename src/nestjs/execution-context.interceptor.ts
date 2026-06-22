import {
  Injectable,
  NestInterceptor,
  ExecutionContext as NestExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { trace, context } from '@opentelemetry/api';
import { executionContext } from '../context/execution-context.js';
import type { ExecutionCtx } from '../types/index.js';

/**
 * ExecutionContextInterceptor
 *
 * Global interceptor that populates the core AsyncLocalStorage execution context
 * for every request/RPC message. Downstream services/loggers can call
 * `executionContext.get()` to read the trace, HTTP, Kafka, or Job context.
 *
 * Ported from nest-template/observability/interceptors/execution-context.interceptor.ts.
 */
@Injectable()
export class ExecutionContextInterceptor implements NestInterceptor {
  intercept(
    nestCtx: NestExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const contextType = nestCtx.getType();
    const execCtx = this.buildContext(nestCtx, contextType);
    this.enrichWithOTel(execCtx);

    return new Observable((subscriber) => {
      executionContext
        .runAsync(execCtx, async () => {
          next.handle().subscribe({
            next: (value) => subscriber.next(value),
            error: (err: unknown) => subscriber.error(err),
            complete: () => subscriber.complete(),
          });
        })
        .catch((err: unknown) => subscriber.error(err));
    });
  }

  private buildContext(
    nestCtx: NestExecutionContext,
    contextType: string,
  ): ExecutionCtx {
    if (contextType === 'http') {
      return this.buildHttpContext(nestCtx);
    }
    if (contextType === 'rpc') {
      return this.buildRpcContext(nestCtx);
    }
    return executionContext.createContext('unknown');
  }

  private buildHttpContext(nestCtx: NestExecutionContext): ExecutionCtx {
    const req = nestCtx.switchToHttp().getRequest<{
      method?: string;
      url?: string;
      originalUrl?: string;
      headers?: Record<string, unknown>;
    }>();
    return executionContext.createContext('http', {
      httpMethod: req.method,
      httpUrl: req.url ?? req.originalUrl,
      httpHeaders: req.headers ?? {},
      userId:
        (req.headers?.['usrtx'] as string) ??
        (req.headers?.['x-usrtx'] as string),
      channel:
        (req.headers?.['chref'] as string) ??
        (req.headers?.['x-chref'] as string),
      metadata: {
        clientTraceId:
          req.headers?.['x-trace-id'] ??
          req.headers?.['x-b3-traceid'] ??
          req.headers?.['b3'],
      },
    });
  }

  private buildRpcContext(nestCtx: NestExecutionContext): ExecutionCtx {
    const rpc = nestCtx.switchToRpc();
    const rpcCtxData = rpc.getContext<Record<string, unknown>>();
    const data = rpc.getData<Record<string, unknown>>();

    if (this.isKafkaContext(rpcCtxData)) {
      return executionContext.createContext('kafka', {
        kafkaTopic: rpcCtxData['topic'] as string | undefined,
        kafkaPartition: rpcCtxData['partition'] as number | undefined,
        kafkaOffset: String(rpcCtxData['offset'] ?? ''),
        kafkaKey: data?.['key']?.toString(),
      });
    }

    return executionContext.createContext('background', {
      metadata: { rpcData: data, rpcContext: rpcCtxData },
    });
  }

  private isKafkaContext(ctx: Record<string, unknown>): boolean {
    return (
      ctx !== null &&
      ctx !== undefined &&
      ('topic' in ctx || 'partition' in ctx)
    );
  }

  private enrichWithOTel(execCtx: ExecutionCtx): void {
    const currentSpan = trace.getSpan(context.active());
    if (!currentSpan) return;
    const spanCtx = currentSpan.spanContext();
    execCtx.traceId = spanCtx.traceId;
    execCtx.spanId = spanCtx.spanId;
  }
}
