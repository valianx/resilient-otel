/**
 * scrub.extend — AC-3 of PR-2:
 * Consumer adds custom words via config AND env, merged on built-in bank.
 */
import { describe, it, expect, beforeAll, afterAll } from './helpers/test-kit';
import { createScrubber } from '../src/scrub/scrubber';

describe('scrub.extend — merge order: DEFAULT ∪ extraDenylist ∪ env', () => {
  const originalEnv = process.env['LOG_REDACT_EXTRA_FIELDS'];

  beforeAll(() => {
    process.env['LOG_REDACT_EXTRA_FIELDS'] = 'other_field,env_field';
  });

  afterAll(() => {
    if (originalEnv === undefined) {
      delete process.env['LOG_REDACT_EXTRA_FIELDS'];
    } else {
      process.env['LOG_REDACT_EXTRA_FIELDS'] = originalEnv;
    }
  });

  it('redacts custom_field from extraDenylist config', () => {
    const scrubber = createScrubber({ extraDenylist: ['custom_field'] });
    const result = scrubber.scrubAttrs({
      custom_field: 'x',
      safe: 'ok',
    });
    expect(result.custom_field).toBe('[REDACTED]');
    expect(result.safe).toBe('ok');
  });

  it('redacts other_field from env LOG_REDACT_EXTRA_FIELDS', () => {
    const scrubber = createScrubber({ readEnvDenylist: true });
    const result = scrubber.scrubAttrs({
      other_field: 'y',
      safe: 'ok',
    });
    expect(result.other_field).toBe('[REDACTED]');
    expect(result.safe).toBe('ok');
  });

  it('redacts env_field from env LOG_REDACT_EXTRA_FIELDS', () => {
    const scrubber = createScrubber({ readEnvDenylist: true });
    const result = scrubber.scrubAttrs({ env_field: 'z' });
    expect(result.env_field).toBe('[REDACTED]');
  });

  it('redacts built-in password from DEFAULT_DENYLIST', () => {
    const scrubber = createScrubber({ extraDenylist: ['custom_field'] });
    const result = scrubber.scrubAttrs({ password: 'z', safe: 'ok' });
    expect(result.password).toBe('[REDACTED]');
    expect(result.safe).toBe('ok');
  });

  it('all three sources are merged simultaneously', () => {
    const scrubber = createScrubber({
      extraDenylist: ['custom_field'],
      readEnvDenylist: true,
    });
    const result = scrubber.scrubAttrs({
      custom_field: 'x',
      other_field: 'y',
      password: 'z',
      safe: 'ok',
    });
    expect(result.custom_field).toBe('[REDACTED]');
    expect(result.other_field).toBe('[REDACTED]');
    expect(result.password).toBe('[REDACTED]');
    expect(result.safe).toBe('ok');
  });
});
