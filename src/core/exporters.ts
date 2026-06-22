/**
 * Build OTLP exporters for traces, logs, and metrics.
 *
 * Default: http/protobuf via -otlp-proto packages.
 * gRPC: lazy-required only when protocol=grpc (R2 — grpc is a heavy optional peer dep).
 *
 * Headers can be a static record or a thunk (runtime token rotation — recipe §4).
 */

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
  if (typeof headers === 'function') return headers();
  return headers;
}

export function buildExporters(opts: ExporterOptions): OtelExporters {
  if (opts.protocol === 'grpc') {
    return buildGrpcExporters(opts);
  }
  return buildProtoExporters(opts);
}

function buildProtoExporters(opts: ExporterOptions): OtelExporters {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { OTLPTraceExporter } = require(
    '@opentelemetry/exporter-trace-otlp-proto',
  ) as {
    OTLPTraceExporter: new (opts: {
      url?: string;
      headers?: Record<string, string>;
    }) => import('@opentelemetry/sdk-trace-base').SpanExporter;
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { OTLPLogExporter } = require(
    '@opentelemetry/exporter-logs-otlp-proto',
  ) as {
    OTLPLogExporter: new (opts: {
      url?: string;
      headers?: Record<string, string>;
    }) => import('@opentelemetry/sdk-logs').LogRecordExporter;
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { OTLPMetricExporter } = require(
    '@opentelemetry/exporter-metrics-otlp-proto',
  ) as {
    OTLPMetricExporter: new (opts: {
      url?: string;
      headers?: Record<string, string>;
    }) => import('@opentelemetry/sdk-metrics').PushMetricExporter;
  };

  const headers = resolveHeaders(opts.headers);
  const baseOpts = { url: opts.endpoint, headers };

  return {
    traceExporter: new OTLPTraceExporter(baseOpts),
    logExporter: new OTLPLogExporter(baseOpts),
    metricExporter: new OTLPMetricExporter(baseOpts),
  };
}

function buildGrpcExporters(opts: ExporterOptions): OtelExporters {
  // Lazy-require the gRPC exporter (optional peer dep — R2)
  let OTLPTraceExporter: new (o: unknown) => import('@opentelemetry/sdk-trace-base').SpanExporter;
  let OTLPLogExporter: new (o: unknown) => import('@opentelemetry/sdk-logs').LogRecordExporter;
  let OTLPMetricExporter: new (o: unknown) => import('@opentelemetry/sdk-metrics').PushMetricExporter;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc'));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-grpc'));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-grpc'));
  } catch {
    throw new Error(
      'Protocol "grpc" requires optional peer deps @opentelemetry/exporter-{trace,logs,metrics}-otlp-grpc. ' +
        'Install them: npm install @opentelemetry/exporter-trace-otlp-grpc @opentelemetry/exporter-logs-otlp-grpc @opentelemetry/exporter-metrics-otlp-grpc',
    );
  }

  const headers = resolveHeaders(opts.headers);
  const grpcOpts = { url: opts.endpoint, metadata: headers };

  return {
    traceExporter: new OTLPTraceExporter(grpcOpts),
    logExporter: new OTLPLogExporter(grpcOpts),
    metricExporter: new OTLPMetricExporter(grpcOpts),
  };
}
