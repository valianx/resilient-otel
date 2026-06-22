/**
 * init.killswitch:
 * config.enabled === false (master switch) or OTEL_SDK_DISABLED=true (standard
 * kill-switch) → no-op shutdown, no exporter constructed, boot guard not reached.
 */
import { describe, it, expect, afterEach } from './helpers/test-kit';
import { init } from '../src/core/init';
import { noopScrubber } from '../src/scrub/scrubber';

afterEach(() => {
  delete process.env['OTEL_SDK_DISABLED'];
});

describe('init.killswitch — master switch and kill-switch', () => {
  it('returns no-op handle when OTEL_SDK_DISABLED=true (even if enabled)', async () => {
    process.env['OTEL_SDK_DISABLED'] = 'true';
    // noopScrubber would fail the boot guard, but we never reach it.
    const handle = await init({ enabled: true, scrubber: noopScrubber });
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it('returns no-op handle when config.enabled is false', async () => {
    const handle = await init({ enabled: false, scrubber: noopScrubber });
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it('no-op handle shutdown is idempotent (multiple calls do not throw)', async () => {
    const handle = await init({ enabled: false, scrubber: noopScrubber });
    await handle.shutdown();
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });
});
