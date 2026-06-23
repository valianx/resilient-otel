# Data governance & naming

The conventions this library follows for what it puts on the wire, and how.

## Trace ↔ log correlation — native fields, not attributes

Logs are correlated to traces via the LogRecord's **native `trace_id` / `span_id` fields**, which the SDK populates from the active span context. The library does **not** add `trace_id`/`span_id` as custom attributes — backends (Elastic/ECS, Grafana, Axiom) correlate on the native fields, and duplicating them in attributes is non-standard and wastes bytes.

## Attribute naming

- **Standard/resource attributes** use OpenTelemetry semantic conventions (dot notation): `service.name`, `service.version`, `deployment.environment`, `db.statement`, etc.
- **The flow taxonomy** uses three deliberate, bare, lowercase custom keys — see [USAGE.md → Taxonomy](USAGE.md#taxonomy):
  - `operation` — flow phase: `request` | `response` | `error`
  - `target` — interaction partner: `client` | `external` | `store` | `internal`
  - `signal` — `log` | `trace` (only needed when a backend merges signals into one stream)

  These complement, and do not duplicate, the standard span `kind` (SERVER/CLIENT/INTERNAL), span `status` (OK/ERROR), and log `severity`. They are kept bare (not `app.*`) for query ergonomics.

## Sampling — head decision, honored everywhere

The sampler is `ParentBased(TraceIdRatioBased(ratio))`. The sampling decision is made **once at the head of a trace** (e.g. your ingress) and honored by every downstream service via the W3C `traceparent` sampled flag:

- remote parent sampled (`…-01`) → sampled
- remote parent not sampled (`…-00`) → dropped
- root span (no parent) → the ratio

The library deliberately does **not** re-sample not-sampled remote parents, so a trace stays consistent across all hops (no orphaned "loose" spans). Propagation is W3C TraceContext + Baggage (no B3).

## Redaction — before export, app-side

The scrubber (`resilient-otel/scrub`) redacts **before** any byte leaves the process (wired as span + log processors):

- **Body fields**: a denylist of key names (case-insensitive substring match) → value replaced with `[REDACTED]`. Extend via `extraDenylist`.
- **Headers**: sensitive header names (authorization, cookie, set-cookie, x-api-key, …) redacted; infrastructure headers (x-envoy-*, cf-*, x-forwarded-*, …) dropped to reduce noise.
- **Free text & values**: a secret-regex bank (Axiom, Anthropic, OpenAI, GitHub PAT, Stripe, AWS, Slack, JWT Bearer, RSA keys) → matches replaced. Extend via `extraSecretPatterns`.
- **Nested objects/arrays**: redaction descends recursively, with a circular-reference guard.
- **db.statement**: do not enable `enhancedDatabaseReporting` (it attaches parameter values); the scrubber also redacts statement content as defense-in-depth.

See [SCRUBBER.md](SCRUBBER.md) for details and [CONFIG.md](CONFIG.md) for the options.
