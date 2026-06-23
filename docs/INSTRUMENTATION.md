# Instrumentation guide

There are two layers, and you usually use both:

- **Auto-instrumentation** — OpenTelemetry patches a library (http, pg, redis, kafkajs…) so its calls become spans automatically.
- **Manual instrumentation** — you create your own spans, logs, and metrics for business operations.

`resilient-otel` is the pipeline (export + redaction + propagation + lifecycle). Auto-instrumentation packages do the patching; manual instrumentation is the OTel API plus the helpers this library exports.

---

## Use cases

| Use case | Auto-instrumentation | Manual |
|----------|---------------------|--------|
| HTTP API (incoming/outgoing) | `@opentelemetry/instrumentation-http` | custom span per business op + `emitLog` |
| NestJS controllers | `@opentelemetry/instrumentation-nestjs-core` + the `resilient-otel/nestjs` adapter | — |
| Postgres / MySQL / Mongo | `instrumentation-pg` / `-mysql2` / `-mongodb` | — (db.statement is automatic) |
| Redis | `instrumentation-ioredis` / `-redis` | — |
| Kafka / RabbitMQ / SQS | `instrumentation-kafkajs` / `-amqplib` / aws-sdk | — |
| GCP Pub/Sub | _no official instrumentation_ | **manual** span + `traceparent` in message attributes (see Propagation) |
| Proxy / BFF (Next.js, gateway) | http instrumentation | manual span around the forwarded call |
| Background jobs / cron | — | manual root span per job run |
| AI agent (LLM/tool calls) | optional (OpenLLMetry) via `instrumentations` | manual span per step + `gen_ai.*` attrs (see [ROADMAP.md](ROADMAP.md)) |

---

## What you install

The **core pipeline is bundled** as dependencies — `npm install resilient-otel` gives you traces + logs + metrics over OTLP/HTTP and the scrubber with **no extra installs** (the OTel SDK, the http/protobuf exporters, and `@opentelemetry/api` come with it).

