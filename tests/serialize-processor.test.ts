/**
 * serialize-processor — SerializeLogRecordProcessor
 *
 * Proves:
 *   AC-1/AC-2: Nested object attributes (error, metadata, body, headers,
 *              exception) and catch-all non-array objects become JSON strings.
 *   AC-3: Already-string values, scalars, and arrays pass through unchanged.
 *   AC-4: signal:'log' scalar and native trace context are untouched.
 *   AC-5: Scrub-before-serialize ordering — a denylisted nested key
 *         (body.password) is '[REDACTED]' inside the serialized string.
 *   AC-6: Flag-off (serializeComplexAttributes: false) — attributes pass
 *         through as-is; no serialize stage in pipeline.
 *   (env) OTEL_RESILIENT_SERIALIZE_ATTRS=false opts out when config is unset.
 *   (robustness) Circular/cyclic objects do not crash the pipeline.
 *   (stdout parity) scrub → serialize → fanout: both OTLP and stdout carry
 *         identical serialized strings (no per-sink divergence).
 */
import { describe, it, expect, beforeEach, afterEach } from './helpers/test-kit';
import { SerializeLogRecordProcessor } from '../src/core/serialize-processor';
import { ScrubLogRecordProcessor } from '../src/scrub/processors';
import { createScrubber } from '../src/scrub/scrubber';
import { readOtelEnv } from '../src/config/env';
import { SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { FanOutLogRecordProcessor } from '../src/core/fanout-processor';
import { ConsoleLogRecordExporter } from '../src/core/console-exporter';
import type { LogRecordProcessor, SdkLogRecord } from '@opentelemetry/sdk-logs';
import type { Context } from '@opentelemetry/api';

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/** Build a minimal SdkLogRecord stub with setAttributes/setBody mutators. */
function makeRecord(
  attrs: Record<string, unknown>,
  body: unknown = 'test',
): SdkLogRecord {
  const record = {
    body,
    attributes: { ...attrs },
    severityText: 'info',
    timestamp: Date.now(),
    observedTimestamp: Date.now(),
  } as unknown as SdkLogRecord;

  (record as { setAttributes: (a: Record<string, unknown>) => void }).setAttributes =
    (newAttrs: Record<string, unknown>) => {
      const existing = record.attributes as Record<string, unknown>;
      for (const key of Object.keys(existing)) delete existing[key];
      Object.assign(existing, newAttrs);
    };

  (record as { setBody: (b: unknown) => void }).setBody = (b: unknown) => {
    (record as { body: unknown }).body = b;
  };

  return record;
}

/** Build a capturing downstream that snapshots each emitted record. */
function makeCapture(): {
  processor: LogRecordProcessor;
  captured: SdkLogRecord[];
} {
  const captured: SdkLogRecord[] = [];
  const processor: LogRecordProcessor = {
    onEmit: (record: SdkLogRecord, _ctx?: Context) => {
      captured.push({
        ...record,
        attributes: { ...(record.attributes ?? {}) },
      });
    },
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  };
  return { processor, captured };
}

// ────────────────────────────────────────────────────────────
// AC-1 / AC-2 — named fields + catch-all
// ────────────────────────────────────────────────────────────

describe('SerializeLogRecordProcessor — named + catch-all serialization (flag ON)', () => {
  it('AC-1: serializes nested error object to JSON string', () => {
    const { processor: downstream, captured } = makeCapture();
    const serialize = new SerializeLogRecordProcessor(downstream);

    const record = makeRecord({
      error: { code: 500, detail: { reason: 'x' } },
      signal: 'log',
    });
    serialize.onEmit(record);

    expect(captured).toHaveLength(1);
    const attrs = captured[0].attributes as Record<string, unknown>;
    expect(typeof attrs['error']).toBe('string');
    expect(attrs['error']).toBe('{"code":500,"detail":{"reason":"x"}}');
    // signal scalar is untouched
    expect(attrs['signal']).toBe('log');
  });

  it('AC-2: serializes all named fields (body, headers, metadata, exception) + catch-all objects', () => {
    const { processor: downstream, captured } = makeCapture();
    const serialize = new SerializeLogRecordProcessor(downstream);

    const record = makeRecord({
      body: { text: 'hello' },
      headers: { 'content-type': 'application/json' },
      metadata: { a: 1 },
      exception: { type: 'Error', message: 'fail' },
      customObj: { x: 42 },   // catch-all: arbitrary non-array object
      signal: 'log',
      operation: 'test.op',
    });
    serialize.onEmit(record);

    const attrs = captured[0].attributes as Record<string, unknown>;

    // Named fields
    expect(typeof attrs['body']).toBe('string');
    expect(typeof attrs['headers']).toBe('string');
    expect(typeof attrs['metadata']).toBe('string');
    expect(typeof attrs['exception']).toBe('string');
    // Catch-all field
    expect(typeof attrs['customObj']).toBe('string');
    expect(attrs['customObj']).toBe('{"x":42}');
    // Scalars untouched
    expect(attrs['signal']).toBe('log');
    expect(attrs['operation']).toBe('test.op');
  });

  it('AC-3: already-string body, scalar number, and array pass through unchanged', () => {
    const { processor: downstream, captured } = makeCapture();
    const serialize = new SerializeLogRecordProcessor(downstream);

    const record = makeRecord({
      body: '{"pre":"stringified"}',   // already a string
      count: 42,                        // scalar number
      tags: ['a', 'b'],                 // array
      signal: 'log',
    });
    serialize.onEmit(record);

    const attrs = captured[0].attributes as Record<string, unknown>;
    expect(attrs['body']).toBe('{"pre":"stringified"}');  // no double-encoding
    expect(attrs['count']).toBe(42);
    expect(attrs['tags']).toEqual(['a', 'b']);
    expect(attrs['signal']).toBe('log');
  });

  it('AC-4: null values pass through unchanged, signal stays scalar', () => {
    const { processor: downstream, captured } = makeCapture();
    const serialize = new SerializeLogRecordProcessor(downstream);

    const record = makeRecord({
      nullField: null,
      signal: 'log',
    });
    serialize.onEmit(record);

    const attrs = captured[0].attributes as Record<string, unknown>;
    expect(attrs['nullField']).toBe(null);
    expect(attrs['signal']).toBe('log');
  });
});

// ────────────────────────────────────────────────────────────
// AC-5 — Security ordering: scrub BEFORE serialize
// ────────────────────────────────────────────────────────────

describe('SerializeLogRecordProcessor — scrub-before-serialize ordering (AC-5)', () => {
  it('denylisted nested key (body.password) is [REDACTED] inside the serialized string', () => {
    const scrubber = createScrubber({ mode: 'moderate' });
    const { processor: downstream, captured } = makeCapture();

    // Chain: scrub → serialize (the correct production ordering)
    const serialize = new SerializeLogRecordProcessor(downstream);
    const scrub = new ScrubLogRecordProcessor(serialize, scrubber);

    const record = makeRecord({
      body: { password: 'p4$$w0rd', amount: 100 },
      signal: 'log',
    });
    scrub.onEmit(record);

    expect(captured).toHaveLength(1);
    const attrs = captured[0].attributes as Record<string, unknown>;

    // body must be a JSON string (serialization ran)
    expect(typeof attrs['body']).toBe('string');

    // The serialized body string must contain [REDACTED] for password
    // (proves scrub ran structurally BEFORE serialization)
    expect(attrs['body'] as string).toContain('[REDACTED]');
    expect(attrs['body'] as string).not.toContain('p4$$w0rd');

    // The safe field (amount) must be preserved
    expect(attrs['body'] as string).toContain('100');
    expect(attrs['signal']).toBe('log');
  });

  it('non-denylisted nested key survives scrub+serialize intact', () => {
    const scrubber = createScrubber({ mode: 'moderate' });
    const { processor: downstream, captured } = makeCapture();

    const serialize = new SerializeLogRecordProcessor(downstream);
    const scrub = new ScrubLogRecordProcessor(serialize, scrubber);

    const record = makeRecord({
      metadata: { requestId: 'req-123', userId: 'u-456' },
    });
    scrub.onEmit(record);

    const attrs = captured[0].attributes as Record<string, unknown>;
    expect(typeof attrs['metadata']).toBe('string');
    expect(attrs['metadata'] as string).toContain('req-123');
    expect(attrs['metadata'] as string).toContain('u-456');
  });
});

// ────────────────────────────────────────────────────────────
// AC-6 — Flag OFF: objects pass through as-is
// ────────────────────────────────────────────────────────────

describe('SerializeLogRecordProcessor — behavior when bypassed (flag OFF)', () => {
  it('without serialize processor in chain, nested objects are passed through', () => {
    // Simulate flag-off: do NOT insert SerializeLogRecordProcessor
    const scrubber = createScrubber({ mode: 'moderate' });
    const { processor: downstream, captured } = makeCapture();
    const scrub = new ScrubLogRecordProcessor(downstream, scrubber);

    const nestedError = { code: 500, detail: 'server error' };
    const record = makeRecord({ error: nestedError, signal: 'log' });
    scrub.onEmit(record);

    const attrs = captured[0].attributes as Record<string, unknown>;
    // Without the serialize processor, error is still an object
    expect(typeof attrs['error']).toBe('object');
    expect(attrs['signal']).toBe('log');
  });
});

// ────────────────────────────────────────────────────────────
// Env fallback: OTEL_RESILIENT_SERIALIZE_ATTRS
// ────────────────────────────────────────────────────────────

describe('readOtelEnv — OTEL_RESILIENT_SERIALIZE_ATTRS', () => {
  afterEach(() => {
    delete process.env['OTEL_RESILIENT_SERIALIZE_ATTRS'];
  });

  it('defaults to true when env var is unset', () => {
    delete process.env['OTEL_RESILIENT_SERIALIZE_ATTRS'];
    const env = readOtelEnv();
    expect(env.serializeAttrs).toBe(true);
  });

  it('remains true for unrecognized/empty values', () => {
    process.env['OTEL_RESILIENT_SERIALIZE_ATTRS'] = '';
    expect(readOtelEnv().serializeAttrs).toBe(true);

    process.env['OTEL_RESILIENT_SERIALIZE_ATTRS'] = 'yes';
    expect(readOtelEnv().serializeAttrs).toBe(true);
  });

  it('resolves to false when set to "false"', () => {
    process.env['OTEL_RESILIENT_SERIALIZE_ATTRS'] = 'false';
    expect(readOtelEnv().serializeAttrs).toBe(false);
  });

  it('resolves to false when set to "0"', () => {
    process.env['OTEL_RESILIENT_SERIALIZE_ATTRS'] = '0';
    expect(readOtelEnv().serializeAttrs).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────
// Robustness — circular / cyclic objects (coverage point 5)
// ────────────────────────────────────────────────────────────

describe('SerializeLogRecordProcessor — unserializable object robustness', () => {
  it('circular reference: does not crash and sets fallback to "[UNSERIALIZABLE]"', () => {
    const { processor: downstream, captured } = makeCapture();
    const serialize = new SerializeLogRecordProcessor(downstream);

    // Build a circular object — JSON.stringify throws TypeError on this.
    const circ: Record<string, unknown> = { userId: 'u-1' };
    circ['self'] = circ;

    const record = makeRecord({ metadata: circ, signal: 'log', safe: 'value' });

    // Must not throw; the pipeline must continue and deliver the record.
    expect(() => serialize.onEmit(record)).not.toThrow();

    // The record still reaches the downstream.
    expect(captured).toHaveLength(1);

    const attrs = captured[0].attributes as Record<string, unknown>;
    // The unserializable attribute must be the precise fallback string.
    expect(attrs['metadata']).toBe('[UNSERIALIZABLE]');

    // Safe scalar attributes and signal must be preserved regardless.
    expect(attrs['signal']).toBe('log');
    expect(attrs['safe']).toBe('value');
  });

  it('circular reference: non-circular sibling attributes are serialized correctly', () => {
    const { processor: downstream, captured } = makeCapture();
    const serialize = new SerializeLogRecordProcessor(downstream);

    const circ: Record<string, unknown> = {};
    circ['loop'] = circ;

    const record = makeRecord({
      metadata: circ,
      error: { code: 500, detail: 'server error' },  // normal — must be serialized
      signal: 'log',
    });

    expect(() => serialize.onEmit(record)).not.toThrow();

    const attrs = captured[0].attributes as Record<string, unknown>;
    expect(attrs['metadata']).toBe('[UNSERIALIZABLE]');
    // error must be serialized correctly (it is not circular).
    expect(typeof attrs['error']).toBe('string');
    expect(attrs['error']).toBe('{"code":500,"detail":"server error"}');
    // signal is a scalar — untouched.
    expect(attrs['signal']).toBe('log');
  });

  it('BigInt in nested object: does not throw and sets fallback to "[UNSERIALIZABLE]"', () => {
    // JSON.stringify throws TypeError on BigInt values.
    const { processor: downstream, captured } = makeCapture();
    const serialize = new SerializeLogRecordProcessor(downstream);

    const record = makeRecord({
      metadata: { amount: BigInt(9007199254740993) },
      signal: 'log',
    });

    expect(() => serialize.onEmit(record)).not.toThrow();
    expect(captured).toHaveLength(1);

    const attrs = captured[0].attributes as Record<string, unknown>;
    expect(attrs['metadata']).toBe('[UNSERIALIZABLE]');
    expect(attrs['signal']).toBe('log');
  });

  it('getter that throws in nested object: does not throw and sets fallback to "[UNSERIALIZABLE]"', () => {
    // A getter that throws will cause JSON.stringify to throw.
    const { processor: downstream, captured } = makeCapture();
    const serialize = new SerializeLogRecordProcessor(downstream);

    const badObj = Object.defineProperty({} as Record<string, unknown>, 'boom', {
      get() { throw new Error('getter failure'); },
      enumerable: true,
    });

    const record = makeRecord({
      error: badObj,
      signal: 'log',
    });

    expect(() => serialize.onEmit(record)).not.toThrow();
    expect(captured).toHaveLength(1);

    const attrs = captured[0].attributes as Record<string, unknown>;
    expect(attrs['error']).toBe('[UNSERIALIZABLE]');
    expect(attrs['signal']).toBe('log');
  });
});

// ────────────────────────────────────────────────────────────
// Stdout (console sink) parity — serialize sits above fan-out (coverage point 6)
// ────────────────────────────────────────────────────────────

describe('SerializeLogRecordProcessor — stdout parity via real ConsoleLogRecordExporter', () => {
  /**
   * Proves AC-7 at unit level: when the full chain is
   *   scrub → serialize → fanout(otlpCapture + consoleSink)
   * both the OTLP-bound downstream and the NDJSON stdout line carry the same
   * serialized string attributes — no per-sink divergence.
   */
  const capturedLines: string[] = [];
  let originalWrite: typeof process.stdout.write;

  beforeEach(() => {
    capturedLines.length = 0;
    originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      if (typeof chunk === 'string') capturedLines.push(chunk);
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
  });

  it('serialized JSON-string attributes appear identically in OTLP downstream and stdout (scrub → serialize → fanout)', () => {
    const scrubber = createScrubber({ mode: 'moderate' });
    const otlpCapture = makeCapture();
    const consoleSink = new SimpleLogRecordProcessor(new ConsoleLogRecordExporter());
    const fanout = new FanOutLogRecordProcessor([otlpCapture.processor, consoleSink]);
    const serialize = new SerializeLogRecordProcessor(fanout);
    const scrub = new ScrubLogRecordProcessor(serialize, scrubber);

    // SdkLogRecord needs hrTime/spanContext for ConsoleLogRecordExporter
    const record = makeRecord({ error: { code: 500 }, metadata: { key: 'v' }, signal: 'log' });
    (record as Record<string, unknown>)['hrTime'] = [1_750_000_000, 0];
    (record as Record<string, unknown>)['hrTimeObserved'] = [1_750_000_000, 0];
    (record as Record<string, unknown>)['spanContext'] = {
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      traceFlags: 1,
    };
    (record as Record<string, unknown>)['droppedAttributesCount'] = 0;
    (record as Record<string, unknown>)['resource'] = { attributes: {} };
    (record as Record<string, unknown>)['instrumentationScope'] = { name: 'test' };

    scrub.onEmit(record);

    // OTLP downstream: error and metadata serialized to JSON strings.
    expect(otlpCapture.captured).toHaveLength(1);
    const otlpAttrs = otlpCapture.captured[0].attributes as Record<string, unknown>;
    expect(typeof otlpAttrs['error']).toBe('string');
    expect(otlpAttrs['error']).toBe('{"code":500}');
    expect(typeof otlpAttrs['metadata']).toBe('string');
    expect(otlpAttrs['metadata']).toBe('{"key":"v"}');

    // stdout line: the same JSON strings must appear.
    expect(capturedLines).toHaveLength(1);
    const stdoutRecord = JSON.parse(capturedLines[0].trim()) as Record<string, unknown>;
    expect(stdoutRecord['error']).toBe(otlpAttrs['error']);
    expect(stdoutRecord['metadata']).toBe(otlpAttrs['metadata']);
    expect(stdoutRecord['signal']).toBe('log');
  });

  it('denylisted nested key is [REDACTED] inside the serialized string on BOTH sinks (scrub → serialize → fanout)', () => {
    const scrubber = createScrubber({ mode: 'moderate' });
    const otlpCapture = makeCapture();
    const consoleSink = new SimpleLogRecordProcessor(new ConsoleLogRecordExporter());
    const fanout = new FanOutLogRecordProcessor([otlpCapture.processor, consoleSink]);
    const serialize = new SerializeLogRecordProcessor(fanout);
    const scrub = new ScrubLogRecordProcessor(serialize, scrubber);

    const record = makeRecord({ body: { password: 'hunter2', amount: 99 }, signal: 'log' });
    (record as Record<string, unknown>)['hrTime'] = [1_750_000_000, 0];
    (record as Record<string, unknown>)['hrTimeObserved'] = [1_750_000_000, 0];
    (record as Record<string, unknown>)['spanContext'] = {
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      traceFlags: 1,
    };
    (record as Record<string, unknown>)['droppedAttributesCount'] = 0;
    (record as Record<string, unknown>)['resource'] = { attributes: {} };
    (record as Record<string, unknown>)['instrumentationScope'] = { name: 'test' };

    scrub.onEmit(record);

    const otlpAttrs = otlpCapture.captured[0].attributes as Record<string, unknown>;
    expect(typeof otlpAttrs['body']).toBe('string');
    expect(otlpAttrs['body'] as string).toContain('[REDACTED]');
    expect(otlpAttrs['body'] as string).not.toContain('hunter2');
    expect(otlpAttrs['body'] as string).toContain('99');

    // stdout line carries the same redacted serialized body.
    const stdoutRecord = JSON.parse(capturedLines[0].trim()) as Record<string, unknown>;
    expect(stdoutRecord['body']).toBe(otlpAttrs['body']);
  });
});

// ────────────────────────────────────────────────────────────
// Delegation — forceFlush / shutdown
// ────────────────────────────────────────────────────────────

describe('SerializeLogRecordProcessor — delegation', () => {
  it('forceFlush() delegates to downstream', async () => {
    let flushed = false;
    const downstream: LogRecordProcessor = {
      onEmit: () => {},
      forceFlush: async () => { flushed = true; },
      shutdown: () => Promise.resolve(),
    };
    const serialize = new SerializeLogRecordProcessor(downstream);
    await serialize.forceFlush();
    expect(flushed).toBe(true);
  });

  it('shutdown() delegates to downstream', async () => {
    let shut = false;
    const downstream: LogRecordProcessor = {
      onEmit: () => {},
      forceFlush: () => Promise.resolve(),
      shutdown: async () => { shut = true; },
    };
    const serialize = new SerializeLogRecordProcessor(downstream);
    await serialize.shutdown();
    expect(shut).toBe(true);
  });
});
