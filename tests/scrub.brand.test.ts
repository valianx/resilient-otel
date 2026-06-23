/**
 * The scrubber brand MUST be a global registered symbol (Symbol.for), not a
 * plain Symbol(). createScrubber (the /scrub bundle) and init()'s boot guard
 * (the /core + /nestjs bundles) are separate tsup bundles; a plain Symbol()
 * would differ across copies and falsely reject a real scrubber in production.
 * This locks the decision so it can't silently regress.
 */
import { describe, it, expect } from './helpers/test-kit';
import { createScrubber } from '../src/scrub/scrubber';
import { scrubberBrand } from '../src/types/index';

describe('scrubber brand symbol (cross-bundle safety)', () => {
  it('is the global Symbol.for("resilient-otel.scrubber")', () => {
    expect(scrubberBrand).toBe(Symbol.for('resilient-otel.scrubber'));
  });

  it('a real scrubber carries the global brand (detectable from another realm)', () => {
    const scrubber = createScrubber();
    expect(Symbol.for('resilient-otel.scrubber') in scrubber).toBe(true);
  });
});
