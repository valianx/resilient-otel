# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial release: agnostic core (`resilient-otel`) with SDK init, extensible scrubber, taxonomy, metrics, log bridge, propagation, sampling, and AsyncLocalStorage context.
- Scrub subpath (`resilient-otel/scrub`) with registry-based PII/secrets redactor, default denylist, and secret regex bank.
- NestJS adapter (`resilient-otel/nestjs`) with interceptors, middlewares, exception filter, module, and Winston transport.
- Preload entry (`resilient-otel/preload`) for Node `--import` auto-instrumentation ordering.
