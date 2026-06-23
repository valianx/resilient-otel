# Optional dependencies & how to enable them

`npm install resilient-otel` gives you the full core (traces + logs + metrics over **OTLP/HTTP**, scrubber, propagation, lifecycle) with **nothing else to install** — the OTel SDK and the http/protobuf exporters are bundled.

Everything below is **opt-in**: declared as optional peer dependencies (never force-installed), each enabled by installing its package(s) and wiring it. Install only what a given service uses.

| Extra | Install | Enable with |
|-------|---------|-------------|
| [Auto-instrumentation](#auto-instrumentation) | `@opentelemetry/instrumentation-*` (or `auto-instrumentations-node`) | `init({ instrumentations: [...] })` + preload |
| [gRPC transport](#grpc-transport) | `@opentelemetry/exporter-{trace,logs,metrics}-otlp-grpc` + `@grpc/grpc-js` | `init({ protocol: 'grpc' })` |
| [Winston bridge](#winston-bridge) | `winston` + `winston-transport` | `createWinstonOtelTransport()` |
| [NestJS adapter](#nestjs-adapter) | `@nestjs/common` + `@nestjs/core` (usually already present) | `ObservabilityModule.forRoot()` |

---

## Auto-instrumentation

Automatic spans for HTTP, databases, queues, etc. Install the instrumentation(s) you use, register them, and launch with the preload (patching must run before the target library loads):

```bash
npm install @opentelemetry/instrumentation-http @opentelemetry/instrumentation-pg
```
```typescript
// instrumentation.ts
import { init } from 'resilient-otel';
import { createScrubber } from 'resilient-otel/scrub';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';

await init({
  serviceName: 'my-service',
  scrubber: createScrubber(),
  instrumentations: [new HttpInstrumentation(), new PgInstrumentation()],
});
```
```bash
node --import ./dist/instrumentation.js ./dist/main.js
```

Installing the package does **not** activate it — you must register it. Full use-case matrix (DBs, redis, kafka, Pub/Sub) and manual instrumentation: **[INSTRUMENTATION.md](INSTRUMENTATION.md)**.

---

## gRPC transport

The default is `http/protobuf`. To export over gRPC, install the gRPC exporters and `@grpc/grpc-js`, then select the protocol:

```bash
npm install @opentelemetry/exporter-trace-otlp-grpc \
  @opentelemetry/exporter-logs-otlp-grpc \
  @opentelemetry/exporter-metrics-otlp-grpc \
  @grpc/grpc-js
```
```typescript
await init({
  serviceName: 'my-service',
  scrubber: createScrubber(),
  endpoint: 'http://otel-collector:4317', // gRPC port
  protocol: 'grpc',
});
```

The library lazy-loads the gRPC exporters only when `protocol: 'grpc'`; if they are not installed, `init()` throws a message naming the packages to install.

---

## Winston bridge

If your app already logs with **Winston** and you want those logs to flow into OTel Logs (correlated + redacted), add a transport. Requires the SDK to be started (`init()`), which registers the global logger provider.

```bash
npm install winston winston-transport
```
```typescript
import winston from 'winston';
import { logs } from '@opentelemetry/api-logs';
import { createWinstonOtelTransport } from 'resilient-otel/nestjs';

// after init() has run:
const otelTransport = await createWinstonOtelTransport({
  otelLogger: logs.getLogger('my-service'),
});

const logger = winston.createLogger({
  transports: [new winston.transports.Console(), otelTransport],
});
```

`winston`/`winston-transport` are imported lazily inside `createWinstonOtelTransport`, so importing `resilient-otel/nestjs` never forces Winston on consumers who don't use it. If you don't use Winston, use the built-in `emitLog()` instead — no install needed.

---

## NestJS adapter

`@nestjs/common` and `@nestjs/core` are peers (a Nest app already has them). `@nestjs/axios` and `rxjs` are needed only for the HTTP-client interceptor.

```typescript
import { Module } from '@nestjs/common';
import { ObservabilityModule } from 'resilient-otel/nestjs';
import { createScrubber } from 'resilient-otel/scrub';

@Module({
  imports: [ObservabilityModule.forRoot({ serviceName: 'nest-service', scrubber: createScrubber() })],
})
export class AppModule {}
```

Full adapter reference: **[NESTJS.md](NESTJS.md)**.

---

## Why these aren't bundled

Optional peers keep the default install lean **and correct**. The strongest reason is single-instance: `@opentelemetry/api`, `@nestjs/*`, `winston`, and `@grpc/grpc-js` must be the **same** instance as your app — bundling a second copy silently breaks the global API, the Nest DI container, the Winston registry, or gRPC. So they are peers, resolved to your version. See [GOVERNANCE.md](GOVERNANCE.md) and the dependency split in `package.json`.
