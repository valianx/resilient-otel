/**
 * scrub.processors — AC-5 of PR-2:
 * Redaction happens before export (mock exporter receives redacted content).
 */
import { describe, it, expect, mock } from 'bun:test';
import { ScrubSpanProcessor, ScrubLogRecordProcessor } from '../src/scrub/processors';
import { createScrubber } from '../src/scrub/scrubber';
import type { SpanProcessor, ReadableSpan, Span } from '@opentelemetry/sdk-trace-base';
import type { LogRecordProcessor, LogRecord } from '@opentelemetry/sdk-logs';
import type { Context } from '@opentelemetry/api';

describe('scrub.processors — redaction before export', () => {
  const scrubber = createScrubber({ mode: 'moderate' });

  describe('ScrubSpanProcessor', () => {
    it('redacts sensitive span attributes before downstream onEnd', () => {
      const capturedSpans: ReadableSpan[] = [];

      const mockDownstream: SpanProcessor = {
        onStart: () => {},
        onEnd: (span: ReadableSpan) => {
          // Capture a snapshot of attributes at the time onEnd is called
          capturedSpans.push({ ...span, attributes: { ...span.attributes } });
        },
        forceFlush: () => Promise.resolve(),
        shutdown: () => Promise.resolve(),
      };

      const processor = new ScrubSpanProcessor(mockDownstream, scrubber);

      const fakeSpan = {
        attributes: {
          'http.method': 'GET',
          password: 'super_secret',
          'db.statement': 'SELECT * FROM users',
        },
        name: 'test-span',
      } as unknown as ReadableSpan;

      processor.onEnd(fakeSpan);

      expect(capturedSpans).toHaveLength(1);
      const received = capturedSpans[0];
      // password should be redacted
      expect(received.attributes['password']).toBe('[REDACTED]');
      // Safe attributes preserved
      expect(received.attributes['http.method']).toBe('GET');
    });

    it('delegates forceFlush to downstream', async () => {
      let flushed = false;
      const downstream: SpanProcessor = {
        onStart: () => {},
        onEnd: () => {},
        forceFlush: async () => { flushed = true; },
        shutdown: () => Promise.resolve(),
      };
      const processor = new ScrubSpanProcessor(downstream, scrubber);
      await processor.forceFlush();
      expect(flushed).toBe(true);
    });

    it('delegates shutdown to downstream', async () => {
      let shut = false;
      const downstream: SpanProcessor = {
        onStart: () => {},
        onEnd: () => {},
        forceFlush: () => Promise.resolve(),
        shutdown: async () => { shut = true; },
      };
      const processor = new ScrubSpanProcessor(downstream, scrubber);
      await processor.shutdown();
      expect(shut).toBe(true);
    });
  });

  describe('ScrubLogRecordProcessor', () => {
    it('redacts sensitive log attributes before downstream onEmit', () => {
      const capturedRecords: LogRecord[] = [];

      const mockDownstream: LogRecordProcessor = {
        onEmit: (record: LogRecord, _ctx?: Context) => {
          capturedRecords.push({ ...record, attributes: { ...(record.attributes ?? {}) } });
        },
        forceFlush: () => Promise.resolve(),
        shutdown: () => Promise.resolve(),
      };

      const processor = new ScrubLogRecordProcessor(mockDownstream, scrubber);

      const fakeRecord: LogRecord = {
        body: 'User logged in with password=secret123',
        attributes: {
          user: 'alice',
          password: 'secret123',
        },
        severityNumber: 9,
        severityText: 'info',
        timestamp: Date.now(),
        observedTimestamp: Date.now(),
      } as unknown as LogRecord;

      processor.onEmit(fakeRecord);

      expect(capturedRecords).toHaveLength(1);
      const received = capturedRecords[0];
      // password attribute redacted
      expect(received.attributes!['password']).toBe('[REDACTED]');
      // safe attribute preserved
      expect(received.attributes!['user']).toBe('alice');
      // body string is also redacted
      expect(typeof received.body).toBe('string');
      expect(received.body as string).not.toContain('secret123');
    });
  });
});