You add packages **only for opt-in features** (declared as optional peer deps, so they're never force-installed):

| Feature | Install |
|---------|---------|
| Auto-instrumentation (pg / http / redis / kafka …) | the specific `@opentelemetry/instrumentation-*` (or `@opentelemetry/auto-instrumentations-node`) |
| gRPC transport | `@opentelemetry/exporter-{trace,logs,metrics}-otlp-grpc` + `@grpc/grpc-js` |
| NestJS adapter (`resilient-otel/nestjs`) | `@nestjs/common`, `@nestjs/core` (+ `rxjs`) — usually already in a Nest app |
| Winston bridge | `winston`, `winston-transport` |

> If you `import { trace }`/`metrics` from `@opentelemetry/api` directly for manual instrumentation, also add `@opentelemetry/api` to your own `dependencies` (it's shipped + a peer; explicit is required under pnpm-strict).

## Compatibility — does every instrumentation work?

**In principle, yes.** `init()` forwards `instrumentations` straight to the standard `NodeSDK` (`registerInstrumentations`), and the scrub processors wrap the SDK's batch exporters — so any OpenTelemetry `Instrumentation` (the `@opentelemetry/instrumentation-*` contrib packages, `auto-instrumentations-node`, `@vercel/otel`, OpenLLMetry, …) is compatible and its telemetry is redacted, correlated, and shut down by the same pipeline. Nothing in this library special-cases or blocks an instrumentation.

Honest caveats (none are resilient-otel-specific — they're OTel ecosystem rules):

- **Opt-in, not automatic** — you must register + preload it; installing the dep does nothing (see below).
- **Each instrumentation has its own version support** for the target library (e.g. `instrumentation-pg` supports `pg` 8.x). That contract is between the instrumentation and the library, not us.
- **ESM apps need OTel's import hook** — auto-instrumentation reliably patches CommonJS (`require-in-the-middle`); for pure-ESM you also need `import-in-the-middle` / a `--loader`. This is an OTel-wide caveat.
- **Not bundled** — "works with" means compatible, not included; you install the ones you use.

**Tested status (be precise):** the pipeline *accepts and forwards* instrumentations (validated), but specific auto-instrumentations (pg/redis/queues) are **not yet validated end-to-end** — that needs the preload-based harness (see [ROADMAP.md](ROADMAP.md)). Auto-instrumented spans also won't carry the manual `operation`/`target`/`signal` taxonomy (that's set by hand); their native span data is standard.

## Activating auto-instrumentation

> **Installing the package does NOT activate it.** An instrumentation only runs when you **register** it. And registration must happen **before the target library is loaded**, because it patches the module loader.

### 1. Install the instrumentation(s) you use

```bash
npm install @opentelemetry/instrumentation-http @opentelemetry/instrumentation-pg
```

### 2. Register them — per service, only what you use

```typescript
import { init } from 'resilient-otel';
import { createScrubber } from 'resilient-otel/scrub';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';

await init({
  scrubber: createScrubber(),
  instrumentations: [
    new HttpInstrumentation(),
    new PgInstrumentation(), // db.statement captured; keep enhancedDatabaseReporting OFF
  ],
});
```

A service that doesn't register `pg` won't trace pg even if it's installed. For "everything," use `@opentelemetry/auto-instrumentations-node` → `getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-fs': { enabled: false } })`.

### 3. Launch with the preload (ordering is mandatory)

The patch hooks `require`/`import`, so the SDK must start **before** your app imports `pg`/`http`/etc. Put `init()` (with the instrumentations) in a preload file and launch with Node's `--import`:

```bash
node --import resilient-otel/preload ./dist/main.js
# or your own preload that calls init() with custom instrumentations:
node --import ./dist/instrumentation.js ./dist/main.js
```

If you register *after* the library is already imported, patching is unreliable. This is the #1 auto-instrumentation gotcha.

### NestJS

`ObservabilityModule.forRoot()` covers the **manual** layer. For HTTP/DB auto-instrumentation, still launch with the preload — see [NESTJS.md](NESTJS.md).

### Databases & queues

- **DB** spans get `db.system` + `db.statement`. Parameter *values* are not captured by default (keep `enhancedDatabaseReporting` off); the scrubber also redacts `db.statement` content. See [GOVERNANCE.md](GOVERNANCE.md).
- **Queues**: the messaging instrumentations inject/extract `traceparent` into message headers, so the trace continues across the queue (producer span → consumer span, one trace). Without it the consumer span is orphaned.

---

## Manual instrumentation

### Custom spans (business operations)

```typescript
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('my-service');
await tracer.startActiveSpan('checkout.process', async (span) => {
  try {
    span.setAttribute('order.item_count', items.length); // sizes/ids, not content
    // ... work ...
    span.setStatus({ code: 1 }); // OK
  } catch (err) {
    span.recordException(err as Error);
    span.setStatus({ code: 2 }); // ERROR
    throw err;
  } finally {
    span.end();
  }
});
```

### Structured logs (with the flow taxonomy)

```typescript
import { emitLog, taxonomyAttrs, Operation, Target } from 'resilient-otel';

emitLog('info', {
  msg: 'order_persisted',
  ...taxonomyAttrs(Operation.Response, Target.Store),
  body: scrubber.scrubAttrs(order), // redact PII/secrets before export
});
```
`emitLog` auto-correlates to the active span (native `trace_id`/`span_id`). See [GOVERNANCE.md](GOVERNANCE.md) and the [taxonomy](USAGE.md#taxonomy).

### Metrics

```typescript
import { metrics } from '@opentelemetry/api';
import { createInstruments } from 'resilient-otel';

const { requestsCounter, requestDurationHistogram } = createInstruments(metrics.getMeter('my-service'));
requestsCounter.add(1, { route: '/checkout', outcome: 'success' });
requestDurationHistogram.record(durationMs, { route: '/checkout' });
```

### Propagation for non-instrumented transports (e.g. GCP Pub/Sub)

When no auto-instrumentation exists (Pub/Sub), propagate the context manually so the trace continues across the boundary:

```typescript
import { context, propagation, trace } from '@opentelemetry/api';

// Publisher: inject the active context into the message attributes
const attrs: Record<string, string> = {};
propagation.inject(context.active(), attrs);
await topic.publishMessage({ json: payload, attributes: attrs });

// Subscriber: extract it and run the handler in that context
const parent = propagation.extract(context.active(), message.attributes ?? {});
context.with(parent, () =>
  trace.getTracer('worker').startActiveSpan('pubsub.process', (span) => {
    // ... handle ...
    span.end();
  }),
);
```

This is the same trace-continuation the queue instrumentations do automatically — done by hand where there's no package for it.
