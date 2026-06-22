import type {
  SpanProcessor,
  ReadableSpan,
  Span,
} from '@opentelemetry/sdk-trace-base';
import type { Context } from '@opentelemetry/api';
import type {
  LogRecordProcessor,
  LogRecord,
} from '@opentelemetry/sdk-logs';
import type { Scrubber } from '../types/index.js';

/**
 * ScrubSpanProcessor — wraps a downstream SpanProcessor and redacts PII/secrets
 * from span attributes on `onEnd`, before the downstream batch exporter runs.
 *
 * Implements the SDK 2.x SpanProcessor interface exactly:
 * onStart / onEnd / forceFlush / shutdown  (Research C2)
 */
export class ScrubSpanProcessor implements SpanProcessor {
  constructor(
    private readonly downstream: SpanProcessor,
    private readonly scrubber: Scrubber,
  ) {}

  onStart(span: Span, parentContext: Context): void {
    this.downstream.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    // Redact span attributes before handing to the downstream (batch) processor
    const attrs = span.attributes as Record<string, unknown>;
    const scrubbed = this.scrubber.scrubAttrs(attrs);
    // Mutate-in-place — ReadableSpan.attributes is a plain record
    for (const key of Object.keys(attrs)) {
      delete (attrs as Record<string, unknown>)[key];
    }
    Object.assign(attrs, scrubbed);
    this.downstream.onEnd(span);
  }

  forceFlush(): Promise<void> {
    return this.downstream.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.downstream.shutdown();
  }
}

/**
 * ScrubLogRecordProcessor — wraps a downstream LogRecordProcessor and redacts
 * PII/secrets from log record body + attributes on `onEmit`, before export.
 *
 * Implements the SDK 2.x LogRecordProcessor interface:
 * onEmit / forceFlush / shutdown  (Research C2)
 */
export class ScrubLogRecordProcessor implements LogRecordProcessor {
  constructor(
    private readonly downstream: LogRecordProcessor,
    private readonly scrubber: Scrubber,
  ) {}

  onEmit(record: LogRecord, context?: Context): void {
    // Redact attributes
    if (record.attributes) {
      const attrs = record.attributes as Record<string, unknown>;
      const scrubbed = this.scrubber.scrubAttrs(attrs);
      for (const key of Object.keys(attrs)) {
        delete attrs[key];
      }
      Object.assign(attrs, scrubbed);
    }

    // Redact the body if it is a string
    if (typeof record.body === 'string') {
      (record as { body: unknown }).body = this.scrubber.redact(record.body);
    }

    this.downstream.onEmit(record, context);
  }

  forceFlush(): Promise<void> {
    return this.downstream.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.downstream.shutdown();
  }
}
