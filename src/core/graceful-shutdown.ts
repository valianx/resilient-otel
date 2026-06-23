/**
 * registerGracefulShutdown — SIGTERM/SIGINT → flush → exit.
 *
 * Registers process.once handlers so the SDK drains all in-flight telemetry
 * before the process exits. Idempotent: the shutdown handle already guards
 * re-entry (src/core/shutdown.ts), so a double-signal does not double-flush.
 *
 * Only registered when the consumer sets `gracefulShutdown: true` in the
 * init() config. Default is false — consumer wires its own handler (or relies
 * on Nest's enableShutdownHooks + TelemetryLifecycleService).
 */
import type { ShutdownHandle } from '../types/index.js';

export function registerGracefulShutdown(handle: ShutdownHandle): void {
  const shutdown = (): void => {
    void handle.shutdown().finally(() => process.exit(0));
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
