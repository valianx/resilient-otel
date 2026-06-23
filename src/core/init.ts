import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
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
  BatchLogRecordProcessor,
  SimpleLogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';

import { readOtelEnv } from '../config/env.js';
import { scrubberBrand, isNoopScrubber, createScrubber } from '../scrub/scrubber.js';
import {
  ScrubSpanProcessor,
  ScrubLogRecordProcessor,
  SignalSpanProcessor,
} from '../scrub/processors.js';
import { buildExporters } from './exporters.js';
import { buildPropagator } from './propagation.js';
import { buildSampler } from './sampling.js';
import { buildShutdown } from './shutdown.js';
import { ConsoleLogRecordExporter } from './console-exporter.js';
import { FanOutLogRecordProcessor } from './fanout-processor.js';
import { registerGracefulShutdown } from './graceful-shutdown.js';
import { buildDefaultInstrumentations } from './instrumentations.js';
import type { ResilientOtelConfig, ShutdownHandle, Scrubber } from '../types/index.js';

/** No-op handle returned when observability is disabled. */
const NOOP_HANDLE: ShutdownHandle = {
  shutdown: () => Promise.resolve(),
};

/**
 * Map diagLogLevel config string to the SDK DiagLogLevel enum.
 */
function resolveDiagLevel(level: string): DiagLogLevel {
  switch (level) {
    case 'error': return DiagLogLevel.ERROR;
    case 'warn':  return DiagLogLevel.WARN;
    case 'info':  return DiagLogLevel.INFO;
    case 'debug': return DiagLogLevel.DEBUG;
    default:      return DiagLogLevel.NONE;
  }
}

/**
 * Resolve the scrubber from config.scrubber (explicit, wins) or
 * config.scrubberConfig (built internally). Returns the scrubber and a flag
 * indicating whether the library built it (so it can be exposed on the handle).
 */
function resolveScrubber(
  config: ResilientOtelConfig,
): { scrubber: Scrubber; libraryBuilt: boolean } {
  if (config.scrubber) {
    return { scrubber: config.scrubber, libraryBuilt: false };
  }
  if (config.scrubberConfig) {
    return { scrubber: createScrubber(config.scrubberConfig), libraryBuilt: true };
  }
  // Neither provided — boot guard throws below.
  throw new Error(
    '[resilient-otel] init() requires a scrubber when observability is enabled. ' +
      'Pass scrubber: createScrubber() from resilient-otel/scrub, or scrubberConfig: { ... }.',
  );
}

/**
 * Initialize the OpenTelemetry SDK.
 *
 * Boot guard (R5): throws when observability is enabled and:
 *   - neither config.scrubber nor config.scrubberConfig is provided, OR
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

  // Optional: wire the OTel diag logger before any SDK construction.
  if (config.diagLogLevel && config.diagLogLevel !== 'none') {
    diag.setLogger(new DiagConsoleLogger(), resolveDiagLevel(config.diagLogLevel));
  }

  // Boot guard (R5): require a real scrubber when enabled.
  // resolveScrubber throws when neither scrubber nor scrubberConfig is set.
  const { scrubber, libraryBuilt } = resolveScrubber(config);

  if (!(scrubberBrand in scrubber) || isNoopScrubber(scrubber)) {
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
    scrubber,
  );

  // Resolve whether console export is enabled.
  // Resolution order: config.consoleExport → OTEL_RESILIENT_CONSOLE → false
  const consoleEnabled =
    config.consoleExport === true ||
    (config.consoleExport == null && env.resilientConsole);

  // Build the log processor chain.
  // When console is enabled: scrub → fanout(batch + console-simple).
  // When console is disabled (default): scrub → batch (identical to today).
  const batchLogProcessor = new BatchLogRecordProcessor(logExporter);
  const logDownstream = consoleEnabled
    ? new FanOutLogRecordProcessor([
        batchLogProcessor,
        new SimpleLogRecordProcessor(new ConsoleLogRecordExporter()),
      ])
    : batchLogProcessor;

  const scrubLogProcessor = new ScrubLogRecordProcessor(logDownstream, scrubber);

  // Periodic metric reader (60s export interval — recipe §7).
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 60_000,
    exportTimeoutMillis: 30_000,
  });

  // Resolve instrumentations.
  // Precedence: explicit config.instrumentations wins → useDefaultInstrumentations builder → [].
  let instrumentations: unknown[];
  if (config.instrumentations) {
    // Explicit array always wins — consumer owns instrumentation fully.
    if (config.ignoreIncomingPaths?.length) {
      diag.warn(
        '[resilient-otel] ignoreIncomingPaths is ignored when an explicit instrumentations array is provided. ' +
          'Wire ignoreIncomingRequestHook directly on HttpInstrumentation.',
      );
    }
    instrumentations = config.instrumentations;
  } else if (config.useDefaultInstrumentations) {
    instrumentations = await buildDefaultInstrumentations({
      extraInstrumentations: config.extraInstrumentations,
      disableInstrumentations: config.disableInstrumentations,
      ignoreIncomingPaths: config.ignoreIncomingPaths,
    });
  } else {
    instrumentations = [];
  }

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
      (instrumentations as NonNullable<
        ConstructorParameters<typeof NodeSDK>[0]
      >['instrumentations']) ?? [],
  });
  sdk.start();

  const handle = buildShutdown({ sdk }, timeoutMs);

  // Expose the library-built scrubber on the handle so the consumer can pass
  // it to ObservabilityModule.forWiring({ scrubber: handle.scrubber }).
  if (libraryBuilt) {
    (handle as { scrubber?: Scrubber }).scrubber = scrubber;
  }

  // Register SIGTERM/SIGINT handlers when the consumer opts in.
  if (config.gracefulShutdown) {
    registerGracefulShutdown(handle);
  }

  return handle;
}
