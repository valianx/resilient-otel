# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
