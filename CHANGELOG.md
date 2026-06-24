# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.1] - 2026-06-24

### Fixed

- **`LoggingMiddleware` and `HttpExceptionFilter` are now fail-open — observability never crashes the request path.** An OpenTelemetry/scrub/emit failure may at most drop a log line; it can no longer fail the consuming application's transaction or crash the process. Discovered while migrating a payments service to `resilient-otel`, where the hard requirement is "observability must never crash the service or affect transactions."

  - **`LoggingMiddleware.use()` is wrapped in `try/catch`.** Span setup, scrubbing, and `emitLog()` ran *before* `next()` with no guard; a throw there propagated into the request and failed the transaction. The telemetry is now best-effort and `next()` is always reached. Downstream errors still propagate normally (the `next()` call is intentionally outside the guard).
  - **The deferred `res.on('finish')` handler is guarded.** A throw in that listener fired *after* the synchronous scope and risked an `uncaughtException` / process crash; it is now caught and the span is always ended.
  - **`HttpExceptionFilter.catch()` telemetry is guarded.** The HTTP status/body are computed first and the error response is always sent, even if scrubbing or `emitLog()` throws — the error handler can no longer become a crash on every failing request.
  - **An `undefined` scrubber can no longer crash every request.** When the SDK is disabled (`config.enabled === false` or the standard `OTEL_SDK_DISABLED=true`), `init()` now exposes a valid scrubber on the returned handle, so `ObservabilityModule.forWiring({ scrubber: handle.scrubber })` never wires `undefined`. As defense in depth, `forWiring()` falls back to `createScrubber()` when no scrubber is supplied, and `LoggingMiddleware`/`HttpExceptionFilter` default to a real redactor when constructed without one.

  No public API changes. The SDK enable/disable behavior is unchanged: the SDK runs by default and is disabled only by `config.enabled === false` or `OTEL_SDK_DISABLED=true`.

## [0.3.0] - 2026-06-24

### ⚠ BEHAVIOR CHANGE — default log-attribute output

**`serializeComplexAttributes` defaults to `true` (was implicitly absent in 0.2.0).**

Starting from this release, `init()` serializes complex log attribute values (nested objects) to JSON strings **by default**. This changes the default output of every `emitLog()` / `emitLog(level, { ..., error: errObject })` call:

| Attribute before | Attribute after (default) |
|-----------------|--------------------------|
| `error: { code: 500, detail: {...} }` (nested object) | `error: '{"code":500,"detail":{...}}'` (JSON string) |
| `metadata: { ... }` (nested object) | `metadata: '{"..."}'` (JSON string) |
| `body: '{"pre":"stringified"}'` (already a string) | unchanged (idempotent) |
| `signal: 'log'` (scalar) | unchanged |

**Who is affected:** consumers on backends that **do not** require flat attributes (e.g. Grafana Loki, SigNoz, Axiom, or any custom pipeline that expects nested objects). **Elastic Cloud** consumers are unaffected — this is the format Elastic requires.

**Opt out** (restores 0.2.0 behavior exactly):
```typescript
await init({ ..., serializeComplexAttributes: false });
// or:
// OTEL_RESILIENT_SERIALIZE_ATTRS=false
```

---

### Added

- **Elastic-safe log attribute serialization (new `serializeComplexAttributes` option, default `true`).** `init()` now serializes complex log attribute values to JSON strings before export. Serializes the named set `{ body, headers, metadata, error, exception }` and any other non-array object attribute (catch-all); scalars, arrays, and already-stringified strings pass through unchanged. `signal: 'log'` and native `trace_id`/`span_id` are unaffected.

  The new `SerializeLogRecordProcessor` is wired strictly **after** `ScrubLogRecordProcessor` and **above** the fan-out, so:
  - PII redaction (e.g. `body.password → '[REDACTED]'`) is always structural, never lost to an opaque string.
  - Both the OTLP-batch and the optional stdout exporter receive the identical serialized record.
  - Unserializable values (circular references, BigInt, throwing getters) are replaced with `'[UNSERIALIZABLE]'` — the pipeline never crashes.

  To disable: set `serializeComplexAttributes: false` in config, or `OTEL_RESILIENT_SERIALIZE_ATTRS=false` as an env var.

  > **Contraindication:** using `mode: 'disabled'` with serialization enabled exports nested PII as fully-indexed JSON strings without redaction. The library emits `diag.warn` at startup when this combination is detected.

