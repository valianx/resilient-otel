// Brand symbol for the scrubber boot guard (R5).
// MUST be a GLOBAL registered symbol (Symbol.for), not Symbol(): createScrubber
// lives in the /scrub bundle while init()'s boot guard lives in /core (and is
// re-bundled into /nestjs). Those are separate tsup bundles, so a plain Symbol()
// would differ across copies and the guard would falsely reject a real scrubber.
// Symbol.for() returns the same symbol across every bundle/realm.
export const scrubberBrand: unique symbol = Symbol.for('resilient-otel.scrubber');

export interface Scrubber {
  redact(text: string): string;
  scrubAttrs<T extends Record<string, unknown>>(obj: T): T;
  readonly [scrubberBrand]: true;
}

export interface ScrubberConfig {
  /** Redaction mode. Default: 'moderate'. */
  mode?: 'strict' | 'moderate' | 'disabled';
  /** Merged ON TOP of DEFAULT_DENYLIST. */
  extraDenylist?: string[];
  /** Merged ON TOP of DEFAULT_SECRET_PATTERNS. */
  extraSecretPatterns?: RegExp[];
  /** Replacement string. Default '[REDACTED]'. */
  replacement?: string;
  /** Max individual string length (strict mode). Default: 1000. */
  maxStringLength?: number;
}

export interface ResilientOtelConfig {
  /**
   * Master switch. Default: `true`. Wire it to your own flag (the library
   * does NOT read any env var of its own). When `false`, init() is a no-op.
   * The standard `OTEL_SDK_DISABLED=true` env var also forces a no-op.
   */
  enabled?: boolean;
  /**
   * Required unless `scrubberConfig` is provided (boot guard, R5).
   * Build with createScrubber() from 'resilient-otel/scrub'.
   * Explicit `scrubber` takes precedence over `scrubberConfig`.
   */
  scrubber?: Scrubber;
  /**
   * Opt-in: let init() build and expose the scrubber. Ignored when `scrubber` is set.
   * The built scrubber is available on the returned handle as `handle.scrubber`.
   * At least one of `scrubber` or `scrubberConfig` must be provided when enabled.
   */
  scrubberConfig?: ScrubberConfig;
  /** Service name. Config wins; falls back to OTEL_SERVICE_NAME, then 'unknown-service'. */
  serviceName?: string;
  /** Service version. Default: '0.0.0'. */
  serviceVersion?: string;
  /** deployment.environment attribute. */
  environment?: string;
  /** Exporter protocol. Config wins; falls back to OTEL_EXPORTER_OTLP_PROTOCOL, then 'http/protobuf'. */
  protocol?: 'http/protobuf' | 'grpc';
  /** OTLP endpoint. Config wins; falls back to OTEL_EXPORTER_OTLP_ENDPOINT (then the SDK default). */
  endpoint?: string;
  /** OTLP headers. Runtime thunk evaluated on each export to support token rotation. */
  headers?: Record<string, string> | (() => Record<string, string>);
  /** Sampling ratio 0.0–1.0. Config wins; falls back to OTEL_TRACES_SAMPLER_ARG, then 1.0. */
  samplingRatio?: number;
  /** Graceful shutdown timeout ms. Default: 10000 (code-only, no env). */
  shutdownTimeoutMs?: number;
  /** Optional instrumentations to pass to NodeSDK. */
  instrumentations?: unknown[];
  /**
   * Opt-in: emit each (already-scrubbed) log record to stdout as single-line JSON,
   * in addition to OTLP. Default: false.
   * Env fallback: OTEL_RESILIENT_CONSOLE=true (config wins over env).
   * Resolution order: config.consoleExport → OTEL_RESILIENT_CONSOLE → false.
   */
  consoleExport?: boolean;
  /**
   * Serialize complex (non-array object) log attribute values to JSON strings
   * before export. Required for backends that do not index nested objects
   * (e.g. Elastic Cloud / Elasticsearch, which Zippy's Collector exports to).
   *
   * Serializes the named set { body, headers, metadata, error, exception } AND
   * any other non-array object attribute (catch-all). Scalars, arrays, strings,
   * and native trace_id/span_id are untouched. signal:'log' stays scalar.
   *
   * Serialization runs AFTER the scrubber and ABOVE the OTLP/console fan-out,
   * so PII redaction is preserved and OTLP + stdout receive the identical
   * serialized record.
   *
   * Default: true (Elastic-safe behavior out of the box).
   * Env opt-out: OTEL_RESILIENT_SERIALIZE_ATTRS=false (or '0') disables it.
   * Resolution order: config.serializeComplexAttributes → env → true.
   */
  serializeComplexAttributes?: boolean;
  /**
   * Opt-in: use the library's documented pruned instrumentation allowlist.
   * When true and no explicit `instrumentations` array is provided, init()
   * builds the default set (http, express, nestjs-core, pg, ioredis, undici,
   * runtime-node) via dynamic import of @opentelemetry/auto-instrumentations-node.
   * Default: false.
   */
  useDefaultInstrumentations?: boolean;
  /**
   * Extra instrumentations appended to the default set when `useDefaultInstrumentations` is true.
   * Ignored when an explicit `instrumentations` array is provided.
   */
  extraInstrumentations?: unknown[];
  /**
   * Instrumentation package names to drop from the default set.
   * E.g. ['@opentelemetry/instrumentation-pg'] to exclude the pg instrumentation.
   * Ignored when an explicit `instrumentations` array is provided.
   */
  disableInstrumentations?: string[];
  /**
   * Opt-in: register SIGTERM/SIGINT handlers that call handle.shutdown() then exit.
   * Default: false (today's behaviour — consumer wires its own).
   */
  gracefulShutdown?: boolean;
  /**
   * Incoming request URL patterns to ignore in HTTP tracing (e.g. health checks).
   * String = substring match; RegExp = test(). Used with `useDefaultInstrumentations: true`.
   * Ignored when an explicit `instrumentations` array is provided (consumer owns the HTTP
   * instrumentation in that case); a diag.warn is emitted to inform.
   */
  ignoreIncomingPaths?: (string | RegExp)[];
  /**
   * Set the OTel diag logger level. Default: 'none' (library does not touch diag).
   * Options: 'none' | 'error' | 'warn' | 'info' | 'debug'.
   */
  diagLogLevel?: 'none' | 'error' | 'warn' | 'info' | 'debug';
}

export interface ShutdownHandle {
  shutdown(): Promise<void>;
  /**
   * Present when init() built the scrubber from `scrubberConfig`.
   * Pass to ObservabilityModule.forWiring({ scrubber: handle.scrubber }).
   */
  scrubber?: Scrubber;
}

export interface MetricsHandles {
  requestsCounter: import('@opentelemetry/api').Counter;
  requestDurationHistogram: import('@opentelemetry/api').Histogram;
  unhandledRejectionsCounter: import('@opentelemetry/api').Counter;
  activeRequestsGauge: import('@opentelemetry/api').UpDownCounter;
}

export type ContextType = 'http' | 'kafka' | 'job' | 'background' | 'unknown';

export interface ExecutionCtx {
  executionId: string;
  contextType: ContextType;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  httpMethod?: string;
  httpUrl?: string;
  httpHeaders?: Record<string, unknown>;
  kafkaTopic?: string;
  kafkaPartition?: number;
  kafkaOffset?: string;
  kafkaKey?: string;
  jobName?: string;
  jobId?: string;
  userId?: string;
  channel?: string;
  country?: string;
  commerce?: string;
  metadata?: Record<string, unknown>;
  timestamp?: Date;
}
