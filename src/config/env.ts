/**
 * Standard OpenTelemetry environment fallbacks.
 *
 * The library reads NO env vars of its own — all instance configuration is
 * passed to init()/createScrubber(). The only env vars consulted here are the
 * genuinely-standard `OTEL_*` names defined by the OpenTelemetry spec, used
 * ONLY as a fallback when the corresponding config field is omitted (config
 * always wins). The underlying OTel SDK reads these natively anyway.
 */

export interface OtelEnv {
  /** OTEL_EXPORTER_OTLP_ENDPOINT */
  endpoint: string | undefined;
  /** OTEL_EXPORTER_OTLP_PROTOCOL — only 'grpc' | 'http/protobuf' are honored */
  protocol: 'http/protobuf' | 'grpc' | undefined;
  /** OTEL_SERVICE_NAME */
  serviceName: string | undefined;
  /** OTEL_TRACES_SAMPLER_ARG, clamped to 0..1 */
  samplingRatio: number | undefined;
  /** OTEL_SDK_DISABLED — standard kill-switch */
  sdkDisabled: boolean;
  /** OTEL_RESILIENT_CONSOLE — opt-in stdout console exporter ('true' | '1') */
  resilientConsole: boolean;
}

export function readOtelEnv(): OtelEnv {
  const rawProtocol = process.env['OTEL_EXPORTER_OTLP_PROTOCOL'];
  const protocol =
    rawProtocol === 'grpc' || rawProtocol === 'http/protobuf'
      ? rawProtocol
      : undefined;

  const rawSamplingRatio = process.env['OTEL_TRACES_SAMPLER_ARG'];
  const samplingRatio =
    rawSamplingRatio !== undefined && rawSamplingRatio !== ''
      ? Math.min(1, Math.max(0, parseFloat(rawSamplingRatio)))
      : undefined;

  const rawConsole = (process.env['OTEL_RESILIENT_CONSOLE'] ?? '').toLowerCase();
  const resilientConsole = rawConsole === 'true' || rawConsole === '1';

  return {
    endpoint: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'],
    protocol,
    serviceName: process.env['OTEL_SERVICE_NAME'],
    samplingRatio,
    sdkDisabled:
      (process.env['OTEL_SDK_DISABLED'] ?? '').toLowerCase() === 'true',
    resilientConsole,
  };
}
