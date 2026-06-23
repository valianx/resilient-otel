/**
 * console-exporter — attribute key collision with fixed fields
 *
 * The ConsoleLogRecordExporter builds its output record as:
 *
 *   { ...attrs, timestamp, level, msg, trace_id, span_id }
 *
 * Fixed semantic fields are spread LAST so they always win over any same-named
 * attribute. An attribute named `timestamp`, `trace_id`, etc. does not silently
 * overwrite the authoritative value derived from hrTime / spanContext.
 *
 * This test suite asserts the CORRECT collision-safe behavior: fixed fields win.
 */
import { describe, it, expect, beforeEach, afterEach } from './helpers/test-kit';
import { ConsoleLogRecordExporter } from '../src/core/console-exporter';
import type { ReadableLogRecord } from '@opentelemetry/sdk-logs';

/** Build a minimal ReadableLogRecord stub. */
function makeRecord(overrides: Partial<{
  body: unknown;
  severityText: string;
  traceId: string;
  spanId: string;
  hrTime: [number, number];
  attributes: Record<string, unknown>;
}>): ReadableLogRecord {
  return {
    body: overrides.body ?? 'original body',
    severityText: overrides.severityText ?? 'info',
    hrTime: overrides.hrTime ?? [1_750_000_000, 0],
    hrTimeObserved: overrides.hrTime ?? [1_750_000_000, 0],
    spanContext: {
      traceId: overrides.traceId ?? '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: overrides.spanId ?? '00f067aa0ba902b7',
      traceFlags: 1,
    },
    attributes: overrides.attributes ?? {},
    resource: { attributes: {} } as unknown as ReadableLogRecord['resource'],
    instrumentationScope: { name: 'test' },
    droppedAttributesCount: 0,
  } as unknown as ReadableLogRecord;
}

describe('ConsoleLogRecordExporter — fixed fields win over same-named attributes', () => {
  let exporter: ConsoleLogRecordExporter;
  const capturedLines: string[] = [];
  let originalWrite: typeof process.stdout.write;

  beforeEach(() => {
    exporter = new ConsoleLogRecordExporter();
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

  function parseOutput(): Record<string, unknown> {
    return JSON.parse(capturedLines[0].trim()) as Record<string, unknown>;
  }

  it('fixed "level" from severityText wins over an attribute named "level"', () => {
    const record = makeRecord({
      severityText: 'WARN',
      attributes: { level: 'attribute-level-should-not-win' },
    });
    exporter.export([record], () => {});
    const parsed = parseOutput();
    // Fixed field derived from severityText wins; attribute is overwritten.
    expect(parsed.level).toBe('warn');
  });

  it('fixed "msg" from record.body wins over an attribute named "msg"', () => {
    const record = makeRecord({
      body: 'the real log message',
      attributes: { msg: 'attribute-msg-should-not-win' },
    });
    exporter.export([record], () => {});
    const parsed = parseOutput();
    // Fixed field derived from body wins.
    expect(parsed.msg).toBe('the real log message');
  });

  it('fixed "timestamp" from hrTime wins over an attribute named "timestamp"', () => {
    const record = makeRecord({
      hrTime: [1_750_000_000, 0],
      attributes: { timestamp: 'attribute-timestamp-should-not-win' },
    });
    exporter.export([record], () => {});
    const parsed = parseOutput();
    // Fixed field derived from hrTime wins; attribute is overwritten.
    expect(parsed.timestamp).toBe(new Date(1_750_000_000_000).toISOString());
  });

  it('fixed "trace_id" from spanContext wins over an attribute named "trace_id"', () => {
    const record = makeRecord({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      attributes: { trace_id: 'attribute-trace-id-should-not-win' },
    });
    exporter.export([record], () => {});
    const parsed = parseOutput();
    // Authoritative trace correlation field from spanContext wins.
    expect(parsed.trace_id).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });

  it('fixed "span_id" from spanContext wins over an attribute named "span_id"', () => {
    const record = makeRecord({
      spanId: '00f067aa0ba902b7',
      attributes: { span_id: 'attribute-span-id-should-not-win' },
    });
    exporter.export([record], () => {});
    const parsed = parseOutput();
    // Authoritative span correlation field from spanContext wins.
    expect(parsed.span_id).toBe('00f067aa0ba902b7');
  });

  it('non-colliding attributes are unaffected and appear in output', () => {
    const record = makeRecord({
      attributes: {
        signal: 'log',
        execution_id: 'exec-001',
        http_method: 'POST',
      },
    });
    exporter.export([record], () => {});
    const parsed = parseOutput();

    // Non-colliding attributes pass through cleanly (expected behavior).
    expect(parsed.signal).toBe('log');
    expect(parsed.execution_id).toBe('exec-001');
    expect(parsed.http_method).toBe('POST');
    // Fixed fields are still present when not overridden
    expect(typeof parsed.timestamp).toBe('string');
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('original body');
  });

  it('all five fixed fields win simultaneously when all are present as attributes', () => {
    const record = makeRecord({
      severityText: 'ERROR',
      body: 'real body text',
      hrTime: [1_750_000_000, 0],
      traceId: 'realtraceididididididididididid00',
      spanId: 'realspan00000000',
      attributes: {
        timestamp: 'attr-ts',
        level: 'attr-level',
        msg: 'attr-msg',
        trace_id: 'attr-trace',
        span_id: 'attr-span',
        signal: 'log',
      },
    });
    exporter.export([record], () => {});
    const parsed = parseOutput();
    // Every fixed field wins
    expect(parsed.timestamp).toBe(new Date(1_750_000_000_000).toISOString());
    expect(parsed.level).toBe('error');
    expect(parsed.msg).toBe('real body text');
    expect(parsed.trace_id).toBe('realtraceididididididididididid00');
    expect(parsed.span_id).toBe('realspan00000000');
    // Non-colliding attribute still present
    expect(parsed.signal).toBe('log');
  });
});
