/**
 * init.bootguard — AC-1 of PR-2:
 * init() throws when enabled + no scrubber / noop scrubber (R5).
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { init } from '../src/core/init';
import { noopScrubber, createScrubber } from '../src/scrub/scrubber';

const setEnabled = (val: string) => {
  process.env['OBSERVABILITY_ENABLED'] = val;
};
const clearEnabled = () => {
  delete process.env['OBSERVABILITY_ENABLED'];
};

describe('init.bootguard — boot guard (R5)', () => {
  afterAll(() => {
    clearEnabled();
    delete process.env['OTEL_SDK_DISABLED'];
    delete process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
  });

  it('rejects with noopScrubber when observability is enabled', async () => {
    setEnabled('true');
    process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] = 'http://localhost:4318';
    await expect(
      init({ scrubber: noopScrubber }),
    ).rejects.toThrow(/noopScrubber is not a valid scrubber/i);
  });

  it('rejects when no scrubber provided and observability is enabled', async () => {
    setEnabled('true');
    process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] = 'http://localhost:4318';
    await expect(
      // Force cast to bypass TS — testing runtime guard
      init({ scrubber: undefined as unknown as ReturnType<typeof createScrubber> }),
    ).rejects.toThrow(/requires a scrubber/i);
  });

  it('returns no-op handle when OBSERVABILITY_ENABLED is false (no scrubber check)', async () => {
    setEnabled('false');
    const handle = await init({ scrubber: noopScrubber });
    // Should not throw; no-op handle resolves shutdown immediately
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it('returns no-op handle when OBSERVABILITY_ENABLED is unset', async () => {
    clearEnabled();
    const handle = await init({ scrubber: noopScrubber });
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });
});
