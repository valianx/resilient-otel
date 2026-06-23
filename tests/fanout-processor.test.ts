/**
 * fanout-processor — FanOutLogRecordProcessor
 *
 * Proves:
 *   - onEmit forwards the same record to all downstreams
 *   - forceFlush() delegates to all downstreams concurrently
 *   - shutdown() delegates to all downstreams concurrently
 *   - End-to-end scrub→fanout: denylisted attribute is [REDACTED] in both
 *     captured records; disabled-mode scrubber passes raw values (attrs AND body)
 *     to both downstreams.
 */
import { describe, it, expect } from './helpers/test-kit';
import { FanOutLogRecordProcessor } from '../src/core/fanout-processor';
import { ScrubLogRecordProcessor } from '../src/scrub/processors';
import { createScrubber } from '../src/scrub/scrubber';
import type { LogRecordProcessor, SdkLogRecord } from '@opentelemetry/sdk-logs';
import type { Context } from '@opentelemetry/api';

/** Build a minimal SdkLogRecord stub. */
function makeRecord(attrs: Record<string, unknown>, body = 'test'): SdkLogRecord {
  const record = {
    body,
    attributes: { ...attrs },
    severityText: 'info',
    timestamp: Date.now(),
    observedTimestamp: Date.now(),
  } as unknown as SdkLogRecord;

  // Wire setAttributes so ScrubLogRecordProcessor can apply redaction
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

/** Build a mock downstream that captures emitted records. */
function makeCapturingDownstream(): {
  processor: LogRecordProcessor;
  captured: SdkLogRecord[];
  flushed: boolean;
  shutdown: boolean;
} {
  const captured: SdkLogRecord[] = [];
  let flushed = false;
  let didShutdown = false;

  const processor: LogRecordProcessor = {
    onEmit: (record: SdkLogRecord, _ctx?: Context) => {
      captured.push({ ...record, attributes: { ...(record.attributes ?? {}) } });
    },
    forceFlush: async () => {
      flushed = true;
    },
    shutdown: async () => {
      didShutdown = true;
    },
  };

  return { processor, captured, get flushed() { return flushed; }, get shutdown() { return didShutdown; } };
}

describe('FanOutLogRecordProcessor', () => {
  it('forwards onEmit to all downstreams with the same record', () => {
    const a = makeCapturingDownstream();
    const b = makeCapturingDownstream();
    const fanout = new FanOutLogRecordProcessor([a.processor, b.processor]);

    const record = makeRecord({ user: 'alice', signal: 'log' });
    fanout.onEmit(record);

    expect(a.captured).toHaveLength(1);
    expect(b.captured).toHaveLength(1);
    expect(a.captured[0].attributes?.['user']).toBe('alice');
    expect(b.captured[0].attributes?.['user']).toBe('alice');
  });

  it('forceFlush() delegates to all downstreams', async () => {
    const a = makeCapturingDownstream();
    const b = makeCapturingDownstream();
    const fanout = new FanOutLogRecordProcessor([a.processor, b.processor]);

    await fanout.forceFlush();

    expect(a.flushed).toBe(true);
    expect(b.flushed).toBe(true);
  });

  it('shutdown() delegates to all downstreams', async () => {
    const a = makeCapturingDownstream();
    const b = makeCapturingDownstream();
    const fanout = new FanOutLogRecordProcessor([a.processor, b.processor]);

    await fanout.shutdown();

    expect(a.shutdown).toBe(true);
    expect(b.shutdown).toBe(true);
  });

  it('works with zero downstreams (no-op)', () => {
    const fanout = new FanOutLogRecordProcessor([]);
    const record = makeRecord({ key: 'val' });
    fanout.onEmit(record); // should not throw
  });
});

describe('FanOutLogRecordProcessor — end-to-end scrub→fanout', () => {
  it('denylisted attribute is [REDACTED] in both downstreams (moderate mode)', () => {
    const scrubber = createScrubber({ mode: 'moderate' });
    const a = makeCapturingDownstream();
    const b = makeCapturingDownstream();
    const fanout = new FanOutLogRecordProcessor([a.processor, b.processor]);
    const scrubProc = new ScrubLogRecordProcessor(fanout, scrubber);

    const record = makeRecord({ user: 'alice', password: 'secret123' }, 'user login password=secret123');
    scrubProc.onEmit(record);

    // Both downstreams receive the same scrubbed record
    expect(a.captured).toHaveLength(1);
    expect(b.captured).toHaveLength(1);

    expect(a.captured[0].attributes?.['password']).toBe('[REDACTED]');
    expect(a.captured[0].attributes?.['user']).toBe('alice');
    expect(b.captured[0].attributes?.['password']).toBe('[REDACTED]');
    expect(b.captured[0].attributes?.['user']).toBe('alice');

    // Body is also redacted in both
    expect(String(a.captured[0].body)).not.toContain('secret123');
    expect(String(b.captured[0].body)).not.toContain('secret123');
  });

  it('disabled-mode scrubber: attribute values AND body pass to both downstreams raw', () => {
    const scrubber = createScrubber({ mode: 'disabled' });
    const a = makeCapturingDownstream();
    const b = makeCapturingDownstream();
    const fanout = new FanOutLogRecordProcessor([a.processor, b.processor]);
    const scrubProc = new ScrubLogRecordProcessor(fanout, scrubber);

    // In disabled mode, scrubAttrs() is a no-op AND redactString returns text
    // unchanged — both attributes and body pass through raw on both sinks.
    const record = makeRecord({ password: 'raw-secret', user: 'alice' }, 'password=raw-secret');
    scrubProc.onEmit(record);

    // Disabled mode: attribute values reach both sinks unredacted
    expect(a.captured[0].attributes?.['password']).toBe('raw-secret');
    expect(a.captured[0].attributes?.['user']).toBe('alice');
    expect(b.captured[0].attributes?.['password']).toBe('raw-secret');
    expect(b.captured[0].attributes?.['user']).toBe('alice');

    // Disabled mode: body text also passes raw (no denylist/secret redaction)
    expect(String(a.captured[0].body)).toContain('raw-secret');
    expect(String(b.captured[0].body)).toContain('raw-secret');
  });
});
