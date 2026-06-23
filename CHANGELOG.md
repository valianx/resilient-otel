# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