## [0.2.0]

### Added

- **Dual-sink scrubbed console exporter (opt-in).** `init()` now accepts `consoleExport: true` (or `OTEL_RESILIENT_CONSOLE=true` env fallback) to emit each log record to stdout as single-line NDJSON in addition to OTLP. The console sink sits behind the same single `ScrubLogRecordProcessor` as the OTLP path — records are scrubbed exactly once then fanned out to both sinks via the new `FanOutLogRecordProcessor`. It is structurally impossible for unscrubbed content to reach stdout. Default: `false` (no behaviour change for existing consumers). See [CONFIG.md](docs/CONFIG.md) for the full option reference and stdout record shape.

- **Library-owned default instrumentation set (opt-in).** Set `useDefaultInstrumentations: true` to replace the ~25-line `enabled:false` block in `instrumentation.ts` with the library's maintained pruned allowlist (http, express, nestjs-core, pg, ioredis, redis, undici, runtime-node). Combine with `extraInstrumentations` to append extras and `disableInstrumentations` to remove specific packages. Requires `@opentelemetry/auto-instrumentations-node` as an optional peer dep; absent → `diag.warn` + empty set (never throws). The explicit `instrumentations` array still takes precedence when provided.

- **`ignoreIncomingPaths` option.** Pass `ignoreIncomingPaths: [/.*\/health\/status/]` together with `useDefaultInstrumentations: true` to drop health-check routes from HTTP tracing, replacing the hand-rolled `HttpInstrumentation({ ignoreIncomingRequestHook })`.

- **`gracefulShutdown` option.** Set `gracefulShutdown: true` for `init()` to register SIGTERM and SIGINT handlers that call `handle.shutdown()` then `process.exit(0)`. Default `false` preserves today's behaviour (consumer wires its own). The shutdown handle is idempotent; a double-signal is safe.

- **`scrubberConfig` option + `handle.scrubber`.** Pass `scrubberConfig: { mode, extraDenylist }` instead of a pre-built `scrubber` and `init()` builds it internally, exposing the instance as `handle.scrubber`. Pass `handle.scrubber` to `ObservabilityModule.forWiring({ scrubber: handle.scrubber })`, eliminating the separate `createScrubber()` call and the double-threading. The explicit `scrubber` field still takes precedence when both are provided; absent-both still throws the boot guard error.

