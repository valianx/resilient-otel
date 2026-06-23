/**
 * console-exporter — ConsoleLogRecordExporter
 *
 * Proves:
 *   - Single-line valid JSON per record written to stdout
 *   - Field mapping: timestamp (ISO), level, msg, trace_id, span_id, attrs
 *   - export() calls resultCallback with SUCCESS
 *   - shutdown() / forceFlush() resolve immediately
 */
import { describe, it, expect, beforeEach, afterEach } from './helpers/test-kit';
import { ConsoleLogRecordExporter } from '../src/core/console-exporter';
import { ExportResultCode } from '@opentelemetry/core';
import type { ReadableLogRecord } from '@opentelemetry/sdk-logs';

/** Build a minimal ReadableLogRecord stub for testing. */
function makeRecord(overrides: Partial<{
  body: unknown;
  severityText: string;
  traceId: string;
  spanId: string;
  hrTime: [number, number];
  attributes: Record<string, unknown>;
}>): ReadableLogRecord {
  return {
    body: overrides.body ?? 'test message',
    severityText: overrides.severityText ?? 'info',
    hrTime: overrides.hrTime ?? [1_750_000_000, 123_000_000],
    hrTimeObserved: overrides.hrTime ?? [1_750_000_000, 123_000_000],
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

describe('ConsoleLogRecordExporter', () => {
  let exporter: ConsoleLogRecordExporter;
  const capturedLines: string[] = [];
  let originalWrite: typeof process.stdout.write;

  beforeEach(() => {
    exporter = new ConsoleLogRecordExporter();
    capturedLines.length = 0;
    originalWrite = process.stdout.write.bind(process.stdout);
    // Stub process.stdout.write to capture output
    process.stdout.write = ((chunk: string | Uint8Array) => {
      if (typeof chunk === 'string') capturedLines.push(chunk);
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
  });

  it('writes one line per record with valid JSON', () => {
    const record = makeRecord({});
    const cb = (result: { code: number }) => {
      expect(result.code).toBe(ExportResultCode.SUCCESS);
    };
    exporter.export([record], cb);

    expect(capturedLines).toHaveLength(1);
    const line = capturedLines[0].trim();
    expect(line).toBeDefined();
    // Must be valid JSON
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(typeof parsed).toBe('object');
  });

  it('maps timestamp to ISO-8601 from hrTime', () => {
    // hrTime [1750000000, 500_000_000] = 2025-06-15T18:13:20.500Z
    const record = makeRecord({ hrTime: [1_750_000_000, 500_000_000] });
    exporter.export([record], () => {});
    const parsed = JSON.parse(capturedLines[0].trim()) as Record<string, unknown>;
    // epoch ms = 1750000000 * 1000 + 500 = 1750000000500
    expect(parsed.timestamp).toBe(new Date(1_750_000_000_500).toISOString());
  });

  it('maps level from severityText (lowercased)', () => {
    const record = makeRecord({ severityText: 'WARN' });
    exporter.export([record], () => {});
    const parsed = JSON.parse(capturedLines[0].trim()) as Record<string, unknown>;
    expect(parsed.level).toBe('warn');
  });

  it('maps msg from body', () => {
    const record = makeRecord({ body: 'hello world' });
    exporter.export([record], () => {});
    const parsed = JSON.parse(capturedLines[0].trim()) as Record<string, unknown>;
    expect(parsed.msg).toBe('hello world');
  });

  it('maps trace_id and span_id from spanContext', () => {
    const record = makeRecord({
      traceId: 'abcdef1234567890abcdef1234567890',
      spanId: '1234567890abcdef',
    });
    exporter.export([record], () => {});
    const parsed = JSON.parse(capturedLines[0].trim()) as Record<string, unknown>;
    expect(parsed.trace_id).toBe('abcdef1234567890abcdef1234567890');
    expect(parsed.span_id).toBe('1234567890abcdef');
  });

  it('flattens attributes into the output object', () => {
    const record = makeRecord({
      attributes: {
        signal: 'log',
        execution_id: 'exec-001',
        http_method: 'POST',
        user: 'alice',
      },
    });
    exporter.export([record], () => {});
    const parsed = JSON.parse(capturedLines[0].trim()) as Record<string, unknown>;
    expect(parsed.signal).toBe('log');
    expect(parsed.execution_id).toBe('exec-001');
    expect(parsed.http_method).toBe('POST');
    expect(parsed.user).toBe('alice');
  });

  it('produces a single line (no newlines within the JSON body)', () => {
    const record = makeRecord({ body: 'line\nbreak' });
    exporter.export([record], () => {});
    // The line itself ends with \n but the JSON content has no bare newlines
    const jsonPart = capturedLines[0].slice(0, -1); // strip trailing \n
    expect(jsonPart.includes('\n')).toBe(false);
  });

  it('calls resultCallback with ExportResultCode.SUCCESS', () => {
    let callCount = 0;
    let receivedCode: number | undefined;
    exporter.export([makeRecord({})], (result: { code: number }) => {
      callCount++;
      receivedCode = result.code;
    });
    expect(callCount).toBe(1);
    expect(receivedCode).toBe(ExportResultCode.SUCCESS);
  });

  it('writes nothing and still calls callback when records is empty', () => {
    let called = false;
    exporter.export([], (result: { code: number }) => {
      called = true;
      expect(result.code).toBe(ExportResultCode.SUCCESS);
    });
    expect(capturedLines).toHaveLength(0);
    expect(called).toBe(true);
  });

  it('shutdown() resolves immediately', async () => {
    await expect(exporter.shutdown()).resolves.toBeUndefined();
  });

  it('forceFlush() resolves immediately', async () => {
    await expect(exporter.forceFlush()).resolves.toBeUndefined();
  });

  it('emits empty strings for trace_id/span_id when spanContext is absent', () => {
    const record = {
      ...makeRecord({}),
      spanContext: undefined,
    } as unknown as ReadableLogRecord;
    exporter.export([record], () => {});
    const parsed = JSON.parse(capturedLines[0].trim()) as Record<string, unknown>;
    expect(parsed.trace_id).toBe('');
    expect(parsed.span_id).toBe('');
  });
});
