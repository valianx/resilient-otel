import { NodeSDK } from '@opentelemetry/sdk-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
} from '@opentelemetry/semantic-conventions';
import {
  BatchSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';

import { readOtelEnv } from '../config/env.js';
import { scrubberBrand } from '../scrub/scrubber.js';
import { isNoopScrubber } from '../scrub/scrubber.js';
import {
  ScrubSpanProcessor,
  ScrubLogRecordProcessor,
  SignalSpanProcessor,
} from '../scrub/processors.js';
import { buildExporters } from './exporters.js';
import { buildPropagator } from './propagation.js';
import { buildSampler } from './sampling.js';
import { buildShutdown } from './shutdown.js';
import type { ResilientOtelConfig, ShutdownHandle } from '../types/index.js';

/** No-op handle returned when observability is disabled. */
const NOOP_HANDLE: ShutdownHandle = {
  shutdown: () => Promise.resolve(),
};

/**
 * Initialize the OpenTelemetry SDK.
 *
 * Boot guard (R5): throws when observability is enabled and:
 *   - config.scrubber is absent, OR
 *   - config.scrubber is the noopScrubber sentinel.
 *
 * Master switch: returns NOOP_HANDLE when config.enabled === false (default true).
 * Kill-switch: returns NOOP_HANDLE when the standard OTEL_SDK_DISABLED=true.
 *
 * Uses SDK 2.x APIs (Research C2):
 *   - resourceFromAttributes() — no schemaUrl → empty-schema wins merge (R1)
 *   - LoggerProvider({ processors: [...] }) — not addLogRecordProcessor
 *   - NodeSDK({ spanProcessors: [], logRecordProcessors: [], metricReaders: [] })
 */
export async function init(config: ResilientOtelConfig): Promise<ShutdownHandle> {
  const env = readOtelEnv();

  // Master switch (code config, default on) or standard OTEL_SDK_DISABLED kill-switch
  if (config.enabled === false || env.sdkDisabled) {
    return NOOP_HANDLE;
  }

  // Boot guard (R5): require a real scrubber when enabled
  if (!config.scrubber) {
    throw new Error(
      '[resilient-otel] init() requires a scrubber when observability is enabled. ' +
        'Pass scrubber: createScrubber() from resilient-otel/scrub.',
    );
  }
  if (!(scrubberBrand in config.scrubber) || isNoopScrubber(config.scrubber)) {
    throw new Error(
      '[resilient-otel] noopScrubber is not a valid scrubber for production. ' +
        'Pass scrubber: createScrubber() from resilient-otel/scrub.',
    );
  }

  // Config wins; standard OTEL_* env fills gaps; then code defaults.
  const protocol = config.protocol ?? env.protocol ?? 'http/protobuf';
  const endpoint = config.endpoint ?? env.endpoint;
  const timeoutMs = config.shutdownTimeoutMs ?? 10_000;
  const samplingRatio = config.samplingRatio ?? env.samplingRatio ?? 1.0;

  // Build resource — no schemaUrl argument (empty schema wins merge, R1 safeguard)
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]:
      config.serviceName ?? env.serviceName ?? 'unknown-service',
    [ATTR_SERVICE_VERSION]: config.serviceVersion ?? '0.0.0',
    ...(config.environment
      ? { [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: config.environment }
      : {}),
  });

  // Build exporters (async: proto via static import, grpc via dynamic import)
  const { traceExporter, logExporter, metricExporter } = await buildExporters({
    protocol,
    endpoint,
    headers: config.headers,
  });

  // Build processors wrapping downstream batch processors with scrub layer
  const batchSpanProcessor = new BatchSpanProcessor(traceExporter, {
    maxQueueSize: 4096,
    maxExportBatchSize: 1024,
  });
  const scrubSpanProcessor = new ScrubSpanProcessor(
    batchSpanProcessor,
    config.scrubber,
  );

  const batchLogProcessor = new BatchLogRecordProcessor(logExporter);
  const scrubLogProcessor = new ScrubLogRecordProcessor(
    batchLogProcessor,
    config.scrubber,
  );

  // Periodic metric reader (60s export interval — recipe §7).
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 60_000,
    exportTimeoutMillis: 30_000,
  });

  // NodeSDK owns all three signals, wired with OUR scrub-wrapped processors and
  // metric reader. Passing them explicitly makes NodeSDK use them (and the
  // scrubber) and register the global tracer/logger/meter providers — so
  // emitLog()/logs.getLogger() and metrics.getMeter() reach the SCRUBBED
  // pipeline. We must NOT also build standalone Logger/Meter providers: when
  // OTEL_EXPORTER_OTLP_ENDPOINT is set, NodeSDK already registers global
  // providers and a second setGlobal*Provider() call is silently ignored —
  // which previously let unscrubbed logs leak. One owner only.
  const sdk = new NodeSDK({
    resource,
    spanProcessors: [new SignalSpanProcessor(), scrubSpanProcessor],
    logRecordProcessors: [scrubLogProcessor],
    metricReaders: [metricReader],
    sampler: buildSampler(samplingRatio),
    textMapPropagator: buildPropagator(),
    instrumentations:
      (config.instrumentations as NonNullable<
        ConstructorParameters<typeof NodeSDK>[0]
      >['instrumentations']) ?? [],
  });
  sdk.start();

  return buildShutdown({ sdk }, timeoutMs);
}
