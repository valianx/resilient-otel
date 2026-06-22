/**
 * Next.js App Router proxy / BFF Route Handler.
 * Place at e.g. app/api/[...path]/route.ts.
 *
 * MUST run on the Node.js runtime — the SDK, AsyncLocalStorage and the scrubber
 * are Node-only. The outgoing fetch is auto-traced once the SDK is registered;
 * the scrubber keeps the proxied payload free of PII/secrets in telemetry.
 */
import { trace } from '@opentelemetry/api';
import { createScrubber } from 'resilient-otel/scrub';
import { emitLog, taxonomyAttrs, Operation, Target } from 'resilient-otel';

export const runtime = 'nodejs';

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

      const text = await upstream.text();
      emitLog('info', {
        msg: 'proxy_response',
        ...taxonomyAttrs(Operation.Response, Target.External),
        status_code: upstream.status,
      });
      span.setStatus({ code: 1 }); // OK
      return new Response(text, { status: upstream.status });
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
