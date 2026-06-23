# CONFIG.md — resilient-otel configuration contract

> Source of truth for the library's configuration surface.
> Philosophy: **config-first with safe defaults.** The library reads no environment variables of its own — every option is a typed field on `init()` / `createScrubber()` with a default. The only env vars consulted are the standard OpenTelemetry `OTEL_*` ones, used as fallbacks; config always wins.
> **Resolution order for each field:** explicit config value → standard `OTEL_*` env (where noted) → built-in default.

---

## `init(config)` — `ResilientOtelConfig`

| Option | Default | Env fallback | Controls |
|---|---|---|---|
| `enabled` | `true` | — | Master switch. `false` → no-op (no exporters constructed). Wire it to your own flag. |
| `scrubber` | — | — | The scrubber instance (explicit, wins over `scrubberConfig`). Boot guard: `init()` throws if absent and `scrubberConfig` is also absent, or if `noopScrubber`. |
| `scrubberConfig` | — | — | Build the scrubber inside `init()` and expose it on `handle.scrubber`. Ignored when `scrubber` is set. At least one of `scrubber` or `scrubberConfig` must be provided when enabled. |
| `serviceName` | `'unknown-service'` | `OTEL_SERVICE_NAME` | `service.name` resource attribute. |
| `serviceVersion` | `'0.0.0'` | — | `service.version` resource attribute. |
| `environment` | — | `OTEL_RESOURCE_ATTRIBUTES` | `deployment.environment` resource attribute. |
| `endpoint` | SDK default (`localhost`) | `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP endpoint (Collector or vendor). |
| `protocol` | `'http/protobuf'` | `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` \| `grpc`. |
| `headers` | — | — | OTLP auth headers for direct-to-vendor export. Static record or `() => record` (runtime token rotation). |
| `samplingRatio` | `1.0` | `OTEL_TRACES_SAMPLER_ARG` | Trace sampling ratio, clamped to 0–1. |
| `shutdownTimeoutMs` | `10000` | — | Graceful-shutdown timeout (ms). |
| `instrumentations` | `[]` | — | Auto-instrumentations passed to NodeSDK. Wins over `useDefaultInstrumentations`. |
| `consoleExport` | `false` | `OTEL_RESILIENT_CONSOLE` | Emit each (already-scrubbed) log record to stdout as single-line JSON, in addition to OTLP. Config wins over env. Enabling on a service that already hand-rolls a console sink will double-log — delete the manual sink when enabling. |
| `useDefaultInstrumentations` | `false` | — | Use the library's pruned allowlist (http, express, nestjs-core, pg, ioredis, redis, undici, runtime-node). Requires `@opentelemetry/auto-instrumentations-node`. Ignored when `instrumentations` is set. |
| `extraInstrumentations` | `[]` | — | Extra instrumentations appended to the default set. Used with `useDefaultInstrumentations`. |
| `disableInstrumentations` | `[]` | — | Package names to remove from the default set (e.g. `['@opentelemetry/instrumentation-pg']`). Used with `useDefaultInstrumentations`. |
| `ignoreIncomingPaths` | — | — | URL patterns (string = substring match, RegExp = test) to exclude from HTTP tracing (e.g. health checks). Used with `useDefaultInstrumentations`. Ignored when `instrumentations` is set. |
| `gracefulShutdown` | `false` | — | Register SIGTERM/SIGINT handlers that call `handle.shutdown()` then exit. Default `false` = consumer wires its own. |
| `diagLogLevel` | `'none'` | — | Set the OTel diag logger level. `'none'` = library does not touch diag (today's behaviour). |

### `handle.scrubber` (when using `scrubberConfig`)

When `scrubberConfig` is provided (and `scrubber` is absent), `init()` builds the scrubber and exposes it on the returned handle. Pass it to `ObservabilityModule.forWiring`:

```typescript
const handle = await init({ scrubberConfig: { mode: 'moderate', extraDenylist: ['my_field'] } });
// handle.scrubber is now the built scrubber instance
ObservabilityModule.forWiring({ scrubber: handle.scrubber! });
```

### `consoleExport` — stdout record shape

Each stdout line is one NDJSON object (keys in stable order):

```json
{
  "timestamp": "2026-06-23T14:22:00.123Z",
  "level": "info",
  "msg": "bankAccount.create completed",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "00f067aa0ba902b7",
  "service": "nest-template",
  "execution_id": "01J...",
  "context_type": "http",
  "http_method": "POST",
  "http_url": "/bank-accounts",
  "signal": "log"
}
```

- `timestamp` — ISO-8601 from the record's `hrTime`.
- `level` — `severityText` (lowercased).
- `msg` — `record.body` (already scrubbed by the upstream scrub stage).
- `trace_id` / `span_id` — from the record's native `spanContext`.
- All remaining keys — flattened, already-scrubbed `record.attributes` (enriched-context fields: `execution_id`, `context_type`, `signal`, etc.).

The console sink is wired behind the single `ScrubLogRecordProcessor`. There is exactly one scrubber for both sinks; the fan-out is structurally downstream of the scrub stage.

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
| _vendor tokens_ | The library reads none. You read your own (e.g. `process.env.VENDOR_TOKEN`) inside the `headers` thunk. See [AXIOM.md](AXIOM.md) for an Axiom example. |
