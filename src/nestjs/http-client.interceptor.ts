import { Injectable } from '@nestjs/common';
import { trace, context, SpanStatusCode } from '@opentelemetry/api';
import { emitLog } from '../logbridge/bridge.js';

type HttpService = {
  axiosRef: {
    interceptors: {
      request: {
        use(
          onFulfilled: (config: AxiosRequestConfig) => AxiosRequestConfig,
          onRejected: (error: unknown) => unknown,
        ): void;
      };
      response: {
        use(
          onFulfilled: (response: AxiosResponse) => AxiosResponse,
          onRejected: (error: unknown) => unknown,
        ): void;
      };
    };
  };
};

interface AxiosRequestConfig {
  method?: string;
  url?: string;
  headers?: Record<string, unknown>;
  data?: unknown;
}

interface AxiosResponse {
  status: number;
  statusText: string;
  config: AxiosRequestConfig;
  data?: unknown;
  headers?: Record<string, unknown>;
}

/**
 * HttpClientInterceptor
 *
 * Wires Axios request/response interceptors for automatic logging of outgoing
 * HTTP calls. Consumers call `setupInterceptors(httpService)` in `onModuleInit`.
 *
 * Ported from nest-template/observability/interceptors/http-client.interceptor.ts.
 * Uses the core log bridge instead of the Winston logger directly.
 */
@Injectable()
export class HttpClientInterceptor {
  setupInterceptors(httpService: HttpService): void {
    const axios = httpService.axiosRef;

    axios.interceptors.request.use(
      (config: AxiosRequestConfig) => {
        this.logRequest(config);
        return config;
      },
      (error: unknown) => {
        const { traceId, spanId } = this.getTraceContext();
        emitLog('error', {
          operation: 'http_client_request_error',
          msg: 'Error preparing HTTP request',
          error_message: String((error as { message?: string }).message ?? error),
          trace_id: traceId,
          span_id: spanId,
        });
        return Promise.reject(error);
      },
    );

    axios.interceptors.response.use(
      (response: AxiosResponse) => {
        this.logResponse(response);
        return response;
      },
      (error: unknown) => {
        this.logErrorResponse(error);
        return Promise.reject(error);
      },
    );
  }

  private getTraceContext(): { traceId: string; spanId: string } {
    const currentSpan = trace.getSpan(context.active());
    if (currentSpan) {
      const spanCtx = currentSpan.spanContext();
      return { traceId: spanCtx.traceId, spanId: spanCtx.spanId };
    }
    return { traceId: '', spanId: '' };
  }

  private logRequest(config: AxiosRequestConfig): void {
    const { method, url } = config;
    const tracer = trace.getTracer('resilient-otel');
    const span = tracer.startSpan(
      `HTTP Client: ${method?.toUpperCase() ?? 'UNKNOWN'} ${url}`,
      {
        attributes: {
          'http.method': method?.toUpperCase(),
          'http.url': url,
        },
      },
    );
    const spanCtx = span.spanContext();
    emitLog('info', {
      operation: 'http_client_request',
      msg: `Outgoing HTTP request: ${method?.toUpperCase()} ${url}`,
      http_method: method?.toUpperCase(),
      http_url: url,
      direction: 'outgoing',
      trace_id: spanCtx.traceId,
      span_id: spanCtx.spanId,
    });
    span.end();
  }

  private logResponse(response: AxiosResponse): void {
    const { status, statusText, config } = response;
    const { traceId, spanId } = this.getTraceContext();
    emitLog('info', {
      operation: 'http_client_response',
      msg: `HTTP response received: ${status} from ${config.method?.toUpperCase()} ${config.url}`,
      http_method: config.method?.toUpperCase(),
      http_url: config.url,
      status_code: status,
      status_text: statusText,
      direction: 'incoming',
      trace_id: traceId,
      span_id: spanId,
    });
  }

  private logErrorResponse(error: unknown): void {
    const axiosErr = error as {
      response?: { status?: number; statusText?: string };
      config?: { method?: string; url?: string };
      message?: string;
      name?: string;
    };
    const { response, config, message } = axiosErr;
    const tracer = trace.getTracer('resilient-otel');
    const span = tracer.startSpan(`HTTP Client Error: ${config?.url ?? 'unknown'}`, {
      attributes: {
        'http.method': config?.method?.toUpperCase(),
        'http.url': config?.url,
        'http.status_code': response?.status,
        'error.type': axiosErr.name ?? 'Error',
        'error.message': message,
      },
    });
    span.setStatus({ code: SpanStatusCode.ERROR, message });
    const spanCtx = span.spanContext();
    emitLog('error', {
      operation: 'http_client_error',
      msg: `HTTP request failed: ${message}`,
      http_method: config?.method?.toUpperCase(),
      http_url: config?.url,
      status_code: response?.status,
      status_text: response?.statusText,
      error_message: message,
      direction: 'error',
      trace_id: spanCtx.traceId,
      span_id: spanCtx.spanId,
    });
    span.end();
  }
}
