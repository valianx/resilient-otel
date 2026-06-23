# Roadmap

## Path to `1.0.0` (stable)

`0.1.x` is intentionally unstable (SemVer: breaking changes allowed). Stable = all gates green:

1. **Coverage matrix complete + green in CI** — all signals (traces/logs/**metrics**), both transports (http/protobuf + **gRPC**), config paths (enabled/disabled/sampling/scrubber modes), redaction (body ✅ / client headers / vendor auth headers / nested), propagation (multi-hop ✅ / parent-based sampling ✅), lifecycle (graceful shutdown ✅ / **SIGTERM flush**).
2. **A full matrix run finds zero new bugs.**
3. **NestJS consumer validated** end-to-end (Next.js deferred — see below).
4. **Known issues at zero** (see below).
5. **Soak** — cut a real service (the nest-template's vendored `observability/` folder) over to `resilient-otel` and run it against a real Collector.
6. **API + governance frozen** — `docs/GOVERNANCE.md` final, docs match behavior.

### Known issues (must reach zero before 1.0)
- ✅ **Resolved in 0.1.3** — Spans are now tagged `signal: 'trace'` by `SignalSpanProcessor`, symmetric with logs' `signal: 'log'`. Validated e2e.
- ✅ **Resolved in 0.1.3** — The AsyncLocalStorage execution-context is now a process-wide singleton keyed on `globalThis`/`Symbol.for`, shared across the core/scrub/nestjs bundles.
- ✅ **Resolved in 0.1.3** — `nestjs/http-client.interceptor` no longer injects `trace_id`/`span_id` as custom attributes; it emits inside the span's context for native correlation.

All three known issues are at zero as of 0.1.3.

### Deferred
- **Next.js e2e** — the second consumer suite (App Router proxy/BFF). Deferred while we harden NestJS first.

## Post-`1.0` — `resilient-otel/genai`

A thin, additive adapter for **AI-agent observability** on top of the core (no core changes):

- **GenAI semantic conventions** helpers — set `gen_ai.*` attributes (`gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`/`output_tokens`, …) on spans for LLM/tool calls.
- **Prompt/completion redaction preset** — the scrubber tuned for agent content (prompts/completions routinely carry PII/secrets); this is the differentiator vs generic agent tracers.
- **Token/cost metrics** — standard instruments for token usage and cost.
- **LLM auto-instrumentation passthrough** — document wiring OpenLLMetry / OTel-contrib LLM instrumentations via the existing `instrumentations` config field.

Rationale: agent observability is converging on OTel GenAI semconv, so the core pipeline + propagation + redaction already fit; this is a small layer, not a rewrite.
