/**
 * scrub.extend:
 * Consumer adds custom words via config, merged on the built-in denylist.
 * Merge order: DEFAULT_DENYLIST ∪ config.extraDenylist (no env channel).
 */
import { describe, it, expect } from './helpers/test-kit';
import { createScrubber } from '../src/scrub/scrubber';

describe('scrub.extend — merge order: DEFAULT ∪ extraDenylist', () => {
  it('redacts custom_field from extraDenylist config', () => {
    const scrubber = createScrubber({ extraDenylist: ['custom_field'] });
    const result = scrubber.scrubAttrs({ custom_field: 'x', safe: 'ok' });
    expect(result.custom_field).toBe('[REDACTED]');
    expect(result.safe).toBe('ok');
  });

  it('redacts multiple custom fields from extraDenylist', () => {
    const scrubber = createScrubber({
      extraDenylist: ['other_field', 'env_field'],
    });
    const result = scrubber.scrubAttrs({
      other_field: 'y',
      env_field: 'z',
      safe: 'ok',
    });
    expect(result.other_field).toBe('[REDACTED]');
    expect(result.env_field).toBe('[REDACTED]');
    expect(result.safe).toBe('ok');
  });

  it('redacts built-in password from DEFAULT_DENYLIST', () => {
    const scrubber = createScrubber({ extraDenylist: ['custom_field'] });
    const result = scrubber.scrubAttrs({ password: 'z', safe: 'ok' });
    expect(result.password).toBe('[REDACTED]');
    expect(result.safe).toBe('ok');
  });

  it('default + custom are merged simultaneously', () => {
    const scrubber = createScrubber({ extraDenylist: ['custom_field'] });
    const result = scrubber.scrubAttrs({
      custom_field: 'x',
      password: 'z',
      safe: 'ok',
    });
    expect(result.custom_field).toBe('[REDACTED]');
    expect(result.password).toBe('[REDACTED]');
    expect(result.safe).toBe('ok');
  });
});
