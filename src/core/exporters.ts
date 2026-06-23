/**
 * Build OTLP exporters for traces, logs, and metrics.
 *
 * Default: http/protobuf via the -otlp-proto packages (static imports — they
 * are runtime deps and ESM-safe).
 * gRPC: dynamic import() only when protocol=grpc (R2 — grpc is a heavy optional
 * peer dep). Dynamic import (not require) so the ESM bundle works too.
 *
 * Headers can be a static record or a thunk (runtime token rotation — recipe §4).
 */
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';

export interface ExporterOptions {
  protocol: 'http/protobuf' | 'grpc';
  endpoint: string | undefined;
  headers?: Record<string, string> | (() => Record<string, string>);
}

export interface OtelExporters {
  traceExporter: import('@opentelemetry/sdk-trace-base').SpanExporter;
  logExporter: import('@opentelemetry/sdk-logs').LogRecordExporter;
  metricExporter: import('@opentelemetry/sdk-metrics').PushMetricExporter;
}

function resolveHeaders(
  headers: Record<string, string> | (() => Record<string, string>) | undefined,
): Record<string, string> | undefined {
  return typeof headers === 'function' ? headers() : headers;
}

export async function buildExporters(
  opts: ExporterOptions,
): Promise<OtelExporters> {
  if (opts.protocol === 'grpc') {
    return buildGrpcExporters(opts);
  }
  return buildProtoExporters(opts);
}

/**
 * For OTLP/HTTP, the exporter `url` is the COMPLETE signal URL — it does NOT
 * append `/v1/<signal>` (only the OTEL_EXPORTER_OTLP_ENDPOINT *env var* does).
 * So when an endpoint is given as config we append the per-signal path
 * ourselves; this is correct for a local Collector and for vendors (Axiom, etc).
 * When endpoint is undefined the exporter falls back to its own localhost default.
 */
function signalUrl(
  endpoint: string | undefined,
  signal: 'traces' | 'logs' | 'metrics',
): string | undefined {
  if (!endpoint) return undefined;
  return `${endpoint.replace(/\/+$/, '')}/v1/${signal}`;
}

function buildProtoExporters(opts: ExporterOptions): OtelExporters {
  const headers = resolveHeaders(opts.headers);
  return {
    traceExporter: new OTLPTraceExporter({ url: signalUrl(opts.endpoint, 'traces'), headers }),
    logExporter: new OTLPLogExporter({ url: signalUrl(opts.endpoint, 'logs'), headers }),
    metricExporter: new OTLPMetricExporter({ url: signalUrl(opts.endpoint, 'metrics'), headers }),
  };
}

async function buildGrpcExporters(
  opts: ExporterOptions,
): Promise<OtelExporters> {
  let trace: typeof import('@opentelemetry/exporter-trace-otlp-grpc');
  let logs: typeof import('@opentelemetry/exporter-logs-otlp-grpc');
  let metrics: typeof import('@opentelemetry/exporter-metrics-otlp-grpc');
  try {
    trace = await import('@opentelemetry/exporter-trace-otlp-grpc');
    logs = await import('@opentelemetry/exporter-logs-otlp-grpc');
    metrics = await import('@opentelemetry/exporter-metrics-otlp-grpc');
  } catch {
    throw new Error(
      'Protocol "grpc" requires optional peer deps @opentelemetry/exporter-{trace,logs,metrics}-otlp-grpc. ' +
        'Install them: npm install @opentelemetry/exporter-trace-otlp-grpc @opentelemetry/exporter-logs-otlp-grpc @opentelemetry/exporter-metrics-otlp-grpc',
    );
  }

  // gRPC carries headers as grpc Metadata, not a plain record. Build it only
  // when headers are present (a local Collector usually needs none).
  const headerRecord = resolveHeaders(opts.headers);
  let metadata: import('@grpc/grpc-js').Metadata | undefined;
  if (headerRecord && Object.keys(headerRecord).length > 0) {
    const { Metadata } = await import('@grpc/grpc-js');
    const md = new Metadata();
    for (const [key, value] of Object.entries(headerRecord)) md.set(key, value);
    metadata = md;
  }

  const grpcOpts = { url: opts.endpoint, metadata };
  return {
    traceExporter: new trace.OTLPTraceExporter(grpcOpts),
    logExporter: new logs.OTLPLogExporter(grpcOpts),
    metricExporter: new metrics.OTLPMetricExporter(grpcOpts),
  };
}
