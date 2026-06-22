/**
 * Minimal core usage in a plain Node service.
 *
 * Run: node --import resilient-otel/preload ./dist/01-core-node.js
 * (the preload enables HTTP/DB auto-instrumentation; init() below wires the
 * manual layer: scrubber, log bridge, lifecycle.)
 */
import { init } from 'resilient-otel';
import { createScrubber } from 'resilient-otel/scrub';

async function main(): Promise<void> {
  const handle = await init({
    serviceName: 'my-service',
    scrubber: createScrubber({ extraDenylist: ['internal_account_id'] }),
  });

  // Flush + shut down telemetry on termination.
  const stop = async (): Promise<void> => {
    await handle.shutdown();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  // ... your server / worker starts here ...
}

void main();
