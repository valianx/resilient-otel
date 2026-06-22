/**
 * WinstonOtelTransport — optional Winston transport that bridges log records
 * to OTel Logs via the log bridge.
 *
 * Requires optional peer deps: winston, winston-transport.
 *
 * Ported from nest-template/observability/transports/otel-winston.transport.ts.
 */

import { context, trace } from '@opentelemetry/api';
import { SeverityNumber } from '@opentelemetry/api-logs';
import type { Logger } from '@opentelemetry/api-logs';

interface TransportStreamBase {
  emit(event: string, info: unknown): boolean;
  log(info: Record<string, unknown>, callback: () => void): void;
}
type TransportStreamCtor = new (opts?: Record<string, unknown>) => TransportStreamBase;

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

/**
 * Lazily create a Winston transport that bridges log records to OTel Logs.
 *
 * The `winston-transport` peer dep is imported on demand inside this factory,
 * so importing the NestJS barrel never eagerly loads winston (ESM-safe; the
 * optional peer is only required by consumers who actually use this transport).
 */
export async function createWinstonOtelTransport(
  opts: WinstonOtelTransportOptions,
): Promise<TransportStreamBase> {
  let TransportStream: TransportStreamCtor;
  try {
    const mod = (await import('winston-transport')) as unknown as {
      default: TransportStreamCtor;
    };
    TransportStream = mod.default;
  } catch {
    throw new Error(
      'createWinstonOtelTransport requires the optional peer dep "winston-transport". ' +
        'Install it: npm install winston winston-transport',
    );
  }

  class WinstonOtelTransportImpl extends TransportStream {
    private otelLogger: Logger;

    constructor(o: WinstonOtelTransportOptions) {
      super(o as unknown as Record<string, unknown>);
      this.otelLogger = o.otelLogger;
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

  return new WinstonOtelTransportImpl(opts);
}
