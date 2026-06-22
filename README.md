# resilient-otel

Framework-agnostic OpenTelemetry library for Node.js services. Packages battle-tested observability into an installable npm package with a registry-based PII/secrets scrubber, SDK init/shutdown lifecycle, taxonomy enums, metrics factory, log bridge, and a NestJS adapter.

## Installation

```bash
npm install resilient-otel
```

## Quick Start

```typescript
import { init, createScrubber, axiomHeaders } from 'resilient-otel';
import { createScrubber } from 'resilient-otel/scrub';

const scrubber = createScrubber({
  extraDenylist: ['my_custom_field'],
});

const handle = await init({
  serviceName: 'my-service',
  scrubber,
  headers: axiomHeaders(), // reads AXIOM_TOKEN / AXIOM_DATASET at call time
});

// On shutdown:
await handle.shutdown();
```

## Auto-instrumentation ordering (REQUIRED)

OTel auto-instrumentation patches libraries at **module load time**. Run with:

```bash
node --import resilient-otel/preload ./dist/main.js
```

`ObservabilityModule.forRoot()` handles the manual layer (custom spans, scrubber, log bridge, lifecycle), but the preload is required for HTTP/DB/Nest auto-patches.

## NestJS Adapter

```typescript
import { ObservabilityModule } from 'resilient-otel/nestjs';
import { createScrubber } from 'resilient-otel/scrub';

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

## Env Var Contract

| Variable | Default | Purpose |
|----------|---------|---------|
| `OBSERVABILITY_ENABLED` | `false` | Master switch. `false`/unset → no-op shutdown. |
| `OTEL_SDK_DISABLED` | _(empty)_ | Standard kill-switch (`true` → no-op). |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | _(required when enabled)_ | OTLP collector base URL. |
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

## Scrubber

The scrubber is the headline feature: registry-based, runtime-extensible. Redaction happens **before export** via `ScrubSpanProcessor` and `ScrubLogRecordProcessor`.

```typescript
import { createScrubber, noopScrubber } from 'resilient-otel/scrub';

const scrubber = createScrubber({
  mode: 'strict',
  extraDenylist: ['my_secret_field'],
  extraSecretPatterns: [/my-prefix-[A-Za-z0-9]{32}/],
  readEnvDenylist: true, // also reads LOG_REDACT_EXTRA_FIELDS
});
```

> **Note:** `@opentelemetry/api-logs` (`0.208.0`) is experimental (alpha) — the Logs Bridge API carries no stability guarantee across minor bumps. Pin the version and test after upgrades.

## DB Statement PII

Do **not** enable `enhancedDatabaseReporting` on `instrumentation-pg`. The Scrub SpanProcessor redacts `db.statement` content as a defense-in-depth measure.

## License

MIT
