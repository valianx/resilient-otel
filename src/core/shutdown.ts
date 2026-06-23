import type { NodeSDK } from '@opentelemetry/sdk-node';
import type { ShutdownHandle } from '../types/index.js';

export interface ShutdownDependencies {
  sdk: NodeSDK;
}

/**
 * Build the framework-agnostic shutdown function.
 *
 * NodeSDK owns all three signal providers (traces/logs/metrics), so its
 * shutdown() flushes the batch processors + the metric reader and then stops
 * everything. Raced against a timeout (default 10s); never rejects — a flush
 * failure must not throw from shutdown.
 */
export function buildShutdown(
  deps: ShutdownDependencies,
  timeoutMs: number,
): ShutdownHandle {
  let shutdownCalled = false;

  return {
    async shutdown(): Promise<void> {
      if (shutdownCalled) return;
      shutdownCalled = true;

      const sequence = deps.sdk.shutdown().catch(() => {
        // Non-fatal.
      });
      const timeout = new Promise<void>((resolve) => {
        setTimeout(resolve, timeoutMs);
      });

      await Promise.race([sequence, timeout]);
    },
  };
}
