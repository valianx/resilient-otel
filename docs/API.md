# API reference

Exports per subpath, plus the TypeScript types.

## Core (`resilient-otel`)

- `init(config)` — start the SDK; returns `Promise<ShutdownHandle>`
- `register(config)` — Next.js `instrumentation.ts` helper (NEXT_RUNTIME-guarded `init`)
- `axiomHeaders(opts?)` — runtime header thunk for direct-to-Axiom export
- `emitLog(level, data)` — emit a log record through the OTel Logs bridge
- `enrichWithContext(data)` — add trace + execution context to a log record
- `createInstruments(meter?)` — build the standard metric instruments
- `taxonomyAttrs(operation, target)`, `Operation`, `Target`, `SIGNAL_TAG`
- `executionContext` — AsyncLocalStorage execution-context singleton
- `normalizeRoute(path)`, `makeHttpAllowlistFilter(patterns)`
- `hashPayload(value)`, `getPayloadSize(value)`
- `readOtelEnv()` — read the standard `OTEL_*` fallbacks (advanced)

## Scrubber (`resilient-otel/scrub`)

- `createScrubber(config?)` — build a scrubber (`redact`, `scrubAttrs`)
- `noopScrubber` — sentinel for boot-guard testing
- `DEFAULT_DENYLIST`, `DEFAULT_SECRET_PATTERNS`

## NestJS (`resilient-otel/nestjs`)

- `ObservabilityModule.forRoot(config)` — `@Global()` module
- `ExecutionContextInterceptor`, `HttpClientInterceptor`
- `LoggingMiddleware`, `TraceMiddleware`, `HttpExceptionFilter`
- `RequestContext`, `TelemetryLifecycleService`
- `createWinstonOtelTransport(opts)` — optional Winston → OTel bridge

## Preload (`resilient-otel/preload`)

- Node `--import` entry that starts the SDK before app modules load

## TypeScript

Full TypeScript support with exported types:

```typescript
import type {
  ResilientOtelConfig,
  ShutdownHandle,
  MetricsHandles,
  ExecutionCtx,
  ContextType,
  Scrubber,
  ScrubberConfig,
} from 'resilient-otel';
```
