# Next.js

The Node OpenTelemetry SDK and `AsyncLocalStorage` cannot run on the Edge runtime, so initialize from the root `instrumentation.ts` `register()` hook (Next.js 15+ auto-detects it). `register()` is `NEXT_RUNTIME`-guarded: it initializes on the Node.js runtime and no-ops on Edge.

## instrumentation.ts

```typescript
// instrumentation.ts (project root)
import { register as registerOtel } from 'resilient-otel';
import { createScrubber } from 'resilient-otel/scrub';

export async function register() {
  await registerOtel({
    serviceName: 'web-proxy',
    scrubber: createScrubber({ extraDenylist: ['internal_token'] }),
  });
}
```

`register(config)` takes the same `ResilientOtelConfig` as `init()` — see [CONFIG.md](CONFIG.md).

## Proxy / BFF Route Handler

Ensure the handler runs on the Node runtime — the SDK, AsyncLocalStorage, and the scrubber are Node-only. The outgoing `fetch` is auto-traced once the SDK is registered; the scrubber keeps the forwarded payload free of PII/secrets.

```typescript
// app/api/[...path]/route.ts
import { trace } from '@opentelemetry/api';
import { createScrubber } from 'resilient-otel/scrub';
import { emitLog, taxonomyAttrs, Operation, Target } from 'resilient-otel';

export const runtime = 'nodejs'; // required

const scrubber = createScrubber();
const tracer = trace.getTracer('web-proxy');

export async function POST(req: Request): Promise<Response> {
  return tracer.startActiveSpan('proxy.forward', async (span) => {
    try {
      const body = await req.json();
      emitLog('info', {
        msg: 'proxy_request',
        ...taxonomyAttrs(Operation.Request, Target.External),
        body: scrubber.scrubAttrs(body),
      });
      const upstream = await fetch('https://backend.internal/resource', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      span.setStatus({ code: 1 }); // OK
      return new Response(await upstream.text(), { status: upstream.status });
    } catch (err) {
      emitLog('error', {
        msg: 'proxy_failed',
        ...taxonomyAttrs(Operation.Error, Target.External),
        body: (err as Error).message,
      });
      span.setStatus({ code: 2 }); // ERROR
      return new Response('Bad Gateway', { status: 502 });
    } finally {
      span.end();
    }
  });
}
```

## Edge runtime

Middleware and handlers on the Edge runtime are not supported: there is no `async_hooks` and no Node SDK. `register()` no-ops there, so a mixed app stays safe — just keep the instrumented proxy handlers on `runtime = 'nodejs'`.

See [`examples/06-nextjs/`](../examples/06-nextjs) for the runnable `instrumentation.ts` + route.
