/**
 * init.killswitch — AC-2 of PR-2:
 * OTEL_SDK_DISABLED=true or OBSERVABILITY_ENABLED=false → no-op shutdown,
 * no exporter constructed.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { init } from '../src/core/init';
import { noopScrubber } from '../src/scrub/scrubber';

afterEach(() => {
  delete process.env['OTEL_SDK_DISABLED'];
  delete process.env['OBSERVABILITY_ENABLED'];
});

describe('init.killswitch — kill-switch and master switch', () => {
  it('returns no-op handle when OTEL_SDK_DISABLED=true', async () => {
    process.env['OTEL_SDK_DISABLED'] = 'true';
    process.env['OBSERVABILITY_ENABLED'] = 'true'; // enabled, but kill-switch takes priority
    // Should not throw even with noopScrubber because we never reach the boot guard
    const handle = await init({ scrubber: noopScrubber });
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it('returns no-op handle when OBSERVABILITY_ENABLED=false', async () => {
    process.env['OBSERVABILITY_ENABLED'] = 'false';
    const handle = await init({ scrubber: noopScrubber });
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it('no-op handle shutdown is idempotent (multiple calls do not throw)', async () => {
    process.env['OBSERVABILITY_ENABLED'] = 'false';
    const handle = await init({ scrubber: noopScrubber });
    await handle.shutdown();
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });
});
