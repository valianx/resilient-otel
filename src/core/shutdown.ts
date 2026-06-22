import type { NodeSDK } from '@opentelemetry/sdk-node';
import type { LoggerProvider } from '@opentelemetry/sdk-logs';
import type { MeterProvider } from '@opentelemetry/sdk-metrics';
import type { SpanProcessor } from '@opentelemetry/sdk-trace-base';
import type { ShutdownHandle } from '../types/index.js';

export interface ShutdownDependencies {
  sdk: NodeSDK;
  loggerProvider: LoggerProvider;
  meterProvider: MeterProvider;
  spanProcessor: SpanProcessor;
}

/**
 * Build the framework-agnostic shutdown function.
 * Performs: flush spans → flush logs → flush metrics → SDK shutdown.
 * Each step is attempted independently; a failure does not abort subsequent steps.
 * The whole sequence is raced against a timeout (default 10s).
 *
 * Ported from telemetry-lifecycle.service.ts:139-177.
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

      const shutdownSequence = performShutdown(deps);
      const timeout = new Promise<void>((resolve) =>
        setTimeout(() => {
          // Resolve rather than reject so the race always completes
          resolve();
        }, timeoutMs),
      );

      await Promise.race([shutdownSequence, timeout]);
    },
  };
}

async function performShutdown(deps: ShutdownDependencies): Promise<void> {
  // 1. Flush spans
  try {
    await deps.spanProcessor.forceFlush();
  } catch {
    // Non-fatal: continue shutdown sequence
  }

  // 2. Flush logs
  try {
    await deps.loggerProvider.forceFlush();
  } catch {
    // Non-fatal
  }

  // 3. Flush metrics
  try {
    await deps.meterProvider.forceFlush();
  } catch {
    // Non-fatal
  }

  // 4. SDK shutdown
  try {
    await deps.sdk.shutdown();
  } catch {
    // Non-fatal
  }
}
