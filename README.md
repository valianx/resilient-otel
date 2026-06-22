# resilient-otel

Framework-agnostic OpenTelemetry for Node.js services. Install one package, give it environment variables, and get traces + logs + metrics with a runtime-extensible PII/secrets scrubber — instead of copy-pasting an observability folder into every project.

- **Backend-agnostic by construction** — the library only emits OTLP. The sink (Axiom, Grafana, SigNoz, Elastic) lives in your Collector, not in your code.
- **Extensible scrubber** — add your own redaction words and secret patterns at runtime; redaction happens *before* export.
- **First-class NestJS and Next.js** — a NestJS DI adapter, and a Next.js `register()` helper for the App Router proxy/BFF layer.
- **Tree-shakeable, dual ESM/CJS, zero framework lock-in in the core.**

## Requirements

- **Node.js >= 22**
- OpenTelemetry JS SDK 2.x line (pinned; see `package.json`)

## Installation

```bash
npm install resilient-otel
```

`@opentelemetry/api` is a peer dependency (so the global API singleton dedupes with your app). Everything else is bundled or optional.

## Entry points

| Import | What it is |
|--------|------------|
| `resilient-otel` | Agnostic core: `init`, `register`, `axiomHeaders`, taxonomy, metrics, log bridge, `executionContext` |
| `resilient-otel/scrub` | The extensible scrubber: `createScrubber`, default denylist + secret bank |
| `resilient-otel/nestjs` | NestJS adapter: `ObservabilityModule`, interceptors, middlewares, lifecycle |
| `resilient-otel/preload` | Node `--import` preload for auto-instrumentation ordering |

## Quick start (any Node service)

```typescript
import { init, axiomHeaders } from 'resilient-otel';
import { createScrubber } from 'resilient-otel/scrub';

const handle = await init({
  serviceName: 'my-service',
  scrubber: createScrubber({ extraDenylist: ['my_custom_field'] }),
  headers: axiomHeaders(), // reads AXIOM_TOKEN / AXIOM_DATASET at call time
});

// graceful shutdown (SIGTERM, etc.)
await handle.shutdown();
```

`init()` is enabled by default; pass `enabled: false` (wire it to your own flag) or set the standard `OTEL_SDK_DISABLED=true` for a no-op with no exporters constructed. When enabled it **requires a real scrubber** (boot guard) — passing none, or `noopScrubber`, throws.

## Auto-instrumentation ordering (required for HTTP/DB spans)

OpenTelemetry patches libraries at **module-load time**, so the SDK must start before your app's modules are imported. Use the Node preload entry:

```bash
node --import resilient-otel/preload ./dist/main.js
```

Manual telemetry (custom spans, the scrubber, the log bridge, lifecycle) works without the preload; only the automatic HTTP/DB/framework patches need it.

## NestJS

```typescript
import { Module } from '@nestjs/common';
import { ObservabilityModule } from 'resilient-otel/nestjs';
import { createScrubber } from 'resilient-otel/scrub';
import { axiomHeaders } from 'resilient-otel';

@Module({
  imports: [
    ObservabilityModule.forRoot({
      scrubber: createScrubber(),
      headers: axiomHeaders(),
    }),
  ],
})
export class AppModule {}
```

`forRoot()` calls core `init()` once and registers graceful shutdown via the Nest lifecycle. For full HTTP/DB auto-instrumentation, still launch with the `--import resilient-otel/preload` entry.

## Next.js (App Router proxy / BFF layer)

The Node OpenTelemetry SDK and `AsyncLocalStorage` cannot run on the Edge runtime, so initialize from the root `instrumentation.ts` `register()` hook, which Next.js 15+ detects automatically. `register()` here is guarded on `NEXT_RUNTIME` and no-ops on Edge.

```typescript
// instrumentation.ts (project root)
import { register as registerOtel } from 'resilient-otel';
import { createScrubber } from 'resilient-otel/scrub';

export async function register() {
  await registerOtel({
    serviceName: 'web-proxy',
    scrubber: createScrubber({ extraDenylist: ['internal_token'] }),
    headers: { /* or axiomHeaders() */ },
  });
}
```

Ensure your proxy Route Handlers run on the Node runtime:

```typescript
// app/api/[...path]/route.ts
import { trace } from '@opentelemetry/api';
import { createScrubber } from 'resilient-otel/scrub';
import { emitLog, taxonomyAttrs, Operation, Target } from 'resilient-otel';

export const runtime = 'nodejs'; // required: the SDK is Node-only

const scrubber = createScrubber();
const tracer = trace.getTracer('web-proxy');

export async function POST(req: Request) {
  return tracer.startActiveSpan('proxy.forward', async (span) => {
    const body = await req.json();
    emitLog('info', {
      msg: 'proxy_request',
      ...taxonomyAttrs(Operation.Request, Target.External),
      body: scrubber.scrubAttrs(body), // redact PII/secrets before it hits telemetry
    });
    try {
      const upstream = await fetch('https://backend.internal/resource', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      span.setStatus({ code: 1 }); // OK
      return new Response(await upstream.text(), { status: upstream.status });
    } finally {
      span.end();
    }
  });
}
```

