/**
 * Typed env-contract resolver.
 * All reads go through here — no process.env scattered across the codebase.
 */

export interface EnvConfig {
  /** Master switch — `${prefix}OBSERVABILITY_ENABLED` */
  observabilityEnabled: boolean;
  /** Standard OTel kill-switch */
  sdkDisabled: boolean;
  /** OTLP collector base URL */
  otlpEndpoint: string | undefined;
  /** Exporter protocol */
  otlpProtocol: 'http/protobuf' | 'grpc';
  /** Service name */
  serviceName: string | undefined;
  /** Sampling ratio */
  samplingRatio: number;
  /** Shutdown timeout ms */
  shutdownTimeoutMs: number;
  /** Scrubber mode */
  sanitizationMode: 'strict' | 'moderate' | 'disabled';
  /** Extra denylist fields from env (comma-separated) */
  extraDenylistFields: string[];
  /** Max string length */
  maxStringLength: number;
  /** Max payload size bytes */
  maxPayloadSize: number;
}

export function readEnvConfig(envPrefix = ''): EnvConfig {
  const enabledKey = `${envPrefix}OBSERVABILITY_ENABLED`;
  const observabilityEnabled =
    (process.env[enabledKey] ?? '').toLowerCase() === 'true';

  const sdkDisabled =
    (process.env['OTEL_SDK_DISABLED'] ?? '').toLowerCase() === 'true';

  const rawProtocol = process.env['OTEL_EXPORTER_OTLP_PROTOCOL'] ?? '';
  const otlpProtocol: 'http/protobuf' | 'grpc' =
    rawProtocol === 'grpc' ? 'grpc' : 'http/protobuf';

  const rawSamplingRatio = process.env['OTEL_TRACES_SAMPLER_ARG'];
  const samplingRatio = rawSamplingRatio
    ? Math.min(1, Math.max(0, parseFloat(rawSamplingRatio)))
    : 1.0;

  const rawShutdownTimeout = process.env['OTEL_SHUTDOWN_TIMEOUT'];
  const shutdownTimeoutMs = rawShutdownTimeout
    ? parseInt(rawShutdownTimeout, 10)
    : 10_000;

  const rawMode = process.env['LOG_SANITIZATION_MODE'] ?? '';
  const sanitizationMode: 'strict' | 'moderate' | 'disabled' =
    rawMode === 'strict' || rawMode === 'disabled' ? rawMode : 'moderate';

  const rawExtraFields = process.env['LOG_REDACT_EXTRA_FIELDS'] ?? '';
  const extraDenylistFields = rawExtraFields
    ? rawExtraFields
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean)
    : [];

  const rawMaxString = process.env['LOG_MAX_STRING_LENGTH'];
  const maxStringLength = rawMaxString ? parseInt(rawMaxString, 10) : 1_000;

  const rawMaxPayload = process.env['LOG_MAX_PAYLOAD_SIZE'];
  const maxPayloadSize = rawMaxPayload ? parseInt(rawMaxPayload, 10) : 10_000;

  return {
    observabilityEnabled,
    sdkDisabled,
    otlpEndpoint: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'],
    otlpProtocol,
    serviceName: process.env['OTEL_SERVICE_NAME'],
    samplingRatio,
    shutdownTimeoutMs,
    sanitizationMode,
    extraDenylistFields,
    maxStringLength,
    maxPayloadSize,
  };
}
