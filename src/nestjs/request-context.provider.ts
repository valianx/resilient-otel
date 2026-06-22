import { Injectable, Scope } from '@nestjs/common';
import { executionContext } from '../context/execution-context.js';

/**
 * RequestContext — compatibility wrapper for the core executionContext singleton.
 *
 * Provides the same API shape as the nest-template's RequestContext so existing
 * code migrating from the local folder does not need to change call sites.
 *
 * Scope.REQUEST ensures NestJS creates one instance per HTTP request, but the
 * actual context data lives in AsyncLocalStorage so all instances share the same
 * underlying store for the request's async chain.
 *
 * Ported from nest-template/observability/providers/request-context.provider.ts.
 */
@Injectable({ scope: Scope.REQUEST })
export class RequestContext {
  setContext(data: {
    headers: Record<string, unknown>;
    traceId?: string;
    spanId?: string;
    method: string;
    url: string;
  }): void {
    executionContext.update({
      contextType: 'http',
      httpMethod: data.method,
      httpUrl: data.url,
      httpHeaders: data.headers,
      traceId: data.traceId,
      spanId: data.spanId,
      userId:
        (data.headers['usrtx'] as string) ??
        (data.headers['x-usrtx'] as string),
      channel:
        (data.headers['chref'] as string) ??
        (data.headers['x-chref'] as string),
    });
  }

  getHeaders(): Record<string, unknown> {
    return executionContext.getValue('httpHeaders') ?? {};
  }

  getTraceId(): string {
    return executionContext.getValue('traceId') ?? '';
  }

  getSpanId(): string {
    return executionContext.getValue('spanId') ?? '';
  }

  getMethod(): string {
    return executionContext.getValue('httpMethod') ?? '';
  }

  getUrl(): string {
    return executionContext.getValue('httpUrl') ?? '';
  }

  getClientTraceId(): string | undefined {
    const headers = this.getHeaders();
    return (
      (headers['x-trace-id'] as string) ??
      (headers['x-b3-traceid'] as string) ??
      (headers['b3'] as string) ??
      undefined
    );
  }

  getUserTx(): string | undefined {
    const userId = executionContext.getValue('userId');
    if (userId) return userId;
    const headers = this.getHeaders();
    return (headers['usrtx'] as string) ?? (headers['x-usrtx'] as string) ?? undefined;
  }

  getChannel(): string | undefined {
    const channel = executionContext.getValue('channel');
    if (channel) return channel;
    const headers = this.getHeaders();
    return (headers['chref'] as string) ?? (headers['x-chref'] as string) ?? undefined;
  }

  getLogContext(): Record<string, unknown> {
    return {
      http_method: this.getMethod(),
      http_url: this.getUrl(),
      trace_id: this.getTraceId(),
      span_id: this.getSpanId(),
      client_trace_id: this.getClientTraceId(),
      usrtx: this.getUserTx(),
      channel: this.getChannel(),
    };
  }
}
