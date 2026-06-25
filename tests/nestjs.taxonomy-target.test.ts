/**
 * nestjs.taxonomy-target — issue #6
 *
 * Every auto-emitted log from the NestJS integration must carry BOTH taxonomy
 * axes (`operation` + `target`) so a request and its paired response/error group
 * symmetrically with call-site logs built via `taxonomyAttrs(operation, target)`.
 *
 *   - LoggingMiddleware  → operation request/response, target client
 *   - HttpExceptionFilter → operation error,           target client
 *   - HttpClientInterceptor → operation request/response/error, target external
 *
 * Also asserts the breaking alignment landed: no `http_client_*` operations and
 * no `direction` field survive.
 */
import { EventEmitter } from 'node:events';
import { logs } from '@opentelemetry/api-logs';
import { describe, it, expect, beforeEach } from './helpers/test-kit';
import { LoggingMiddleware } from '../src/nestjs/logging.middleware';
import { HttpExceptionFilter } from '../src/nestjs/exception.filter';
import { HttpClientInterceptor } from '../src/nestjs/http-client.interceptor';
import { Operation, Target } from '../src/taxonomy/taxonomy';

let captured: Array<Record<string, unknown>>;

beforeEach(() => {
  captured = [];
  logs.setGlobalLoggerProvider({
    getLogger: () => ({
      emit: (record: { attributes?: Record<string, unknown> }) => {
        if (record.attributes) captured.push(record.attributes);
      },
    }),
  } as never);
});

/** Find the captured log whose `operation` matches. */
function byOperation(op: string): Record<string, unknown> | undefined {
  return captured.find((a) => a.operation === op);
}

describe('LoggingMiddleware — stamps target: client on request/response (issue #6)', () => {
  it('request and response logs carry operation + target', () => {
    const mw = new LoggingMiddleware(undefined);
    const req = {
      method: 'GET',
      originalUrl: '/users/42',
      headers: { host: 'localhost' },
      body: {},
    } as never;
    const res = new EventEmitter() as EventEmitter & Record<string, unknown>;
    res.statusCode = 200;
    res.statusMessage = 'OK';
    res.getHeader = () => undefined;
    res.getHeaders = () => ({ 'content-type': 'application/json' });
    res.send = (b: unknown) => b;

    mw.use(req, res as never, () => {});
    res.emit('finish');

    const request = byOperation(Operation.Request);
    const response = byOperation(Operation.Response);
    expect(request?.target).toBe(Target.Client);
    expect(response?.target).toBe(Target.Client);
  });
});

describe('HttpExceptionFilter — stamps operation error + target client (issue #6)', () => {
  it('error log carries operation: error and target: client', () => {
    const filter = new HttpExceptionFilter(undefined);
    const response = {
      status() {
        return this;
      },
      json() {
        return this;
      },
      send() {
        return this;
      },
    };
    const request = { url: '/pay', headers: { host: 'localhost' } };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    } as never;

    filter.catch(new Error('boom'), host);

    const error = byOperation(Operation.Error);
    expect(error).toBeDefined();
    expect(error?.target).toBe(Target.Client);
    // The old taxonomy value must be gone.
    expect(byOperation('exception')).toBeUndefined();
  });
});

describe('HttpClientInterceptor — stamps target: external + aligned operations (issue #6)', () => {
  function fakeHttpService(): {
    axiosRef: unknown;
    handlers: Record<string, (arg: unknown) => unknown>;
  } {
    const handlers: Record<string, (arg: unknown) => unknown> = {};
    return {
      handlers,
      axiosRef: {
        interceptors: {
          request: {
            use: (onF: (c: unknown) => unknown, onR: (e: unknown) => unknown) => {
              handlers.reqFulfilled = onF;
              handlers.reqRejected = onR;
            },
          },
          response: {
            use: (onF: (r: unknown) => unknown, onR: (e: unknown) => unknown) => {
              handlers.resFulfilled = onF;
              handlers.resRejected = onR;
            },
          },
        },
      },
    };
  }

  it('outbound request/response/error all carry target: external with aligned operations', async () => {
    const svc = fakeHttpService();
    new HttpClientInterceptor().setupInterceptors(svc as never);

    // Outbound request + successful response.
    svc.handlers.reqFulfilled({ method: 'get', url: 'https://api.ext/x', headers: {} });
    svc.handlers.resFulfilled({
      status: 200,
      statusText: 'OK',
      config: { method: 'get', url: 'https://api.ext/x' },
    });
    // Response error and request-preparation error (both reject — swallow it).
    await Promise.resolve(
      svc.handlers.resRejected({
        response: { status: 500, statusText: 'ERR' },
        config: { method: 'get', url: 'https://api.ext/x' },
        message: 'upstream down',
        name: 'AxiosError',
      }),
    ).catch(() => {});
    await Promise.resolve(svc.handlers.reqRejected(new Error('prep fail'))).catch(
      () => {},
    );

    const request = byOperation(Operation.Request);
    const response = byOperation(Operation.Response);
    const errors = captured.filter((a) => a.operation === Operation.Error);

    expect(request?.target).toBe(Target.External);
    expect(response?.target).toBe(Target.External);
    // Both the response error and the request-prep error are operation: error.
    expect(errors.length).toBe(2);
    expect(errors.every((e) => e.target === Target.External)).toBe(true);

    // Breaking alignment landed: no legacy operations, no `direction` field.
    expect(captured.some((a) => String(a.operation).startsWith('http_client_'))).toBe(
      false,
    );
    expect(captured.some((a) => 'direction' in a)).toBe(false);
  });
});
