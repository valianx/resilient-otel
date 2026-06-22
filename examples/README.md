# resilient-otel examples

Runnable, copy-paste examples for each entry point. They import `resilient-otel`
as a consumer would; drop them into a project that has the package installed.

| File | Shows |
|------|-------|
| `01-core-node.ts` | Minimal `init()` + graceful shutdown in a plain Node service |
| `02-instrumentation.ts` | The `--import` preload entry for auto-instrumentation ordering |
| `03-custom-redaction.ts` | `createScrubber()` with custom denylist words + a custom secret pattern |
| `04-axiom-direct.ts` | `axiomHeaders()` runtime header builder for direct-to-Axiom export |
| `05-nestjs/` | `ObservabilityModule.forRoot()` wiring in a NestJS app |
| `06-nextjs/` | App Router proxy/BFF: `instrumentation.ts` + a Node-runtime Route Handler |

All examples assume:

```bash
export OBSERVABILITY_ENABLED=true
export OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317
export OTEL_EXPORTER_OTLP_PROTOCOL=grpc
export OTEL_SERVICE_NAME=my-service
```

See the root `README.md` for the full environment-variable contract.
