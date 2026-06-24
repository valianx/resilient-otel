/**
 * SerializeLogRecordProcessor — serializes complex (non-array object) log
 * attribute values to JSON strings before export.
 *
 * Position in the pipeline (NON-NEGOTIABLE):
 *   ScrubLogRecordProcessor  →  SerializeLogRecordProcessor  →  fan-out / batch
 *
 * SECURITY — MUST sit AFTER the ScrubLogRecordProcessor.
 * The scrubber recurses into nested objects and redacts denylisted keys
 * structurally (e.g. body.password → '[REDACTED]'). If serialization ran
 * first, the scrubber would receive an opaque JSON string instead of the live
 * object and would lose all structural key-based redaction, falling back to
 * less reliable regex/key=value matching only. Correct order: scrub the nested
 * object structurally, then serialize the already-scrubbed result to a string.
 *
 * WHY:
 * Elastic Cloud / Elasticsearch (and the Zippy Collector pipeline) do not index
 * nested objects in log attributes — they must be flat scalars or JSON strings.
 * This processor makes every emitLog() call Elastic-safe without requiring the
 * caller to JSON.stringify() their data objects before logging.
 *
 * IDEMPOTENT: values that are already strings (e.g. body pre-stringified by
 * LoggingMiddleware) pass through unchanged — no double-encoding.
 *
 * Ported from the proven production rule in:
 *   resilient-otel/src/nestjs/winston-transport.ts (serializeAttributes)
 *   transactions/src/observability/transports/otel-winston.transport.ts
 */

import type { LogRecordProcessor, SdkLogRecord } from '@opentelemetry/sdk-logs';
import type { Context } from '@opentelemetry/api';

/**
 * Fields that are record-level primitives (severity, timestamp, body text,
 * splat), not attribute payload — never serialize these.
 */
const SKIP_FIELDS = new Set(['level', 'message', 'msg', 'timestamp', 'splat']);

/**
 * Named set of fields that are always serialized when object-valued.
 * These are the well-known complex application-log fields.
 */
const SERIALIZE_FIELDS = new Set([
  'body',
  'headers',
  'metadata',
  'error',
  'exception',
]);

/**
 * Serialize the attributes of a log record so all nested non-array object
 * values become JSON strings. Scalars, arrays, and already-string values
 * pass through unchanged. The `signal` scalar and native trace context
 * are unaffected.
 */
function serializeAttrs(
  attrs: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(attrs)) {
    if (SKIP_FIELDS.has(key)) {
      result[key] = value;
      continue;
    }

    if (
      SERIALIZE_FIELDS.has(key) &&
      typeof value === 'object' &&
      value !== null
    ) {
      // Named field that holds an object — always stringify.
      // Guard against values that JSON.stringify cannot handle: circular
      // references (TypeError), objects containing BigInt (TypeError), or
      // objects with getters that throw. '[UNSERIALIZABLE]' is the fallback —
      // named precisely because it covers all three cases, not only cycles.
      try {
        result[key] = JSON.stringify(value);
      } catch {
        result[key] = '[UNSERIALIZABLE]';
      }
    } else if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    ) {
      // Catch-all: any remaining non-array object attribute.
      // Covers arbitrary application fields (e.g. requestCtx, user, etc.).
      try {
        result[key] = JSON.stringify(value);
      } catch {
        result[key] = '[UNSERIALIZABLE]';
      }
    } else {
      // Scalar, array, string, null — pass through unchanged.
      result[key] = value;
    }
  }

  return result;
}

/**
 * SerializeLogRecordProcessor — wraps a downstream LogRecordProcessor and
 * serializes complex attribute values to JSON strings on `onEmit`.
 *
 * Mirrors the shape of ScrubLogRecordProcessor (same SDK interface:
 * onEmit / forceFlush / shutdown, setAttributes() mutation).
 */
export class SerializeLogRecordProcessor implements LogRecordProcessor {
  constructor(private readonly downstream: LogRecordProcessor) {}

  onEmit(record: SdkLogRecord, context?: Context): void {
    if (record.attributes) {
      const serialized = serializeAttrs(
        record.attributes as Record<string, unknown>,
      );

      // Use setAttributes() when available (the SDK's own mutator, same
      // approach as ScrubLogRecordProcessor to ensure changes reach exporters).
      const mutable = record as SdkLogRecord & {
        setAttributes?: (attrs: Record<string, unknown>) => unknown;
      };

      if (typeof mutable.setAttributes === 'function') {
        mutable.setAttributes(serialized);
      } else {
        const attrs = record.attributes as Record<string, unknown>;
        for (const key of Object.keys(attrs)) delete attrs[key];
        Object.assign(attrs, serialized);
      }
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
