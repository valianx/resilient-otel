# CONFIG.md — resilient-otel configuration contract

> Source of truth for the library's configuration surface.
> Philosophy: **config-first with safe defaults.** The library reads no environment variables of its own — every option is a typed field on `init()` / `createScrubber()` with a default. The only env vars consulted are the standard OpenTelemetry `OTEL_*` ones, used as fallbacks; config always wins.
> **Resolution order for each field:** explicit config value → standard `OTEL_*` env (where noted) → built-in default.

---

## `init(config)` — `ResilientOtelConfig`

| Option | Default | Env fallback | Controls |
|---|---|---|---|
| `enabled` | `true` | — | Master switch. `false` → no-op (no exporters constructed). Wire it to your own flag. |
| `scrubber` | — (**required**) | — | The scrubber instance. Boot guard: `init()` throws if absent or `noopScrubber`. |
| `serviceName` | `'unknown-service'` | `OTEL_SERVICE_NAME` | `service.name` resource attribute. |
| `serviceVersion` | `'0.0.0'` | — | `service.version` resource attribute. |
| `environment` | — | `OTEL_RESOURCE_ATTRIBUTES` | `deployment.environment` resource attribute. |
| `endpoint` | SDK default (`localhost`) | `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP endpoint (Collector or vendor). |
| `protocol` | `'http/protobuf'` | `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` \| `grpc`. |
| `headers` | — | — | Static record or `() => record` (runtime token rotation, e.g. `axiomHeaders()`). |
| `samplingRatio` | `1.0` | `OTEL_TRACES_SAMPLER_ARG` | Trace sampling ratio, clamped to 0–1. |
| `shutdownTimeoutMs` | `10000` | — | Graceful-shutdown timeout (ms). |
| `instrumentations` | `[]` | — | Auto-instrumentations passed to the NodeSDK. |

## `createScrubber(config?)` — `ScrubberConfig`

| Option | Default | Controls |
|---|---|---|
| `mode` | `'moderate'` | `strict` \| `moderate` \| `disabled`. `disabled` short-circuits all redaction. |
| `extraDenylist` | `[]` | Extra field names to redact, merged onto `DEFAULT_DENYLIST`. |
| `extraSecretPatterns` | `[]` | Extra `RegExp` secret patterns, merged onto `DEFAULT_SECRET_PATTERNS`. |
| `replacement` | `'[REDACTED]'` | Replacement string for redacted values. |
| `maxStringLength` | `1000` | Max individual string length (truncated in `strict` mode). |

Denylist merge order: `DEFAULT_DENYLIST ∪ extraDenylist` (config-only; no env channel).

## Standard OpenTelemetry env vars

These are **not** names this library invented — they are the OpenTelemetry spec's, read by the underlying SDK. They act as fallbacks for the fields above (config wins), plus:

| Variable | Effect |
|---|---|
| `OTEL_SDK_DISABLED=true` | Forces a no-op, in addition to `enabled: false`. |
| `OTEL_RESOURCE_ATTRIBUTES` | Extra resource attributes, read natively by the SDK. |
| `AXIOM_TOKEN` / `AXIOM_DATASET` | Read by `axiomHeaders()` only, at call time (token rotation without a code change). |
