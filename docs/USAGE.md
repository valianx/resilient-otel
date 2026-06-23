# Usage guide

Detailed usage beyond the README quick start. See [CONFIG.md](CONFIG.md) for the full option contract.

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

## Stdout console export

Enable `consoleExport: true` to emit each (already-scrubbed) log record to stdout as single-line JSON, in addition to OTLP. Useful for k8s log aggregators that scrape stdout.

```typescript
const handle = await init({
  scrubber: createScrubber(),
  consoleExport: true,  // or set OTEL_RESILIENT_CONSOLE=true in env
});
```

The console sink is wired **behind** the single `ScrubLogRecordProcessor` — records are scrubbed exactly once, then fanned out to both OTLP and stdout. You cannot receive an unscrubbed record on stdout through this path.

**Migration note:** if you already hand-roll a `console.log` or Winston console sink, enabling `consoleExport: true` will double-log. Delete the manual sink when enabling.

See [CONFIG.md § consoleExport](CONFIG.md#consoleexport--stdout-record-shape) for the stdout record shape.

## Lean instrumentation surface (opt-in)

Replace the boilerplate `instrumentation.ts` with library-owned defaults:

```typescript
import { init } from 'resilient-otel';
import { PII_BODY_FIELDS, SENSITIVE_HEADERS } from './config/redaction.config';

let handle: Awaited<ReturnType<typeof init>> | undefined;

export async function initInstrumentation() {
  if (handle) return handle;
  handle = await init({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'my-service',
    protocol: 'grpc',
    // Library builds + exposes the scrubber; consumer passes only extra fields.
    scrubberConfig: {
      mode: (process.env.LOG_SANITIZATION_MODE as 'strict' | 'moderate' | 'disabled') ?? 'strict',
      extraDenylist: [...PII_BODY_FIELDS, ...SENSITIVE_HEADERS],
    },
    // Library owns the pruned default set; extras or ignores are optional.
    useDefaultInstrumentations: true,
    ignoreIncomingPaths: [/.*\/health\/status/],
    // Library registers SIGTERM/SIGINT → flush → exit.
    gracefulShutdown: true,
    // Optional: set diag logger level for OTEL internals.
    diagLogLevel: 'warn',
  });
  return handle;
}

// pass handle.scrubber to ObservabilityModule.forWiring
export const getScrubber = () => handle?.scrubber;
```

Each new option is absent-by-default. A consumer that omits all of them sees byte-identical behaviour to 0.1.x.

| Before (0.1.x) | After (0.2.0) |
|---|---|
| Explicit `createScrubber()` + thread to two places | `scrubberConfig` + read `handle.scrubber` |
| ~25 `enabled:false` lines in `getNodeAutoInstrumentations` | `useDefaultInstrumentations: true` |
| Manual SIGTERM/SIGINT wiring | `gracefulShutdown: true` |
| Bespoke `HttpInstrumentation({ ignoreIncomingRequestHook })` | `ignoreIncomingPaths: [...]` |

## Auto-instrumentation ordering (preload)

OpenTelemetry patches libraries at **module-load time**, so the SDK must start before your app imports `http`/`pg`/etc. Launch with the preload entry:

```bash
node --import resilient-otel/preload ./dist/main.js
```

Manual telemetry (custom spans, the scrubber, the log bridge, lifecycle) works without the preload; only the automatic HTTP/DB/framework patches need it.

## Backends

The library emits OTLP and does not care where it lands — that is your Collector's job.

```typescript
// Local Collector (no auth) → Elastic / Grafana / SigNoz
await init({
  serviceName: 'svc',
  scrubber: createScrubber(),
  endpoint: 'http://otel-collector:4317',
  protocol: 'grpc',
});

// Direct to a vendor (no Collector) — OTLP authenticates via headers
await init({
  serviceName: 'svc',
  scrubber: createScrubber(),
  endpoint: 'https://otlp.vendor.example',
  headers: () => ({ Authorization: `Bearer ${process.env.VENDOR_TOKEN}` }),
});
```

For direct-to-vendor export, authentication travels as OTLP **headers** — the `headers` field accepts a record or a `() => record` thunk (evaluated on each export, so token rotation needs no code change and the token is never compiled into the bundle). Each vendor uses its own header names:

- **Axiom**: `Authorization: Bearer <token>` + `X-Axiom-Dataset: <dataset>` — see [AXIOM.md](AXIOM.md)
- **Honeycomb**: `x-honeycomb-team: <key>`
- **Grafana Cloud**: `Authorization: Basic <base64(instanceID:token)>`
- **Datadog**: `dd-api-key: <key>`

## Taxonomy

Tag spans and logs with the two-axis flow taxonomy (`operation` × `target`) for cross-flow queries.

```typescript
import { taxonomyAttrs, Operation, Target } from 'resilient-otel';

taxonomyAttrs(Operation.Error, Target.External);
// → { operation: 'error', target: 'external', signal: 'log' }
```

- `Operation`: `Request` | `Response` | `Error`
- `Target`: `Client` | `External` | `Store` | `Internal` (pass a custom string for finer values)

## Logs

```typescript
import { emitLog, taxonomyAttrs, Operation, Target } from 'resilient-otel';

emitLog('info', {
  msg: 'request_completed',
  ...taxonomyAttrs(Operation.Response, Target.Client),
  body: { /* scrub first if it may contain PII */ },
});
```

`emitLog(level, data)` enriches with the active trace/span ids and execution context, then emits through the OTel Logs bridge. Before init (or when disabled) it is a no-op.

## Runnable examples

See [`examples/`](../examples) for full, copy-paste files: core init, the preload entry, custom redaction, Axiom-direct, NestJS, and the Next.js BFF route.
