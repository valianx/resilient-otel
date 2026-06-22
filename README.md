# Resilient OTEL

A config-first OpenTelemetry library for Node.js services: SDK init, an extensible PII/secrets scrubber, taxonomy, metrics, log bridge, plus a NestJS adapter and a Next.js helper.

Works with **Node.js 22+**. Install one package, pass config, stop copying an observability folder into every project.

## Features

- **One-call setup**: `init(config)` wires traces + logs + metrics, returns a graceful-shutdown handle
- **Extensible scrubber**: redact your own fields and secret patterns at runtime — before anything is exported
- **Backend-agnostic**: emits OTLP only; the sink (Axiom, Grafana, SigNoz, Elastic) is your Collector's concern
- **Config-first**: the library reads no env vars of its own; every option is a typed field with a default
- **NestJS adapter**: `ObservabilityModule.forRoot()` with interceptors, middlewares, and lifecycle
- **Next.js ready**: `register()` for the App Router `instrumentation.ts` proxy/BFF layer
- **Tree-shakeable**: import only the subpath you need
- **TypeScript first**: full type definitions included

## Installation

```bash
# npm
npm install resilient-otel

# yarn
yarn add resilient-otel

# pnpm
pnpm add resilient-otel
```

`@opentelemetry/api` is a peer dependency (so the global API singleton dedupes with your app).

## Quick Start

```typescript
import { init, axiomHeaders } from 'resilient-otel';
import { createScrubber } from 'resilient-otel/scrub';

const handle = await init({
  serviceName: 'my-service',
  scrubber: createScrubber({ extraDenylist: ['internal_account_id'] }),
  headers: axiomHeaders(), // optional: direct-to-Axiom header thunk
});

// flush + shut down telemetry on termination
process.on('SIGTERM', () => handle.shutdown());
```

For automatic HTTP/DB instrumentation, launch with the preload entry (patching must happen before your modules load):

```bash
node --import resilient-otel/preload ./dist/main.js
```

## init

`init(config)` starts the SDK and returns a `{ shutdown }` handle. Every field has a default; config wins over the standard `OTEL_*` env vars, which win over the built-in default.

```typescript
import { init } from 'resilient-otel';
import { createScrubber } from 'resilient-otel/scrub';

const handle = await init({
  enabled: true,                  // master switch (default: true) — wire to your own flag
  scrubber: createScrubber(),     // required (boot guard) — throws if missing
  serviceName: 'my-service',      // default: OTEL_SERVICE_NAME → 'unknown-service'
  serviceVersion: '1.4.0',        // default: '0.0.0'
  environment: 'production',      // deployment.environment attribute
  endpoint: 'http://otel:4318',   // default: OTEL_EXPORTER_OTLP_ENDPOINT
  protocol: 'http/protobuf',      // 'http/protobuf' (default) | 'grpc'
  headers: { 'x-key': 'value' },  // record, or () => record for runtime rotation
  samplingRatio: 1.0,             // default: OTEL_TRACES_SAMPLER_ARG → 1.0
  shutdownTimeoutMs: 10000,       // graceful-shutdown timeout
  instrumentations: [],           // auto-instrumentations to register
});

await handle.shutdown();
```

`init()` is a no-op (no exporters constructed) when `enabled: false` or the standard `OTEL_SDK_DISABLED=true`.

## Scrubber

The scrubber redacts PII and secrets from span/log attributes and free-text bodies, **before export**. It is registry-based and runtime-extensible: a built-in PII field denylist and a secret-regex bank (Axiom, Anthropic, OpenAI, GitHub PAT, Stripe, AWS, Slack, JWT Bearer, RSA keys), plus your own.

```typescript
import { createScrubber } from 'resilient-otel/scrub';

const scrubber = createScrubber({
  mode: 'moderate',                                   // 'strict' | 'moderate' | 'disabled'
  extraDenylist: ['internal_account_id'],             // merged onto DEFAULT_DENYLIST
  extraSecretPatterns: [/acme-[A-Za-z0-9]{32}/],      // merged onto the secret bank
  replacement: '[REDACTED]',                          // replacement string
  maxStringLength: 1000,                              // truncate long strings (strict mode)
});

scrubber.scrubAttrs({ password: 'x', email: 'a@b.com', safe: 'ok' });
// → { password: '[REDACTED]', email: '[REDACTED]', safe: 'ok' }

scrubber.redact('login password=hunter2 token Bearer eyJ...');
// → secrets + denylisted key=value pairs redacted inline
```

Redaction is wired into the SDK as a `ScrubSpanProcessor` + `ScrubLogRecordProcessor` that wrap the downstream batch exporters, so nothing leaves the process unredacted. `init()` refuses to start without a real scrubber (passing none, or `noopScrubber`, throws).

## NestJS

