# Scrubber

The scrubber redacts PII and secrets from span/log attributes and free-text bodies, **before export**. It is the headline feature and a boot requirement: `init()` refuses to start without a real scrubber (passing none, or `noopScrubber`, throws).

It is registry-based and runtime-extensible — a built-in PII field denylist and a secret-regex bank, plus your own additions.

## Creating a scrubber

```typescript
import { createScrubber } from 'resilient-otel/scrub';

const scrubber = createScrubber({
  mode: 'moderate',                                // 'strict' | 'moderate' | 'disabled'
  extraDenylist: ['internal_account_id'],          // merged onto DEFAULT_DENYLIST
  extraSecretPatterns: [/acme-[A-Za-z0-9]{32}/],   // merged onto the secret bank
  replacement: '[REDACTED]',                       // replacement string
  maxStringLength: 1000,                           // truncate long strings (strict mode)
});
```

See [CONFIG.md](CONFIG.md) for the full option table and defaults.

## What it does

```typescript
// Object attributes: denylisted keys replaced, safe keys preserved
scrubber.scrubAttrs({ password: 'x', email: 'a@b.com', safe: 'ok' });
// → { password: '[REDACTED]', email: '[REDACTED]', safe: 'ok' }

// Free text: secrets and denylisted key=value pairs redacted inline
scrubber.redact('login password=hunter2 token Bearer eyJ...');
// → 'login password=[REDACTED] token [REDACTED]'
```

Merge order for the denylist: `DEFAULT_DENYLIST ∪ extraDenylist` (config-only; no env channel).

## Secret-regex bank

`DEFAULT_SECRET_PATTERNS` covers common provider tokens: Axiom, Anthropic, OpenAI, GitHub PAT, Stripe, AWS access/session keys, Slack, JWT Bearer, and RSA private-key PEM blocks. Add vendor-specific patterns via `extraSecretPatterns`. Every built-in pattern has a dedicated test.

Order inside `redact()`: secret patterns run first (so structured tokens like `Bearer eyJ…` are caught), then inline denylisted `key=value` redaction.

## Redaction before export

Redaction is wired into the SDK as a `ScrubSpanProcessor` + `ScrubLogRecordProcessor` that wrap the downstream batch exporters. Redaction happens on `onEnd` (spans) and `onEmit` (logs) — before any byte leaves the process.

## Boot guard

`init()` throws when enabled (the default) and neither `scrubber` nor `scrubberConfig` is provided (or the provided `scrubber` is the `noopScrubber` sentinel). This prevents accidental shipment of PII to the collector. `noopScrubber` exists only for testing the guard.

## Disabled-mode contract

`mode: 'disabled'` short-circuits all attribute redaction in `scrubAttrs()`. This means a disabled scrubber passes attribute values to **every downstream sink** — including the stdout console sink when `consoleExport: true`. There is no separate code path; the console sink inherits disabled-mode behaviour because it sits behind the same scrub stage. Use `mode: 'disabled'` only in local development where PII exposure is acceptable.

## Database statement PII

Do **not** enable `enhancedDatabaseReporting` on `@opentelemetry/instrumentation-pg` — it attaches query parameter values. The Scrub SpanProcessor also redacts `db.statement` content as defense-in-depth.