`fetch` calls in the proxy are auto-traced once the SDK is registered; the scrubber keeps request/response payloads clean in logs.

## The scrubber

Registry-based and runtime-extensible — the headline feature. Default PII field denylist + a secret-regex bank (Axiom, Anthropic, OpenAI, GitHub PAT, Stripe, AWS, Slack, JWT Bearer, RSA keys). Add your own on top, via config and/or env.

```typescript
import { createScrubber } from 'resilient-otel/scrub';

const scrubber = createScrubber({
  mode: 'strict',                                   // strict | moderate | disabled
  extraDenylist: ['my_secret_field'],               // merged onto the default denylist
  extraSecretPatterns: [/my-prefix-[A-Za-z0-9]{32}/], // merged onto the secret bank
});

scrubber.scrubAttrs({ password: 'x', email: 'a@b.com', safe: 'ok' });
// → { password: '[REDACTED]', email: '[REDACTED]', safe: 'ok' }

scrubber.redact('user logged in with password=hunter2 and Bearer eyJ...');
// → secrets + denylisted key=value pairs redacted inline
```

Merge order: `DEFAULT_DENYLIST ∪ extraDenylist`.

## Backends

The library emits OTLP and does not care where it lands — that is your Collector's job.

- **Local Collector → Elastic/Grafana/etc.**: set `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317` and `OTEL_EXPORTER_OTLP_PROTOCOL=grpc`.
- **Direct to Axiom**: set `OTEL_EXPORTER_OTLP_ENDPOINT=https://api.axiom.co` (HTTP), and pass `headers: axiomHeaders()` so the `Authorization` + `X-Axiom-Dataset` headers are built at runtime from `AXIOM_TOKEN`/`AXIOM_DATASET` (rotate the token without a code change).

## Configuration

The library is **config-first**: it reads **no environment variables of its own**. All
instance configuration is passed to `init()` and `createScrubber()`, and every field has a
default — you wire values from wherever you like (your own env, config system, hardcoded).

`init(config)` fields:

| Field | Default | Purpose |
|-------|---------|---------|
| `enabled` | `true` | Master switch. `false` → no-op. Wire to your own flag. |
| `scrubber` | _(required)_ | Boot guard — build with `createScrubber()`. |
| `serviceName` | `OTEL_SERVICE_NAME` → `'unknown-service'` | `service.name`. |
| `serviceVersion` | `'0.0.0'` | `service.version`. |
| `environment` | _(none)_ | `deployment.environment`. |
| `endpoint` | `OTEL_EXPORTER_OTLP_ENDPOINT` → SDK default | OTLP endpoint. |
| `protocol` | `OTEL_EXPORTER_OTLP_PROTOCOL` → `'http/protobuf'` | `grpc` or `http/protobuf`. |
| `headers` | _(none)_ | Static record or runtime thunk (e.g. `axiomHeaders()`). |
| `samplingRatio` | `OTEL_TRACES_SAMPLER_ARG` → `1.0` | Trace sampling ratio (0–1). |
| `shutdownTimeoutMs` | `10000` | Graceful-shutdown timeout. |
| `instrumentations` | `[]` | Auto-instrumentations to register. |

`createScrubber(config)` fields: `mode` (`'moderate'`), `extraDenylist` (`[]`),
`extraSecretPatterns` (`[]`), `replacement` (`'[REDACTED]'`), `maxStringLength` (`1000`).

### The only env vars involved — standard OpenTelemetry `OTEL_*`

These are **not** our names; they are the OpenTelemetry spec's, read by the underlying SDK.
Config values **win**; these fill the gap when a field is omitted:

| Variable | Maps to |
|----------|---------|
| `OTEL_SDK_DISABLED=true` | Standard kill-switch → no-op (in addition to `enabled: false`). |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `endpoint` |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `protocol` |
| `OTEL_SERVICE_NAME` | `serviceName` |
| `OTEL_RESOURCE_ATTRIBUTES` | extra resource attributes (read by the SDK) |
| `OTEL_TRACES_SAMPLER_ARG` | `samplingRatio` |
| `AXIOM_TOKEN` / `AXIOM_DATASET` | read by `axiomHeaders()` only, at call time |

## Database statement PII

Do **not** enable `enhancedDatabaseReporting` on `@opentelemetry/instrumentation-pg` — it attaches query parameter values. The Scrub SpanProcessor also redacts `db.statement` content as defense-in-depth.

## Stability note

`@opentelemetry/api-logs` (`0.219.0`) is on the experimental track — the Logs Bridge API carries no stability guarantee across minor bumps. The version is pinned; re-test logs after any OTel upgrade.

## License

MIT
