import { type Scrubber, type ScrubberConfig, scrubberBrand } from '../types/index.js';
import { DEFAULT_DENYLIST } from './denylist.js';
import { DEFAULT_SECRET_PATTERNS, type SecretPattern } from './secrets.js';
import { scrubAttrs as doScrubAttrs, redactString, type RedactOptions } from './redact.js';

// Re-export the canonical brand symbol (defined in types) used by the boot guard (R5).
export { scrubberBrand };

/**
 * No-op scrubber sentinel — passed to init() intentionally when you want to
 * test the boot guard without configuring a real scrubber.
 * init() rejects this when observability is enabled (R5).
 */
export const noopScrubber: Scrubber = {
  redact: (text: string) => text,
  scrubAttrs: <T extends Record<string, unknown>>(obj: T): T => obj,
  get [scrubberBrand](): true {
    // The brand is present, but init() also checks for the isNoop flag
    return true;
  },
  // Internal sentinel flag — NOT part of the Scrubber interface
} as unknown as Scrubber;

// Mark the noop scrubber so the boot guard can detect it
(noopScrubber as unknown as Record<symbol, unknown>)[Symbol.for('resilient-otel.noop')] = true;

/**
 * Create a real scrubber instance. All config is code-level (no env reads).
 * Defaults: mode 'moderate', replacement '[REDACTED]', maxStringLength 1000.
 * Denylist merge: DEFAULT_DENYLIST ∪ config.extraDenylist.
 */
export function createScrubber(config?: ScrubberConfig): Scrubber {
  const mode = config?.mode ?? 'moderate';
  const replacement = config?.replacement ?? '[REDACTED]';
  const maxStringLength = config?.maxStringLength ?? 1000;

  // Build merged denylist
  const denylist = new Set(DEFAULT_DENYLIST);
  for (const entry of config?.extraDenylist ?? []) {
    denylist.add(entry.toLowerCase());
  }

  // Build merged secret patterns
  const secretPatterns: SecretPattern[] = [
    ...DEFAULT_SECRET_PATTERNS,
    ...(config?.extraSecretPatterns ?? []).map((p, i) => ({
      name: `custom-${i}`,
      pattern: p,
    })),
  ];

  const options: RedactOptions = {
    denylist,
    secretPatterns,
    replacement,
    maxStringLength,
    mode,
  };

  const instance: Scrubber = {
    redact: (text: string) => redactString(text, options),
    scrubAttrs: <T extends Record<string, unknown>>(obj: T): T =>
      doScrubAttrs(obj, options),
    get [scrubberBrand](): true {
      return true;
    },
  };

  return instance;
}

/** Check whether a value is the noopScrubber sentinel. */
export function isNoopScrubber(scrubber: Scrubber): boolean {
  return (
    (scrubber as unknown as Record<symbol, unknown>)[
      Symbol.for('resilient-otel.noop')
    ] === true
  );
}