`ObservabilityModule.forRoot()` calls core `init()` once and registers graceful shutdown via the Nest lifecycle.

```typescript
import { Module } from '@nestjs/common';
import { ObservabilityModule } from 'resilient-otel/nestjs';
import { createScrubber } from 'resilient-otel/scrub';

@Module({
  imports: [
    ObservabilityModule.forRoot({
      serviceName: 'nest-service',
      scrubber: createScrubber(),
    }),
  ],
})
export class AppModule {}
```

For full HTTP/DB auto-instrumentation, still launch with `--import resilient-otel/preload`.

## Next.js

The Node SDK and `AsyncLocalStorage` cannot run on the Edge runtime, so initialize from the root `instrumentation.ts` `register()` hook (Next.js 15+ auto-detects it). `register()` is `NEXT_RUNTIME`-guarded and no-ops on Edge.

```typescript
// instrumentation.ts (project root)
import { register as registerOtel } from 'resilient-otel';
import { createScrubber } from 'resilient-otel/scrub';

export async function register() {
  await registerOtel({ serviceName: 'web-proxy', scrubber: createScrubber() });
}
```

In a proxy/BFF Route Handler (Node runtime), trace and scrub the forwarded payload:

```typescript
// app/api/[...path]/route.ts
import { trace } from '@opentelemetry/api';
import { createScrubber } from 'resilient-otel/scrub';
import { emitLog, taxonomyAttrs, Operation, Target } from 'resilient-otel';

export const runtime = 'nodejs'; // required: the SDK is Node-only

const scrubber = createScrubber();

export async function POST(req: Request) {
  return trace.getTracer('web-proxy').startActiveSpan('proxy.forward', async (span) => {
    const body = await req.json();
    emitLog('info', {
      msg: 'proxy_request',
      ...taxonomyAttrs(Operation.Request, Target.External),
      body: scrubber.scrubAttrs(body),
    });
    const upstream = await fetch('https://backend.internal/resource', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    span.end();
    return new Response(await upstream.text(), { status: upstream.status });
  });
}
```

## Backends

The library emits OTLP and does not care where it lands — that is your Collector's job.

```typescript
// Local Collector (no auth) → Elastic/Grafana/etc.
await init({ serviceName: 'svc', scrubber: createScrubber(),
  endpoint: 'http://otel-collector:4317', protocol: 'grpc' });

// Direct to Axiom (headers built at runtime from AXIOM_TOKEN / AXIOM_DATASET)
await init({ serviceName: 'svc', scrubber: createScrubber(),
  endpoint: 'https://api.axiom.co', headers: axiomHeaders() });
```

## Taxonomy

Tag spans and logs with the two-axis flow taxonomy (`operation` × `target`) for cross-flow queries.

```typescript
import { taxonomyAttrs, Operation, Target } from 'resilient-otel';

taxonomyAttrs(Operation.Error, Target.External);
// → { operation: 'error', target: 'external', signal: 'log' }
```

- `Operation`: `Request` | `Response` | `Error`
- `Target`: `Client` | `External` | `Store` | `Internal` (pass a custom string for finer values)

## API Reference

### Core (`resilient-otel`)

- `init(config)` — start the SDK; returns `Promise<ShutdownHandle>`
- `register(config)` — Next.js `instrumentation.ts` helper (NEXT_RUNTIME-guarded `init`)
- `axiomHeaders(opts?)` — runtime header thunk for direct-to-Axiom export
- `emitLog(level, data)` — emit a log record through the OTel Logs bridge
- `enrichWithContext(data)` — add trace + execution context to a log record
- `createInstruments(meter?)` — build the standard metric instruments
- `taxonomyAttrs(operation, target)`, `Operation`, `Target`, `SIGNAL_TAG`
- `executionContext` — AsyncLocalStorage execution-context singleton
- `normalizeRoute(path)`, `makeHttpAllowlistFilter(patterns)`
- `readOtelEnv()` — read the standard `OTEL_*` fallbacks (advanced)

### Scrubber (`resilient-otel/scrub`)

- `createScrubber(config?)` — build a scrubber (`redact`, `scrubAttrs`)
- `noopScrubber` — sentinel for boot-guard testing
- `DEFAULT_DENYLIST`, `DEFAULT_SECRET_PATTERNS`

### NestJS (`resilient-otel/nestjs`)

- `ObservabilityModule.forRoot(config)` — `@Global()` module
- `ExecutionContextInterceptor`, `HttpClientInterceptor`
- `LoggingMiddleware`, `TraceMiddleware`, `HttpExceptionFilter`
- `RequestContext`, `TelemetryLifecycleService`
- `createWinstonOtelTransport(opts)` — optional Winston → OTel bridge

### Preload (`resilient-otel/preload`)

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

## License

MIT
