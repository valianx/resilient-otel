import { SeverityNumber, type LogRecord } from '@opentelemetry/api-logs';
import { context, trace } from '@opentelemetry/api';
import { enrichWithContext } from './enrich.js';

// Lazy reference to the LoggerProvider set by init()
let _getLogger: (() => import('@opentelemetry/api-logs').Logger) | null = null;

/** Called by init() to wire the log bridge to the SDK's LoggerProvider. */
export function setLogBridge(
  getLogger: () => import('@opentelemetry/api-logs').Logger,
): void {
  _getLogger = getLogger;
}

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
 * Falls back to console.error/warn/log/debug when no bridge is wired
 * (i.e., before init() is called or when observability is disabled).
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

  if (!_getLogger) {
    // No-op bridge: observability disabled or not yet initialized
    return;
  }

  const currentSpan = trace.getSpan(context.active());
  const spanCtx = currentSpan?.spanContext();

  const record: LogRecord = {
    timestamp: Date.now(),
    observedTimestamp: Date.now(),
    severityNumber: mapSeverity(level),
    severityText: level,
    body,
    attributes: {
      ...enriched,
      signal: 'log',
      trace_id: spanCtx?.traceId,
      span_id: spanCtx?.spanId,
    },
  };

  _getLogger().emit(record);
}
