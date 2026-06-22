import { init } from './init.js';
import type { ResilientOtelConfig, ShutdownHandle } from '../types/index.js';

/** No-op handle returned on the Edge runtime, where the Node SDK cannot run. */
const NOOP_HANDLE: ShutdownHandle = {
  shutdown: () => Promise.resolve(),
};

/**
 * Next.js entrypoint helper for the root `instrumentation.ts` `register()` hook.
 *
 * The Node OpenTelemetry SDK (and AsyncLocalStorage) cannot run on the Edge
 * runtime, so this guards on `process.env.NEXT_RUNTIME`: it only initializes
 * when the runtime is `nodejs` (or unset, e.g. a plain Node process). On the
 * Edge runtime it resolves to a no-op handle instead of throwing.
 *
 * @example
 * // instrumentation.ts (project root)
 * import { register as registerOtel } from 'resilient-otel';
 * import { createScrubber } from 'resilient-otel/scrub';
 *
 * export async function register() {
 *   await registerOtel({ scrubber: createScrubber() });
 * }
 */
export async function register(
  config: ResilientOtelConfig,
): Promise<ShutdownHandle> {
  const runtime = process.env['NEXT_RUNTIME'];
  if (runtime && runtime !== 'nodejs') {
    return NOOP_HANDLE;
  }
  return init(config);
}
