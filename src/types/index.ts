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
  /** Required (boot guard, R5). Build with createScrubber() from 'resilient-otel/scrub'. */
  scrubber: Scrubber;
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
