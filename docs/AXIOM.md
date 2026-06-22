# Using resilient-otel with Axiom

[Axiom](https://axiom.co) is one of many OTLP backends you can export to directly (no Collector). There is nothing Axiom-specific in the library — you authenticate with the generic `headers` field, exactly as you would for Honeycomb, Grafana Cloud, Datadog, or any OTLP vendor. This guide just spells out Axiom's specifics.

## What Axiom needs

| | Value |
|---|---|
| Endpoint | `https://api.axiom.co` (US) · `https://api.eu.axiom.co` (EU) |
| Protocol | `http/protobuf` |
| Auth header | `Authorization: Bearer <AXIOM_TOKEN>` |
| Dataset header | `X-Axiom-Dataset: <AXIOM_DATASET>` |

The token should be an **Ingest-only** API token. Create the dataset and token in the Axiom UI (Settings → Datasets / API Tokens).

## Setup

Pass the two headers through the generic `headers` field. Use a **thunk** (`() => record`) so the token is read at call time — rotating it in the environment then needs no code change, and it is never compiled into the bundle:

```typescript
import { init } from 'resilient-otel';
import { createScrubber } from 'resilient-otel/scrub';

const handle = await init({
  serviceName: 'my-service',
  scrubber: createScrubber(),
  endpoint: 'https://api.axiom.co',
  protocol: 'http/protobuf',
  headers: () => ({
    Authorization: `Bearer ${process.env.AXIOM_TOKEN}`,
    'X-Axiom-Dataset': process.env.AXIOM_DATASET ?? '',
  }),
});
```

A static record works too if you don't need rotation:

```typescript
headers: {
  Authorization: `Bearer ${process.env.AXIOM_TOKEN}`,
  'X-Axiom-Dataset': process.env.AXIOM_DATASET ?? '',
},
```

## Environment

These two are **your** env vars (you read them in the thunk above) — the library does not read them itself:

```bash
AXIOM_TOKEN=xaat-...      # Ingest-only token
AXIOM_DATASET=my-dataset
```

The scrubber's secret bank already redacts `xaat-` tokens, so an accidental log of the token is itself redacted.

## Other vendors

Same mechanism, different header names — see [USAGE.md → Backends](USAGE.md#backends):

- **Honeycomb**: `{ 'x-honeycomb-team': '<key>' }`
- **Grafana Cloud**: `{ Authorization: 'Basic <base64(instanceID:token)>' }`
- **Datadog**: `{ 'dd-api-key': '<key>' }`
