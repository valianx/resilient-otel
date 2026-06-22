# Resilient OTEL

A config-first OpenTelemetry library for Node.js services: SDK init, an extensible PII/secrets scrubber, taxonomy, metrics, log bridge, plus a NestJS adapter and a Next.js helper.

Works with **Node.js 22+**. Install one package, pass config, stop copying an observability folder into every project.

## Features

- **One-call setup**: `init(config)` wires traces + logs + metrics, returns a graceful-shutdown handle
- **Extensible scrubber**: redact your own fields and secret patterns at runtime — before anything is exported
- **Backend-agnostic**: emits OTLP only; the sink (Axiom, Grafana, SigNoz, Elastic) is your Collector's concern
- **Config-first**: the library reads no env vars of its own; every option is a typed field with a default
- **NestJS adapter** and **Next.js helper** for the App Router proxy/BFF layer
- **Tree-shakeable**, **TypeScript first**

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

## Documentation

- [Configuration](docs/CONFIG.md) — every `init()` / `createScrubber()` option, defaults, and the standard `OTEL_*` fallbacks
- [Usage guide](docs/USAGE.md) — full `init()`, backends (Collector vs Axiom), preload ordering, taxonomy
- [Scrubber](docs/SCRUBBER.md) — redaction, the secret-regex bank, modes, and the boot guard
- [NestJS](docs/NESTJS.md) — `ObservabilityModule`, interceptors, middlewares, lifecycle
- [Next.js](docs/NEXTJS.md) — `register()` for `instrumentation.ts` and the proxy/BFF Route Handler
- [API reference](docs/API.md) — exports per subpath and the TypeScript types
- [Migration](docs/MIGRATION.md) — replacing a vendored `observability/` folder
- [Vision](docs/VISION.md) — what the library is and why it exists

## License

MIT
