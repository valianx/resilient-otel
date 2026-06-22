# Migration: nest-template observability folder → resilient-otel

This guide covers replacing `src/observability/` in a NestJS app that was bootstrapped from `nest-template` with the `resilient-otel` package.

## Step 1 — Install

```bash
npm install resilient-otel
```

For NestJS consumers also install the peer deps your app uses:

```bash
npm install winston winston-transport rxjs
# If using @nestjs/axios for outgoing HTTP:
npm install @nestjs/axios
```

## Step 2 — Auto-instrumentation ordering (REQUIRED)

Update your start scripts to use the preload entry:

```bash
# Before
node dist/main.js

# After
node --import resilient-otel/preload dist/main.js
```

Or in `package.json`:
```json
{
  "scripts": {
    "start": "node --import resilient-otel/preload dist/main.js",
    "start:dev": "ts-node --import resilient-otel/preload src/main.ts"
  }
}
```

**Why this matters:** OTel auto-instrumentation patches libraries (NestJS, pg, http) at module load time. The preload ensures the SDK starts before these modules are imported. `ObservabilityModule.forRoot()` covers the manual layer (custom spans, scrubber, log bridge, lifecycle) but cannot retro-patch already-cached modules.

## Step 3 — Replace AppModule imports

```typescript
// BEFORE
import { ObservabilityModule } from './observability/observability.module';

// AFTER
import { ObservabilityModule } from 'resilient-otel/nestjs';
import { createScrubber } from 'resilient-otel/scrub';

@Module({
  imports: [
    ObservabilityModule.forRoot({
      scrubber: createScrubber({
        // Optional: add project-specific PII fields
        extraDenylist: ['customer_id', 'account_ref'],
      }),
      // For direct-to-vendor export, pass OTLP auth headers (see docs/AXIOM.md):
      // headers: () => ({ Authorization: `Bearer ${process.env.VENDOR_TOKEN}` }),
    }),
  ],
})
export class AppModule {}
```

## Step 4 — Update import rewrites

| Before (local folder) | After (package) |
|---|---|
| `import { ObservabilityModule } from './observability/observability.module'` | `import { ObservabilityModule } from 'resilient-otel/nestjs'` |
| `import { LoggerService } from './observability/services/logger.service'` | `import { LoggerService } from 'resilient-otel/nestjs'` (or use core `emitLog`) |
| `import { ExecutionContextService } from './observability/services/execution-context.service'` | `import { executionContext } from 'resilient-otel'` |
| `import { sanitizeBody, sanitizeHeader } from './observability/utils/sanitizer.util'` | `import { createScrubber } from 'resilient-otel/scrub'` → `scrubber.scrubAttrs(body)` |
| `import { TelemetryLifecycleService } from './observability/services/telemetry-lifecycle.service'` | `import { TelemetryLifecycleService } from 'resilient-otel/nestjs'` (wired by `forRoot`) |
| Side-effect `import './observability/config/opentelemetry.config'` | `await init({ scrubber: createScrubber() })` before `NestFactory.create` OR use `ObservabilityModule.forRoot()` |

## Step 5 — Update env vars

| Template env var | Package env var |
|---|---|
| `URL_COLLECTOR` | `init({ endpoint })` or `OTEL_EXPORTER_OTLP_ENDPOINT` |
| `SERVICE_NAME` | `init({ serviceName })` or `OTEL_SERVICE_NAME` |
| `OTEL_SAMPLING_RATIO` | `init({ samplingRatio })` or `OTEL_TRACES_SAMPLER_ARG` |
| `CH_OBSERVABILITY_ENABLED` (if present) | `init({ enabled })` — code config (default `true`); no env var |
| `OTEL_ENVIRONMENT` (if present) | `init({ environment })` or `OTEL_RESOURCE_ATTRIBUTES=deployment.environment=...` |
| `SERVICE_VERSION` (if present) | `init({ serviceVersion })` or `OTEL_RESOURCE_ATTRIBUTES=service.version=...` |

## Step 6 — Delete the local folder

Once all imports are updated and the app boots cleanly:

```bash
rm -rf src/observability/
```

## Deferred: Kafka logger util

`src/observability/utils/kafka-logger.util.ts` is NOT yet in `resilient-otel`. Keep the local copy until `resilient-otel/nestjs/kafka` ships.

## Scrubber customization

The new scrubber is registry-based and runtime-extensible. The old `sanitizeBody` / `sanitizeHeader` functions used a hardcoded `PII_BODY_FIELDS` array. Migration:

```typescript
// BEFORE
import { sanitizeBody } from './observability/utils/sanitizer.util';
const safe = sanitizeBody(requestBody);

// AFTER
import { createScrubber } from 'resilient-otel/scrub';
const scrubber = createScrubber({
  extraDenylist: ['my_custom_field', 'merchant_id', 'card_bin'],
});
const safe = scrubber.scrubAttrs(requestBody as Record<string, unknown>);
```

All scrubber configuration is code-level — pass your extra denylist terms directly to `createScrubber()`. There is no env-var channel.

## DB statement PII

Do NOT enable `enhancedDatabaseReporting` on `@opentelemetry/instrumentation-pg`. The `ScrubSpanProcessor` redacts `db.statement` content as a defense-in-depth measure, but query-parameter values should never appear in spans — use parameterized queries.
