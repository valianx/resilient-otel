# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0]

### Added

- **Dual-sink scrubbed console exporter (opt-in).** `init()` now accepts `consoleExport: true` (or `OTEL_RESILIENT_CONSOLE=true` env fallback) to emit each log record to stdout as single-line NDJSON in addition to OTLP. The console sink sits behind the same single `ScrubLogRecordProcessor` as the OTLP path — records are scrubbed exactly once then fanned out to both sinks via the new `FanOutLogRecordProcessor`. It is structurally impossible for unscrubbed content to reach stdout. Default: `false` (no behaviour change for existing consumers). See [CONFIG.md](docs/CONFIG.md) for the full option reference and stdout record shape.

- **Library-owned default instrumentation set (opt-in).** Set `useDefaultInstrumentations: true` to replace the ~25-line `enabled:false` block in `instrumentation.ts` with the library's maintained pruned allowlist (http, express, nestjs-core, pg, ioredis, redis, undici, runtime-node). Combine with `extraInstrumentations` to append extras and `disableInstrumentations` to remove specific packages. Requires `@opentelemetry/auto-instrumentations-node` as an optional peer dep; absent → `diag.warn` + empty set (never throws). The explicit `instrumentations` array still takes precedence when provided.

- **`ignoreIncomingPaths` option.** Pass `ignoreIncomingPaths: [/.*\/health\/status/]` together with `useDefaultInstrumentations: true` to drop health-check routes from HTTP tracing, replacing the hand-rolled `HttpInstrumentation({ ignoreIncomingRequestHook })`.

- **`gracefulShutdown` option.** Set `gracefulShutdown: true` for `init()` to register SIGTERM and SIGINT handlers that call `handle.shutdown()` then `process.exit(0)`. Default `false` preserves today's behaviour (consumer wires its own). The shutdown handle is idempotent; a double-signal is safe.

- **`scrubberConfig` option + `handle.scrubber`.** Pass `scrubberConfig: { mode, extraDenylist }` instead of a pre-built `scrubber` and `init()` builds it internally, exposing the instance as `handle.scrubber`. Pass `handle.scrubber` to `ObservabilityModule.forWiring({ scrubber: handle.scrubber })`, eliminating the separate `createScrubber()` call and the double-threading. The explicit `scrubber` field still takes precedence when both are provided; absent-both still throws the boot guard error.

- **`diagLogLevel` option.** Set `diagLogLevel: 'info'` (or `'error'|'warn'|'debug'`) to have `init()` call `diag.setLogger(new DiagConsoleLogger(), ...)`. Default `'none'` means the library never touches the OTel diagnostic logger (today's behaviour).

- **`FanOutLogRecordProcessor` and `ConsoleLogRecordExporter` (internal).** Both are internal to the `index` bundle; no new entry point or `exports` map change.

### Migration note

Existing consumers that pass `instrumentations`, `scrubber`, and wire their own SIGTERM handlers see zero change — all new options are absent-by-default. Enabling `consoleExport: true` on a consumer that already hand-rolls a `console.log` sink will double-log; delete the manual sink when enabling.

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

## [Unreleased]

### Added
- Initial release: agnostic core (`resilient-otel`) with SDK init, extensible scrubber, taxonomy, metrics, log bridge, propagation, sampling, and AsyncLocalStorage context.
- Scrub subpath (`resilient-otel/scrub`) with registry-based PII/secrets redactor, default denylist, and secret regex bank.
- NestJS adapter (`resilient-otel/nestjs`) with interceptors, middlewares, exception filter, module, and Winston transport.
- Preload entry (`resilient-otel/preload`) for Node `--import` auto-instrumentation ordering.
