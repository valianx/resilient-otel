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
import {
  LoggerProvider,
  BatchLogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';

import { readOtelEnv } from '../config/env.js';
import { scrubberBrand } from '../scrub/scrubber.js';
import { isNoopScrubber } from '../scrub/scrubber.js';
import { ScrubSpanProcessor, ScrubLogRecordProcessor } from '../scrub/processors.js';
import { buildExporters } from './exporters.js';
import { buildPropagator } from './propagation.js';
import { buildSampler } from './sampling.js';
import { buildShutdown } from './shutdown.js';
import { setLogBridge } from '../logbridge/bridge.js';
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

  // Build LoggerProvider with SDK 2.x constructor — NO addLogRecordProcessor
  const loggerProvider = new LoggerProvider({
    resource,
    processors: [scrubLogProcessor],
  });

  // Build MeterProvider with periodic reader (60s export interval — recipe §7)
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 60_000,
    exportTimeoutMillis: 30_000,
  });
  const meterProvider = new MeterProvider({
    resource,
    readers: [metricReader],
  });

  // Build NodeSDK with SDK 2.x plural options
  const sdk = new NodeSDK({
    resource,
    spanProcessors: [scrubSpanProcessor],
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

  // Wire the log bridge so emitLog() has a logger
  setLogBridge(() => loggerProvider.getLogger('resilient-otel'));

  return buildShutdown(
    {
      sdk,
      loggerProvider,
      meterProvider,
      spanProcessor: scrubSpanProcessor,
    },
    timeoutMs,
  );
}
