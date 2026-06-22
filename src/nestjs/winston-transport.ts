/**
 * WinstonOtelTransport — optional Winston transport that bridges log records
 * to OTel Logs via the log bridge.
 *
 * Requires optional peer deps: winston, winston-transport.
 *
 * Ported from nest-template/observability/transports/otel-winston.transport.ts.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TransportStream = require('winston-transport') as {
  new (opts?: Record<string, unknown>): {
    emit(event: string, info: unknown): boolean;
    log(info: Record<string, unknown>, callback: () => void): void;
  };
};

import { context, trace } from '@opentelemetry/api';
import { SeverityNumber } from '@opentelemetry/api-logs';
import type { Logger } from '@opentelemetry/api-logs';

type LogRecord = import('@opentelemetry/api-logs').LogRecord;

const SKIP_FIELDS = new Set(['level', 'message', 'msg', 'timestamp', 'splat']);
const SERIALIZE_FIELDS = new Set(['body', 'headers', 'metadata', 'error', 'exception']);

function mapSeverity(level: string): SeverityNumber {
  switch (level.toLowerCase()) {
    case 'error': return SeverityNumber.ERROR;
    case 'warn': return SeverityNumber.WARN;
    case 'info': return SeverityNumber.INFO;
    case 'debug': return SeverityNumber.DEBUG;
    case 'trace': return SeverityNumber.TRACE;
    default: return SeverityNumber.UNSPECIFIED;
  }
}

function serializeAttributes(info: Record<string, unknown>): Record<string, unknown> {
  const source =
    typeof info['message'] === 'object' && info['message'] !== null
      ? (info['message'] as Record<string, unknown>)
      : info;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (SKIP_FIELDS.has(key)) continue;
    if (SERIALIZE_FIELDS.has(key) && typeof value === 'object' && value !== null) {
      result[key] = JSON.stringify(value);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = JSON.stringify(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export interface WinstonOtelTransportOptions {
  otelLogger: Logger;
}

class WinstonOtelTransportImpl extends TransportStream {
  private otelLogger: Logger;

  constructor(opts: WinstonOtelTransportOptions) {
    super(opts as unknown as Record<string, unknown>);
    this.otelLogger = opts.otelLogger;
  }

  log(info: Record<string, unknown>, callback: () => void): void {
    setImmediate(() => this.emit('logged', info));

    const currentSpan = trace.getSpan(context.active());
    const spanCtx = currentSpan?.spanContext();

    const messageObj = info['message'] as Record<string, unknown>;
    const body =
      typeof messageObj === 'object' && messageObj !== null
        ? ((messageObj['msg'] as string) ?? JSON.stringify(messageObj))
        : (info['message'] as string);

    const record: LogRecord = {
      timestamp: Date.now(),
      observedTimestamp: Date.now(),
      severityText: info['level'] as string,
      severityNumber: mapSeverity(info['level'] as string),
      body,
      attributes: {
        ...serializeAttributes(info),
        trace_id: spanCtx?.traceId,
        span_id: spanCtx?.spanId,
      },
    };

    this.otelLogger.emit(record);
    callback();
  }
}

export const WinstonOtelTransport = WinstonOtelTransportImpl;
