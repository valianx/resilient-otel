# NestJS

The `resilient-otel/nestjs` adapter wires the agnostic core into NestJS DI. `ObservabilityModule.forRoot()` calls core `init()` once and registers graceful shutdown via the Nest lifecycle.

## Module setup

```typescript
import { Module } from '@nestjs/common';
import { ObservabilityModule } from 'resilient-otel/nestjs';
import { createScrubber } from 'resilient-otel/scrub';

@Module({
  imports: [
    ObservabilityModule.forRoot({
      serviceName: 'nest-service',
      scrubber: createScrubber({ extraDenylist: ['tenant_secret'] }),
    }),
  ],
})
export class AppModule {}
```

`forRoot()` takes the same `ResilientOtelConfig` as core `init()` — see [CONFIG.md](CONFIG.md).

## Bootstrap

Enable shutdown hooks so the lifecycle can flush telemetry on `SIGTERM`:

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(3000);
}
void bootstrap();
```

## Auto-instrumentation ordering

`forRoot()` covers the manual layer (custom spans, scrubber, log bridge, lifecycle). For full HTTP/DB auto-instrumentation, OpenTelemetry must patch libraries before the app's modules load — launch with the preload entry:

```bash
node --import resilient-otel/preload ./dist/main.js
```

## What the adapter provides

| Export | Purpose |
|--------|---------|
| `ObservabilityModule` | `@Global()` module; `forRoot(config)` |
| `ExecutionContextInterceptor` | Runs each request inside the AsyncLocalStorage context |
| `HttpClientInterceptor` | Instruments outgoing `@nestjs/axios` calls |
| `LoggingMiddleware` | Request/response logging (uses core `normalizeRoute`) |
| `TraceMiddleware` | Injects trace context into the response |
| `HttpExceptionFilter` | Records exceptions on the active span |
| `RequestContext` | Request-scoped context provider |
| `TelemetryLifecycleService` | Maps Nest lifecycle → core `shutdown()` |
| `createWinstonOtelTransport(opts)` | Optional Winston → OTel Logs bridge (lazy; needs the `winston`/`winston-transport` peers) |

## Peer dependencies

`@nestjs/common`, `@nestjs/core`, and optionally `@nestjs/axios`, `rxjs`, `winston`, `winston-transport` are peer dependencies — a core-only consumer never installs them. The adapter imports the core only; it never re-implements SDK logic.

See [`examples/05-nestjs/`](../examples/05-nestjs) for a runnable module + bootstrap.
