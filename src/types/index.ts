// Brand symbol for the scrubber boot guard (R5).
// Canonical single source so the interface and the implementation reference
// the same `unique symbol`.
export const scrubberBrand: unique symbol = Symbol('resilient-otel.scrubber');

export interface Scrubber {
  redact(text: string): string;
  scrubAttrs<T extends Record<string, unknown>>(obj: T): T;
  readonly [scrubberBrand]: true;
}

export interface ScrubberConfig {
  /** Redaction mode. Default from LOG_SANITIZATION_MODE, then 'moderate'. */
  mode?: 'strict' | 'moderate' | 'disabled';
  /** Merged ON TOP of DEFAULT_DENYLIST. */
  extraDenylist?: string[];
  /** Merged ON TOP of DEFAULT_SECRET_PATTERNS. */
  extraSecretPatterns?: RegExp[];
  /** Replacement string. Default '[REDACTED]'. */
  replacement?: string;
  /** Max individual string length. Default from LOG_MAX_STRING_LENGTH. */
  maxStringLength?: number;
  /** When true, also merges LOG_REDACT_EXTRA_FIELDS (comma-separated). Default true. */
  readEnvDenylist?: boolean;
}

export interface ResilientOtelConfig {
  /** Service name. Default: OTEL_SERVICE_NAME env. */
  serviceName?: string;
  /** Service version. Default: package.json version. */
  serviceVersion?: string;
  /** deployment.environment attribute. */
  environment?: string;
  /** Env-var prefix. Default '' → reads OBSERVABILITY_ENABLED. */
  envPrefix?: string;
  /** Required when observability is enabled. Boot guard (R5). */
  scrubber: Scrubber;
  /** Exporter protocol. Default from OTEL_EXPORTER_OTLP_PROTOCOL, then 'http/protobuf'. */
  protocol?: 'http/protobuf' | 'grpc';
  /** OTLP collector base URL. Default from OTEL_EXPORTER_OTLP_ENDPOINT. */
  endpoint?: string;
  /** OTLP headers. Runtime thunk evaluated on each export to support token rotation. */
  headers?: Record<string, string> | (() => Record<string, string>);
  /** Sampling ratio 0.0–1.0. Default from OTEL_TRACES_SAMPLER_ARG, then 1.0. */
  samplingRatio?: number;
  /** Graceful shutdown timeout ms. Default from OTEL_SHUTDOWN_TIMEOUT, then 10000. */
  shutdownTimeoutMs?: number;
  /** Optional instrumentations to pass to NodeSDK. */
  instrumentations?: unknown[];
}

export interface ShutdownHandle {
  shutdown(): Promise<void>;
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
