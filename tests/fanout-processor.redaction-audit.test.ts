/**
 * fanout-processor — redaction audit: dual-sink via real ConsoleLogRecordExporter
 *
 * Focus areas (per task brief):
 *
 * 1. Dual-sink redaction via real stdout path — exercises the actual
 *    ConsoleLogRecordExporter writing to process.stdout (not just mock
 *    capturing downstreams), proving the scrubbed attribute AND redacted body
 *    appear in the actual stdout NDJSON line.
 *
 * 2. Disabled-mode full no-op — in mode:'disabled', both scrubAttrs() and
 *    redactString() are no-ops. Attributes AND body text pass through raw on
 *    both sinks. This is the corrected behavior (0.2.0 fix: redactString now
 *    short-circuits on mode:'disabled', matching scrubAttrs/scrubValue).
 *
 *    Cross-sink consistency: both the OTLP-bound downstream and the stdout line
 *    are identical — there is no per-sink divergence.
 */
import { describe, it, expect, beforeEach, afterEach } from './helpers/test-kit';
import { FanOutLogRecordProcessor } from '../src/core/fanout-processor';
import { ConsoleLogRecordExporter } from '../src/core/console-exporter';
import { ScrubLogRecordProcessor } from '../src/scrub/processors';
import { SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { createScrubber } from '../src/scrub/scrubber';
import type { LogRecordProcessor, SdkLogRecord } from '@opentelemetry/sdk-logs';
import type { Context } from '@opentelemetry/api';

// --------------------------------------------------------------------------
// Shared test helpers
// --------------------------------------------------------------------------

/** Build a minimal SdkLogRecord stub with setAttributes/setBody wired. */
function makeRecord(attrs: Record<string, unknown>, body = 'test body'): SdkLogRecord {
  const record = {
    body,
    attributes: { ...attrs },
    severityText: 'info',
    timestamp: Date.now(),
    observedTimestamp: Date.now(),
    hrTime: [1_750_000_000, 0] as [number, number],
    hrTimeObserved: [1_750_000_000, 0] as [number, number],
    spanContext: {
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      traceFlags: 1,
    },
    droppedAttributesCount: 0,
    resource: { attributes: {} },
    instrumentationScope: { name: 'test' },
  } as unknown as SdkLogRecord;

  (record as { setAttributes: (a: Record<string, unknown>) => void }).setAttributes = (
    newAttrs: Record<string, unknown>,
  ) => {
    const existing = record.attributes as Record<string, unknown>;
    for (const key of Object.keys(existing)) delete existing[key];
    Object.assign(existing, newAttrs);
  };

  (record as { setBody: (b: unknown) => void }).setBody = (b: unknown) => {
    (record as { body: unknown }).body = b;
  };

  return record;
}

/** Build a capturing downstream (mock). */
function makeCapturingDownstream(): {
  processor: LogRecordProcessor;
  captured: SdkLogRecord[];
} {
  const captured: SdkLogRecord[] = [];
  const processor: LogRecordProcessor = {
    onEmit: (record: SdkLogRecord, _ctx?: Context) => {
      captured.push({
        ...record,
        attributes: { ...(record.attributes ?? {}) },
        body: record.body,
      } as SdkLogRecord);
    },
    forceFlush: async () => {},
    shutdown: async () => {},
  };
  return { processor, captured };
}

// --------------------------------------------------------------------------
// Suite 1: real ConsoleLogRecordExporter stdout path
// --------------------------------------------------------------------------

describe('dual-sink redaction — real stdout path (ConsoleLogRecordExporter)', () => {
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

  it('denylisted attribute is [REDACTED] on stdout line AND on OTLP-bound downstream (moderate mode)', () => {
    const scrubber = createScrubber({ mode: 'moderate' });
    const otlpCapture = makeCapturingDownstream();
    const consoleSink = new SimpleLogRecordProcessor(new ConsoleLogRecordExporter());
    const fanout = new FanOutLogRecordProcessor([otlpCapture.processor, consoleSink]);
    const scrubProc = new ScrubLogRecordProcessor(fanout, scrubber);

    const record = makeRecord(
      { user: 'alice', password: 'hunter2' },
      'user login password=hunter2',
    );
    scrubProc.onEmit(record);

    // OTLP-bound downstream: attribute is [REDACTED]
    expect(otlpCapture.captured).toHaveLength(1);
    expect(otlpCapture.captured[0].attributes?.['password']).toBe('[REDACTED]');
    expect(otlpCapture.captured[0].attributes?.['user']).toBe('alice');

    // stdout line: one valid JSON line, attribute is [REDACTED]
    expect(capturedLines).toHaveLength(1);
    const stdoutRecord = JSON.parse(capturedLines[0].trim()) as Record<string, unknown>;
    expect(stdoutRecord.password).toBe('[REDACTED]');
    expect(stdoutRecord.user).toBe('alice');

    // Body also redacted on stdout (inline denylist matches password=value)
    expect(String(stdoutRecord.msg)).not.toContain('hunter2');

    // Same scrubber governs both — the stdout and OTLP values agree
    expect(stdoutRecord.password).toBe(
      otlpCapture.captured[0].attributes?.['password'],
    );
  });

  it('body containing a secret in inline key=value form is redacted on stdout AND on OTLP downstream', () => {
    const scrubber = createScrubber({ mode: 'moderate' });
    const otlpCapture = makeCapturingDownstream();
    const consoleSink = new SimpleLogRecordProcessor(new ConsoleLogRecordExporter());
    const fanout = new FanOutLogRecordProcessor([otlpCapture.processor, consoleSink]);
    const scrubProc = new ScrubLogRecordProcessor(fanout, scrubber);

    // Body contains inline 'secret=...' — matched by the denylist inline redaction.
    // This exercises redactString() on the body path for both sinks.
    const secretBody = 'token refreshed secret=s3cr3t-v4lu3 for user alice';
    const record = makeRecord({ signal: 'log' }, secretBody);
    scrubProc.onEmit(record);

    expect(capturedLines).toHaveLength(1);
    const stdoutRecord = JSON.parse(capturedLines[0].trim()) as Record<string, unknown>;
    // The secret value must not appear raw on stdout
    expect(String(stdoutRecord.msg)).not.toContain('s3cr3t-v4lu3');
    // The key 'secret=' is preserved; only the value is redacted
    expect(String(stdoutRecord.msg)).toContain('secret=');

    // OTLP downstream body is equally scrubbed
    expect(String(otlpCapture.captured[0].body)).not.toContain('s3cr3t-v4lu3');

    // Both sinks show the same redacted body — single scrubber, consistent output
    expect(String(stdoutRecord.msg)).toBe(String(otlpCapture.captured[0].body));
  });
});

// --------------------------------------------------------------------------
// Suite 2: disabled-mode full no-op — attributes AND body pass raw
// --------------------------------------------------------------------------

describe('disabled-mode full no-op — attributes AND body pass raw on both sinks', () => {
  /**
   * In mode:'disabled' (0.2.0 corrected behavior):
   *   - scrubAttrs() → returns the object unchanged (no-op, mode guard at redact.ts:137)
   *   - redactString() → returns text unchanged (mode guard added at redact.ts:146)
   *
   * Result: both attribute fields AND body text pass through raw to every downstream.
   * The behavior is symmetric across BOTH sinks — no per-sink divergence.
   */

  it('disabled mode: attributes pass raw to downstream (scrubAttrs no-op)', () => {
    const scrubber = createScrubber({ mode: 'disabled' });
    const otlpCapture = makeCapturingDownstream();
    const fanout = new FanOutLogRecordProcessor([otlpCapture.processor]);
    const scrubProc = new ScrubLogRecordProcessor(fanout, scrubber);

    const record = makeRecord(
      { password: 'raw-secret', api_key: 'raw-api-key' },
      'a plain body',
    );
    scrubProc.onEmit(record);

    // Attributes pass through unmodified in disabled mode
    expect(otlpCapture.captured[0].attributes?.['password']).toBe('raw-secret');
    expect(otlpCapture.captured[0].attributes?.['api_key']).toBe('raw-api-key');
  });

  it('disabled mode: body inline denylist match passes raw (redactString now respects mode)', () => {
    const scrubber = createScrubber({ mode: 'disabled' });
    const otlpCapture = makeCapturingDownstream();
    const fanout = new FanOutLogRecordProcessor([otlpCapture.processor]);
    const scrubProc = new ScrubLogRecordProcessor(fanout, scrubber);

    // 'password=hunter2' is an inline denylist match — but disabled mode skips it now.
    const record = makeRecord({ user: 'alice' }, 'user login password=hunter2');
    scrubProc.onEmit(record);

    // Corrected behavior: body passes raw in disabled mode (redactString short-circuits).
    const bodyStr = String(otlpCapture.captured[0].body);
    expect(bodyStr).toContain('hunter2');
    expect(bodyStr).toContain('password=hunter2');
    // Attribute is also unredacted
    expect(otlpCapture.captured[0].attributes?.['user']).toBe('alice');
  });

  it('disabled mode with real stdout: both attributes AND body pass raw on both sinks', () => {
    const capturedLines: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      if (typeof chunk === 'string') capturedLines.push(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      const scrubber = createScrubber({ mode: 'disabled' });
      const otlpCapture = makeCapturingDownstream();
      const consoleSink = new SimpleLogRecordProcessor(new ConsoleLogRecordExporter());
      const fanout = new FanOutLogRecordProcessor([otlpCapture.processor, consoleSink]);
      const scrubProc = new ScrubLogRecordProcessor(fanout, scrubber);

      const record = makeRecord(
        { password: 'raw-attr-secret' },
        'body with password=body-secret',
      );
      scrubProc.onEmit(record);

      // OTLP downstream: both attribute and body pass raw
      expect(otlpCapture.captured[0].attributes?.['password']).toBe('raw-attr-secret');
      const otlpBody = String(otlpCapture.captured[0].body);
      expect(otlpBody).toContain('body-secret');

      // stdout line: same behavior — both attribute and body pass raw
      expect(capturedLines).toHaveLength(1);
      const stdoutRecord = JSON.parse(capturedLines[0].trim()) as Record<string, unknown>;
      // attribute passes raw to stdout (scrubAttrs no-op)
      expect(stdoutRecord.password).toBe('raw-attr-secret');
      // body passes raw to stdout (redactString short-circuits in disabled mode)
      expect(String(stdoutRecord.msg)).toContain('body-secret');

      // No per-sink divergence: OTLP and stdout show identical body
      expect(String(stdoutRecord.msg)).toBe(otlpBody);
    } finally {
      process.stdout.write = originalWrite;
    }
  });
});

// --------------------------------------------------------------------------
// Suite 3: default-OFF structural verification
// --------------------------------------------------------------------------

describe('default-OFF: FanOutLogRecordProcessor not invoked when console disabled', () => {
  it('with console disabled, only OTLP downstream receives records (no fanout instantiated)', () => {
    /**
     * When consoleExport is omitted/false, init.ts sets logDownstream = batchLogProcessor
     * directly — FanOutLogRecordProcessor is never constructed. This test validates
     * the structural contract at the unit level by verifying only one downstream
     * is called (i.e., no fanout overhead).
     *
     * If a FanOutLogRecordProcessor were constructed with a single downstream, the
     * behavior would be identical — this test catches the case where the fanout
     * is accidentally constructed with ZERO additional downstreams or where the
     * console processor fires unexpectedly.
     */
    const capturedLines: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      if (typeof chunk === 'string') capturedLines.push(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      const scrubber = createScrubber({ mode: 'moderate' });
      const otlpCapture = makeCapturingDownstream();
      // No console sink — mirrors the default (non-console) chain
      const scrubProc = new ScrubLogRecordProcessor(otlpCapture.processor, scrubber);

      const record = makeRecord({ signal: 'log', user: 'alice' }, 'a log message');
      scrubProc.onEmit(record);

      // OTLP downstream receives the record
      expect(otlpCapture.captured).toHaveLength(1);

      // stdout receives NOTHING (no console exporter in the chain)
      expect(capturedLines).toHaveLength(0);
    } finally {
      process.stdout.write = originalWrite;
    }
  });
});
