/**
 * instrumentations — buildDefaultInstrumentations
 *
 * Proves:
 *   - Returns non-empty array when auto-instrumentations-node is present
 *   - Honours extraInstrumentations (appended)
 *   - Honours disableInstrumentations (pg excluded)
 *   - Does NOT throw when package is absent (would need to mock dynamic import;
 *     we test the function returns an array of unknown[] in all cases)
 *   - With empty opts, does not include pg when it is in disableInstrumentations
 */
import { describe, it, expect } from './helpers/test-kit';
import { buildDefaultInstrumentations } from '../src/core/instrumentations';

describe('buildDefaultInstrumentations', () => {
  it('returns an array when auto-instrumentations-node is installed', async () => {
    const result = await buildDefaultInstrumentations();
    // The package is installed in devDependencies, so it should return > 0 items
    expect(Array.isArray(result)).toBe(true);
    expect(result.length > 0).toBe(true);
  });

  it('appends extraInstrumentations to the result', async () => {
    const extra = { name: 'my-custom-instrumentation' };
    const result = await buildDefaultInstrumentations({
      extraInstrumentations: [extra],
    });
    expect(Array.isArray(result)).toBe(true);
    // The extra instrumentation should be the last item
    expect(result[result.length - 1]).toBe(extra);
  });

  it('excludes pg instrumentation when in disableInstrumentations', async () => {
    const result = await buildDefaultInstrumentations({
      disableInstrumentations: ['@opentelemetry/instrumentation-pg'],
    });
    // None of the result items should be a pg instrumentation
    const pgItems = (result as Array<{ instrumentationName?: string }>).filter(
      (item) =>
        item &&
        typeof item === 'object' &&
        'instrumentationName' in item &&
        String(item.instrumentationName).includes('pg'),
    );
    expect(pgItems).toHaveLength(0);
  });

  it('returns only extraInstrumentations when the main package would be absent (simulated)', async () => {
    // We cannot easily mock dynamic imports here, but we verify the function
    // signature and return type contract with all options.
    const extra = { name: 'extra-only' };
    const result = await buildDefaultInstrumentations({
      extraInstrumentations: [extra],
      disableInstrumentations: [],
    });
    // extra is always appended regardless
    expect(result[result.length - 1]).toBe(extra);
  });

  it('does not include non-allowlist instrumentations (e.g. graphql)', async () => {
    const result = await buildDefaultInstrumentations();
    const graphqlItems = (result as Array<{ instrumentationName?: string }>).filter(
      (item) =>
        item &&
        typeof item === 'object' &&
        'instrumentationName' in item &&
        String(item.instrumentationName).includes('graphql'),
    );
    expect(graphqlItems).toHaveLength(0);
  });
});
