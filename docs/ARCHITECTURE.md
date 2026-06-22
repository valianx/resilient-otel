# Architecture: resilient-otel

## Overview

`resilient-otel` is a framework-agnostic OpenTelemetry library for Node.js. It extracts the observability code from `nest-template/src/observability/` into an installable npm package with three tree-shakeable subpaths.

## Module Dependency Hierarchy

```
types        → (no deps)
utils        → types
config/env   → types
taxonomy     → types
context      → types          (Node async_hooks; R4 runtime guard)
scrub        → types, utils   (hash for size checks)
logbridge    → types, context, taxonomy
metrics      → types
core/*       → types, config, scrub, logbridge (wires scrub processors + log bridge)
nestjs/*     → core, scrub, context, logbridge, utils + PEER @nestjs/*, (optional) winston
```

**Invariant:** `core` may depend on leaf modules; leaf modules never import `core`; `nestjs` is the only module that imports `core` AND a framework. No module imports `nestjs`.

## Subpaths

| Import path | What it provides |
|---|---|
| `resilient-otel` | Core: `init`, `axiomHeaders`, taxonomy enums, metrics factory, log bridge, ALS context, utils |
| `resilient-otel/scrub` | `createScrubber`, `noopScrubber`, denylist, secret patterns, Scrub processors |
| `resilient-otel/nestjs` | `ObservabilityModule.forRoot`, interceptors, middlewares, filter, lifecycle service |
| `resilient-otel/preload` | Node `--import` preload for auto-instrumentation ordering |

## Key Design Decisions

### Registry-based scrubber
The scrubber is a registry of `{name, pattern}` rules plus a denylist Set. Merge order:
`DEFAULT_DENYLIST ∪ extraDenylist ∪ env LOG_REDACT_EXTRA_FIELDS`

This allows runtime extensibility without replacing the entire bank.

### Scrub processors wrap batch exporters
`ScrubSpanProcessor` and `ScrubLogRecordProcessor` sit between the business code and the downstream `BatchSpanProcessor` / `BatchLogRecordProcessor`. Redaction happens on `onEnd` (spans) and `onEmit` (logs) — before any byte leaves the process.

### Boot guard (R5)
`init()` throws when `OBSERVABILITY_ENABLED=true` and the scrubber is absent or is the `noopScrubber` sentinel. This prevents accidentally shipping PII to the collector.

### SDK 2.x API (Research C2)
- `resourceFromAttributes()` — no `schemaUrl` argument (empty schema wins merge, R1 safeguard)
- `LoggerProvider({ processors: [...] })` — not the deprecated `addLogRecordProcessor`
- `NodeSDK({ spanProcessors: [], logRecordProcessors: [], metricReaders: [] })` — plural options

### W3C propagator only (no B3)
B3 is excluded because Istio sidecars inject `x-b3-sampled: 0` on incoming requests, which causes `ParentBasedSampler` to drop all HTTP spans. The app sets its own sampling ratio; B3 propagation is handled at the mesh level.

### Auto-instrumentation ordering (Research C4)
OTel auto-instrumentation patches libraries at module-load time. The SDK must start before `@nestjs/*`, `pg`, `http` are imported. `ObservabilityModule.forRoot()` covers the manual layer; the `resilient-otel/preload` entry covers auto-instrumentation via `node --import`.

### AsyncLocalStorage in core (not nestjs)
The execution context singleton lives in `src/context/` — pure Node `async_hooks`, zero Nest coupling. The NestJS adapter wires it via the `ExecutionContextInterceptor`. Future adapters (Express, Fastify) can use the same singleton.

### Axiom header thunk
`axiomHeaders()` returns a `() => Record<string, string>` evaluated at export time, not at init time. This allows token rotation without code changes.

## OTel Package Classification

| Package | Role |
|---|---|
| `@opentelemetry/api` | Runtime dep + peer dep (dedupe with host app) |
| `@opentelemetry/api-logs` | Runtime dep (alpha — pin exact, see README caveat) |
| `@opentelemetry/sdk-*` | Runtime deps |
| `@opentelemetry/semantic-conventions` | Runtime dep — v1.41.1 (independently versioned) |
| `@opentelemetry/exporter-*-otlp-proto` | Runtime deps (default http/protobuf) |
| `@opentelemetry/exporter-*-otlp-grpc` | Optional peer deps (lazy-loaded) |
| `@nestjs/*`, `winston`, `rxjs` | Optional peer deps — only resolved by nestjs subpath consumers |
