/**
 * ConsoleLogRecordExporter — single-line NDJSON stdout exporter.
 *
 * Emits one JSON object per record to process.stdout so each log is a single
 * parseable line for k8s log scrapers. This is intentionally NOT the OTEL
 * built-in ConsoleLogRecordExporter (which uses util.inspect and emits
 * multi-line output that breaks structured log aggregators).
 *
 * Security: this exporter MUST sit behind ScrubLogRecordProcessor (via the
 * FanOutLogRecordProcessor). It has no denylist of its own; it relies entirely
 * on the upstream scrub stage having already redacted sensitive fields.
 */
import { ExportResultCode } from '@opentelemetry/core';
import type { LogRecordExporter } from '@opentelemetry/sdk-logs';
import type { ReadableLogRecord } from '@opentelemetry/sdk-logs';
import type { ExportResult } from '@opentelemetry/core';

/** Stable key order for the stdout record (mirrors nest-template's enriched log shape). */
export interface ConsoleLogRecord {
  timestamp: string;
  level: string;
  msg: unknown;
  trace_id: string;
  span_id: string;
  [key: string]: unknown;
}

/**
 * Convert an OTEL HrTime ([seconds, nanoseconds]) to an ISO-8601 string.
 * Falls back to the current time if the hrTime is missing or invalid.
 */
function hrTimeToIso(hrTime: [number, number] | undefined): string {
  if (!hrTime || hrTime[0] === 0) {
    return new Date().toISOString();
  }
  const epochMs = hrTime[0] * 1000 + Math.floor(hrTime[1] / 1_000_000);
  return new Date(epochMs).toISOString();
}

/**
 * Serialize a ReadableLogRecord to the NDJSON stdout shape.
 *
 * Field order (stable): attributes spread first (extra context), then the fixed
 * semantic fields (timestamp, level, msg, trace_id, span_id) LAST so they always
 * win over any same-named attribute. An attribute named `timestamp` or `trace_id`
 * must never silently overwrite the authoritative values derived from hrTime /
 * spanContext — those are what tracing queries rely on.
 */
function toConsoleRecord(record: ReadableLogRecord): ConsoleLogRecord {
  const traceId = record.spanContext?.traceId ?? '';
  const spanId = record.spanContext?.spanId ?? '';
  const level = (record.severityText ?? 'info').toLowerCase();
  const timestamp = hrTimeToIso(record.hrTime as [number, number] | undefined);

  // Flatten scrubbed attributes — these come pre-redacted from the scrub stage.
  // Spread first so that any attribute with a colliding name (e.g. `timestamp`,
  // `trace_id`) is overwritten by the authoritative derived values below.
  const attrs = record.attributes as Record<string, unknown>;

  return {
    ...attrs,
    timestamp,
    level,
    msg: record.body,
    trace_id: traceId,
    span_id: spanId,
  };
}

/**
 * Single-line NDJSON LogRecordExporter for stdout.
 *
 * Writes one `JSON.stringify(record) + '\n'` per record via
 * `process.stdout.write`. stdout is synchronous and line-buffered by the
 * container runtime, so no async buffering is needed and shutdown() is a no-op.
 *
 * This exporter must only be wired as a downstream of FanOutLogRecordProcessor,
 * which itself is the downstream of ScrubLogRecordProcessor. It is structurally
 * impossible to receive an unscrubbed record this way.
 */
export class ConsoleLogRecordExporter implements LogRecordExporter {
  export(
    records: ReadableLogRecord[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    for (const record of records) {
      const line = JSON.stringify(toConsoleRecord(record));
      process.stdout.write(line + '\n');
    }
    resultCallback({ code: ExportResultCode.SUCCESS });
  }

  shutdown(): Promise<void> {
    // stdout is synchronous — nothing to flush or close.
    return Promise.resolve();
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}
