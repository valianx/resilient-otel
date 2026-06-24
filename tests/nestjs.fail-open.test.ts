/**
 * nestjs.fail-open — resilience contract (issue #4)
 *
 * Observability must NEVER crash the consuming application's request path. A
 * scrub/emit/span failure may at most drop a log line; it must never throw into
 * `use()`/`catch()`, prevent `next()`/the error response, or crash the process
 * from a deferred 'finish' listener.
 *
 * Covers:
 *   - LoggingMiddleware.use() is fail-open (failure mode #1)
 *   - LoggingMiddleware undefined-scrubber tolerance (failure mode #2)
 *   - LoggingMiddleware res.on('finish') is guarded (failure mode #3)
 *   - HttpExceptionFilter is fail-open + undefined-scrubber tolerance (#4)
 *   - forWiring() never wires an undefined scrubber (#2, defense in depth)
 */
import { EventEmitter } from 'node:events';
import { logs } from '@opentelemetry/api-logs';
import { describe, it, expect } from './helpers/test-kit';
import { LoggingMiddleware } from '../src/nestjs/logging.middleware';
import { HttpExceptionFilter } from '../src/nestjs/exception.filter';
import { ObservabilityModule } from '../src/nestjs/observability.module';
import type { Scrubber } from '../src/types/index';

// A scrubber whose scrubAttrs always throws — simulates a pathological payload
// or a buggy custom redactor. The library must swallow it, not propagate it.
const throwingScrubber = {
  redact: (s: string) => s,
  scrubAttrs: (): never => {
    throw new Error('scrub boom');
  },
} as unknown as Scrubber;

/** Build a minimal Express-like response backed by an EventEmitter. */
function fakeRes(): EventEmitter & Record<string, unknown> {
  const res = new EventEmitter() as EventEmitter & Record<string, unknown>;
  res.statusCode = 200;
  res.statusMessage = 'OK';
  res.getHeader = () => undefined;
  res.getHeaders = () => ({ 'content-type': 'application/json' });
  res.send = (b: unknown) => b;
  return res;
}

const fakeReq = {
  method: 'POST',
  originalUrl: '/pay',
  url: '/pay',
  headers: { host: 'localhost' },
  body: { amount: 100 },
} as never;

describe('LoggingMiddleware — fail-open (issue #4)', () => {
  it('use() with a throwing scrubber drops the log but still calls next()', () => {
    const mw = new LoggingMiddleware(throwingScrubber);
    const res = fakeRes();
    let nextCalled = false;
    // Must not throw into the request path.
    mw.use(fakeReq, res as never, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
  });

  it("res.on('finish') is guarded — a throwing scrubber never escapes the listener", () => {
    const mw = new LoggingMiddleware(throwingScrubber);
    const res = fakeRes();
    mw.use(fakeReq, res as never, () => {});
    // A throw here would surface as an uncaughtException; the guard prevents it.
    expect(() => res.emit('finish')).not.toThrow();
  });

  it('tolerates an undefined scrubber (constructor falls back to a real redactor)', () => {
    const mw = new LoggingMiddleware(undefined);
    const res = fakeRes();
    let nextCalled = false;
    mw.use(fakeReq, res as never, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    expect(() => res.emit('finish')).not.toThrow();
  });

  it('still emits the response log on the happy path (no regression)', () => {
    const captured: Array<Record<string, unknown>> = [];
    logs.setGlobalLoggerProvider({
      getLogger: () => ({
        emit: (record: { attributes?: Record<string, unknown> }) => {
          if (record.attributes) captured.push(record.attributes);
        },
      }),
    } as never);

    const mw = new LoggingMiddleware(undefined);
    const res = fakeRes();
    mw.use(fakeReq, res as never, () => {});
    res.emit('finish');

    expect(captured.some((a) => a.operation === 'request')).toBe(true);
    expect(captured.some((a) => a.operation === 'response')).toBe(true);
  });
});

describe('HttpExceptionFilter — fail-open (issue #4)', () => {
  function fakeHost(): {
    host: never;
    sent: { status?: number; body?: unknown };
  } {
    const sent: { status?: number; body?: unknown } = {};
    const response = {
      status(code: number) {
        sent.status = code;
        return this;
      },
      json(body: unknown) {
        sent.body = body;
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
    return { host, sent };
  }

  it('sends the error response even when the scrubber throws', () => {
    const filter = new HttpExceptionFilter(throwingScrubber);
    const { host, sent } = fakeHost();
    expect(() => filter.catch(new Error('boom'), host)).not.toThrow();
    expect(sent.status).toBe(500);
    expect(sent.body).toBeDefined();
  });

  it('tolerates an undefined scrubber and still responds', () => {
    const filter = new HttpExceptionFilter(undefined);
    const { host, sent } = fakeHost();
    expect(() => filter.catch(new Error('boom'), host)).not.toThrow();
    expect(sent.status).toBe(500);
  });
});

describe('ObservabilityModule.forWiring — never wires an undefined scrubber (issue #4)', () => {
  it('forWiring() with no scrubber falls back to a real redactor', () => {
    const mod = ObservabilityModule.forWiring({});
    // The scrubber is provided as a useValue under the internal SCRUBBER_TOKEN.
    // Find it by shape and assert it is a usable redactor, not undefined.
    const scrubberProvider = (mod.providers ?? []).find(
      (p) =>
        typeof p === 'object' &&
        p !== null &&
        'useValue' in p &&
        typeof (p as { useValue?: { scrubAttrs?: unknown } }).useValue
          ?.scrubAttrs === 'function',
    );
    expect(scrubberProvider).toBeDefined();
  });
});
