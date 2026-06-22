# Vision & Context — resilient-otel

> Living document. Captures the **why** of the library and the real problems it exists to solve.
> It is the source of truth for the project's intent; the architecture and code serve this.

---

## 1. What resilient-otel is

`resilient-otel` is a **TypeScript library** that packages a complete OpenTelemetry setup — SDK init/shutdown, a PII/secrets scrubber, signal taxonomy, metrics, and a log bridge — into a single installable npm package, with a NestJS adapter and a Next.js helper on top of a framework-agnostic core.

Its job is to standardize how a service emits observability: traces, logs, and metrics, under one tested, reusable pattern.

## 2. Why it exists (the problem)

The library is born from a concrete pain: an OpenTelemetry/observability folder that was **copy-pasted into every project**.

- Every service vendored the same ~3,600-line `observability/` folder and drifted over time.
- Fixes and improvements had to be re-applied by hand across repositories.
- The goal is to **stop copying and pasting**: one set of tested code, packaged once, reused everywhere with confidence — `npm install resilient-otel`, pass config, done.

## 3. Goals

1. **Install + a couple of lines.** A consumer should get traces + logs + metrics from a single `init(config)` call, with safe defaults covering everything they do not set.
2. **Config-first.** Instance configuration belongs in code, not in environment variables the library invents. The consumer passes values; the library imposes no naming.
3. **Backend-agnostic.** The library emits OTLP only. The destination (Axiom, Grafana, SigNoz, Elastic) lives in the Collector, not in the code.
4. **Safe by default for PII.** Redaction of secrets and PII happens app-side, before export, and the SDK refuses to start without a scrubber.

## 4. Design principles

### Config-first, safe defaults

The library reads **no environment variables of its own**. Every option is a typed field on `init()` / `createScrubber()` with a default. The only env vars consulted are the genuinely-standard OpenTelemetry `OTEL_*` ones (read by the underlying SDK regardless), used purely as fallbacks — config always wins. A consumer is never forced to adopt names we invented.

### Scrubber-first (redact before export)

The scrubber is the headline feature and a boot requirement. It is registry-based and runtime-extensible (add your own denylist words and secret patterns), and it is wired as a span/log processor that wraps the batch exporters — so nothing leaves the process unredacted. `init()` throws if no real scrubber is provided.

### Agnostic core + thin framework adapters

The reusable logic (SDK builder, scrubber, taxonomy, metrics, log bridge, AsyncLocalStorage context) lives in a framework-agnostic core. NestJS gets a DI adapter because it needs wiring; Next.js needs only a small `register()` helper because the core works as-is in a Node-runtime app — the same way a plain library would.

## 5. Non-goals

- Not a Collector or a backend — it emits OTLP and stops there.
- Not an Edge-runtime library — the Node SDK and AsyncLocalStorage are Node-only (Node 22+).
- Not a config framework — it receives values; it does not read or manage environment.
