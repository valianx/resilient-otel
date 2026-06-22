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

`init()` is a no-op (no exporters constructed) unless `OBSERVABILITY_ENABLED=true`, and is force-disabled by the standard `OTEL_SDK_DISABLED=true` kill-switch. When enabled it **requires a real scrubber** (boot guard) — passing none, or `noopScrubber`, throws.

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
  readEnvDenylist: true,                            // also merge LOG_REDACT_EXTRA_FIELDS
});

scrubber.scrubAttrs({ password: 'x', email: 'a@b.com', safe: 'ok' });
// → { password: '[REDACTED]', email: '[REDACTED]', safe: 'ok' }

scrubber.redact('user logged in with password=hunter2 and Bearer eyJ...');
// → secrets + denylisted key=value pairs redacted inline
```

Merge order: `DEFAULT_DENYLIST ∪ extraDenylist ∪ (LOG_REDACT_EXTRA_FIELDS, comma-separated)`.

## Backends

The library emits OTLP and does not care where it lands — that is your Collector's job.

- **Local Collector → Elastic/Grafana/etc.**: set `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317` and `OTEL_EXPORTER_OTLP_PROTOCOL=grpc`.
- **Direct to Axiom**: set `OTEL_EXPORTER_OTLP_ENDPOINT=https://api.axiom.co` (HTTP), and pass `headers: axiomHeaders()` so the `Authorization` + `X-Axiom-Dataset` headers are built at runtime from `AXIOM_TOKEN`/`AXIOM_DATASET` (rotate the token without a code change).

## Environment variable contract

| Variable | Default | Purpose |
|----------|---------|---------|
| `OBSERVABILITY_ENABLED` | `false` | Master switch. `false`/unset → no-op (no exporters constructed). |
| `OTEL_SDK_DISABLED` | _(empty)_ | Standard kill-switch (`true` → no-op). Use for stdio/CLI/batch. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | _(required when enabled)_ | OTLP endpoint (Collector or vendor). |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` | `grpc` or `http/protobuf`. |
| `OTEL_SERVICE_NAME` | _(none)_ | `service.name` resource attribute. |
| `OTEL_RESOURCE_ATTRIBUTES` | _(none)_ | e.g. `deployment.environment=production`. |
| `OTEL_TRACES_SAMPLER_ARG` | `1.0` | Sampling ratio (0.0–1.0). |
| `AXIOM_TOKEN` | _(none)_ | Consumed by `axiomHeaders()` at runtime. |
| `AXIOM_DATASET` | _(none)_ | Consumed by `axiomHeaders()` at runtime. |
| `LOG_SANITIZATION_MODE` | `moderate` | `strict` / `moderate` / `disabled`. |
| `LOG_REDACT_EXTRA_FIELDS` | _(empty)_ | Comma-separated extra denylist terms. |
| `LOG_MAX_STRING_LENGTH` | `1000` | Max individual string length in logs. |
| `LOG_MAX_PAYLOAD_SIZE` | `10000` | Max payload size in bytes. |
| `OTEL_SHUTDOWN_TIMEOUT` | `10000` | Graceful shutdown timeout (ms). |

## Database statement PII

Do **not** enable `enhancedDatabaseReporting` on `@opentelemetry/instrumentation-pg` — it attaches query parameter values. The Scrub SpanProcessor also redacts `db.statement` content as defense-in-depth.

## Stability note

`@opentelemetry/api-logs` (`0.219.0`) is on the experimental track — the Logs Bridge API carries no stability guarantee across minor bumps. The version is pinned; re-test logs after any OTel upgrade.

## License

MIT
