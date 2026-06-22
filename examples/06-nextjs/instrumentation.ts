/**
 * Next.js root instrumentation.ts (App Router, Next 15+ auto-detects this file).
 *
 * register() is NEXT_RUNTIME-guarded: it initializes the Node OpenTelemetry SDK
 * only on the Node.js runtime and no-ops on the Edge runtime (the SDK and
 * AsyncLocalStorage cannot run on Edge).
 */
import { register as registerOtel } from 'resilient-otel';
import { createScrubber } from 'resilient-otel/scrub';

export async function register(): Promise<void> {
  await registerOtel({
    serviceName: 'web-proxy',
    scrubber: createScrubber({ extraDenylist: ['internal_token'] }),
  });
}
