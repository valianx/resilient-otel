import { SeverityNumber, type LogRecord, logs } from '@opentelemetry/api-logs';
import { context } from '@opentelemetry/api';
import { enrichWithContext } from './enrich.js';

function mapSeverity(level: string): SeverityNumber {
  switch (level.toLowerCase()) {
    case 'error':
      return SeverityNumber.ERROR;
    case 'warn':
      return SeverityNumber.WARN;
    case 'info':
      return SeverityNumber.INFO;
    case 'debug':
      return SeverityNumber.DEBUG;
    case 'trace':
      return SeverityNumber.TRACE;
    default:
      return SeverityNumber.UNSPECIFIED;
  }
}

/**
 * Emit a log record through the OTel Logs Bridge API.
 * Enriches with trace + execution context before emission.
 *
 * Uses the GLOBAL logs API (`logs.getLogger`) rather than a module-level
 * reference, so it works across bundle boundaries — `init()` (which may live in
 * a different subpath bundle, e.g. /nestjs) registers the global LoggerProvider,
 * and this picks it up. Before init (or when observability is disabled) the
 * global logger is a no-op, so emitLog() is a safe no-op too.
 */
export function emitLog(
  level: string,
  data: Record<string, unknown>,
): void {
  const enriched = enrichWithContext(data);
  const body =
    typeof enriched.msg === 'string'
      ? enriched.msg
      : typeof enriched.message === 'string'
        ? enriched.message
        : JSON.stringify(enriched);

  const record: LogRecord = {
    timestamp: Date.now(),
    observedTimestamp: Date.now(),
    severityNumber: mapSeverity(level),
    severityText: level,
    body,
    // Pass the active context so the SDK populates the LogRecord's NATIVE
    // trace_id/span_id fields (the OTel/ECS standard for log↔trace correlation).
    // We do NOT add trace_id/span_id as attributes — backends correlate on the
    // native fields, and duplicating them in attributes is non-standard.
    context: context.active(),
    attributes: {
      ...enriched,
      signal: 'log',
    },
  };

  logs.getLogger('resilient-otel').emit(record);
}
