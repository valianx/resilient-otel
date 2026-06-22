/**
 * init.bootguard — boot guard (R5):
 * with observability enabled (the default), init() throws when no scrubber or
 * the noopScrubber sentinel is passed. Disabling short-circuits before the guard.
 */
import { describe, it, expect } from './helpers/test-kit';
import { init } from '../src/core/init';
import { noopScrubber, createScrubber } from '../src/scrub/scrubber';

describe('init.bootguard — boot guard (R5)', () => {
  it('rejects with noopScrubber when enabled (default)', async () => {
    await expect(
      init({ scrubber: noopScrubber }),
    ).rejects.toThrow(/noopScrubber is not a valid scrubber/i);
  });

  it('rejects when no scrubber provided and enabled', async () => {
    await expect(
      // Force cast to bypass TS — testing the runtime guard
      init({ scrubber: undefined as unknown as ReturnType<typeof createScrubber> }),
    ).rejects.toThrow(/requires a scrubber/i);
  });

  it('returns no-op handle when enabled is false (no scrubber check)', async () => {
    const handle = await init({ enabled: false, scrubber: noopScrubber });
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });
});