- **`diagLogLevel` option.** Set `diagLogLevel: 'info'` (or `'error'|'warn'|'debug'`) to have `init()` call `diag.setLogger(new DiagConsoleLogger(), ...)`. Default `'none'` means the library never touches the OTel diagnostic logger (today's behaviour).

- **`FanOutLogRecordProcessor` and `ConsoleLogRecordExporter` (internal).** Both are internal to the `index` bundle; no new entry point or `exports` map change.

### Fixed

- **`mode: 'disabled'` now returns body text unredacted.** Previously, `redactString` (used for log body text) had no disabled-mode guard, so `key=value` inline patterns and secret regexes were still applied to body text even with `mode: 'disabled'`. Only attribute redaction (`scrubAttrs`) short-circuited correctly. Both now short-circuit consistently: a disabled scrubber is a full no-op for attributes AND body text. **Behaviour change for `mode: 'disabled'` consumers:** body text that previously had inline patterns replaced now passes through raw. This is intentional — `disabled` means "no redaction anywhere".

- **Console exporter: fixed semantic fields now always win over same-named attributes.** If a log record carried an attribute named `timestamp`, `trace_id`, `span_id`, `level`, or `msg`, it previously overwrote the authoritative value derived from `hrTime` / `spanContext` / `severityText` / `body`. Fixed: attributes are spread first, then the authoritative derived values overwrite them. Tracing queries that rely on `trace_id` / `span_id` being from `spanContext` are no longer at risk of receiving an arbitrary attribute value.

### Migration note

Existing consumers that pass `instrumentations`, `scrubber`, and wire their own SIGTERM handlers see zero change — all new options are absent-by-default. Enabling `consoleExport: true` on a consumer that already hand-rolls a `console.log` sink will double-log; delete the manual sink when enabling.

`mode: 'disabled'` consumers: if your log bodies contained inline `key=value` patterns that were previously being redacted even in disabled mode, those will now appear raw. If you relied on that partial redaction, switch to `mode: 'moderate'`.

## [0.1.4]

### Fixed
- **`nestjs/LoggingMiddleware` now logs the real elapsed request `duration`.** It was logging `Date.now()` (a Unix epoch in ms, ~1.7e12) instead of elapsed time, so every "duration" field was unusable for latency. It now captures `start` at request entry and logs `Date.now() - start`. Covered by a regression test.

### Added
- **`nestjs/LoggingMiddleware` reached parity with the reference adapter.** It now opens a per-request `HTTP Request: …` child span (active for the request lifetime, carrying `http.status_code`/`http.status_message`, ended on `finish`) and logs the request body, response headers and response size — all scrubbed.
- **`ObservabilityModule.forWiring({ scrubber })`** — a second entry point that wires the DI providers (interceptor, middleware, filter, execution-context) **without** calling `init()`. For apps that initialise the SDK earlier in a preload step (an `instrumentation.ts` awaited before the app modules load, required so auto-instrumentation patches http/pg/redis before they are first required). `forRoot()` keeps owning the full lifecycle (init + graceful shutdown) and is unchanged.

## [0.1.3]

### Fixed
- **Spans now carry `signal: 'trace'`.** A new `SignalSpanProcessor` tags every span at start, making traces symmetric with logs (`signal: 'log'`) so `where ['attributes.signal'] == 'trace'` partitions telemetry by signal. Validated e2e.
- **AsyncLocalStorage execution-context is now a process-wide singleton.** It was a per-bundle module singleton, so a context opened by the NestJS adapter was invisible to the core log bridge and enrichment came back empty. The store is now keyed on `globalThis` via `Symbol.for`, shared across the core/scrub/nestjs bundles (same fix family as the scrubber brand and the log bridge).
- **`nestjs/http-client.interceptor` no longer injects `trace_id`/`span_id` as custom attributes.** It emits each log inside the relevant span's context, so the SDK stamps the native `trace_id`/`span_id` — completing the native-correlation audit started for the log bridge in 0.1.2.

These resolve the three known issues tracked in `docs/ROADMAP.md`; they are now at zero.

## [0.1.2]

### Fixed
- **Sampler now honors the head/ingress decision.** It no longer re-samples not-sampled remote parents (`remoteParentNotSampled` override removed), so a `traceparent` with `…-00` is dropped at every downstream hop — a trace stays consistent across services instead of producing orphaned "loose" spans. Validated by a multi-hop propagation e2e.
- **Log↔trace correlation uses native fields.** `emitLog` passes the active context so the SDK populates the LogRecord's native `trace_id`/`span_id`; these are no longer duplicated as custom attributes (the OTel/ECS-standard way; backends correlate on the native fields).

### Added
- `docs/GOVERNANCE.md` — data governance & naming contract (correlation, attribute naming, sampling, redaction).

## [0.1.1]

### Fixed
Critical export-path fixes found by an end-to-end test (NestJS app → real OpenTelemetry Collector). `0.1.0` could not export to a Collector for a real consumer; `0.1.1` is the first working release.

- **Scrubber boot guard falsely rejected real scrubbers.** The brand symbol used `Symbol()` (unique per bundle); `createScrubber` (the `/scrub` bundle) and `init`'s guard (`/core`, `/nestjs`) saw different symbols. Now a global `Symbol.for()`.
- **`init()` crashed on start** with "MetricReader can not be bound to a MeterProvider again" — the metric reader was bound to both a standalone MeterProvider and NodeSDK.
- **Exports never reached the Collector.** The OTLP/HTTP exporter `url` is the complete signal URL and is not auto-suffixed; `endpoint` now appends `/v1/traces|logs|metrics`.
- **Logs were dropped or unredacted.** The log bridge used a per-bundle module singleton (now the global logs API), and when `OTEL_*` env was set NodeSDK registered its own unscrubbed global logger provider. NodeSDK now owns all three signals with the scrub processors injected; log attributes are redacted via `setAttributes`.

## [0.1.0]

### Added

- Initial release: agnostic core (`resilient-otel`) with SDK init, extensible scrubber, taxonomy, metrics, log bridge, propagation, sampling, and AsyncLocalStorage context.
- Scrub subpath (`resilient-otel/scrub`) with registry-based PII/secrets redactor, default denylist, and secret regex bank.
- NestJS adapter (`resilient-otel/nestjs`) with interceptors, middlewares, exception filter, module, and Winston transport.
- Preload entry (`resilient-otel/preload`) for Node `--import` auto-instrumentation ordering.
