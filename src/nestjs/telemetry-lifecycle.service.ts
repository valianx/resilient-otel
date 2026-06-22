import {
  Injectable,
  OnModuleDestroy,
  BeforeApplicationShutdown,
} from '@nestjs/common';
import type { ShutdownHandle } from '../types/index.js';

/**
 * TelemetryLifecycleService
 *
 * Maps NestJS lifecycle hooks to the core shutdown sequence.
 * `beforeApplicationShutdown` is the primary hook (SIGTERM/SIGINT).
 * `onModuleDestroy` is the backup in case the primary is missed.
 *
 * Double-shutdown guard: if `beforeApplicationShutdown` already ran,
 * `onModuleDestroy` is a no-op (AC-2 of PR-3).
 *
 * Ported from nest-template/observability/services/telemetry-lifecycle.service.ts:34-84.
 */
@Injectable()
export class TelemetryLifecycleService
  implements OnModuleDestroy, BeforeApplicationShutdown
{
  private shutdownHandle: ShutdownHandle | null = null;
  private isShuttingDown = false;
  private shutdownComplete = false;

  /** Called by ObservabilityModule.forRoot after init() resolves. */
  setShutdownHandle(handle: ShutdownHandle): void {
    this.shutdownHandle = handle;
  }

  async beforeApplicationShutdown(signal?: string): Promise<void> {
    if (this.isShuttingDown) return;
    void signal; // documented param, not logged to avoid PII in signal names
    await this.performShutdown();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.shutdownComplete || this.isShuttingDown) return;
    await this.performShutdown();
  }

  private async performShutdown(): Promise<void> {
    this.isShuttingDown = true;
    try {
      await this.shutdownHandle?.shutdown();
    } finally {
      this.shutdownComplete = true;
    }
  }

  /** Expose for health checks. */
  isTelemetryHealthy(): boolean {
    return !this.shutdownComplete;
  }
}
