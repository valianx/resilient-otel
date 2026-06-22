import { type Scrubber, type ScrubberConfig } from '../types/index.js';
import { DEFAULT_DENYLIST } from './denylist.js';
import { DEFAULT_SECRET_PATTERNS, type SecretPattern } from './secrets.js';
import { scrubAttrs as doScrubAttrs, redactString, type RedactOptions } from './redact.js';
import { readEnvConfig } from '../config/env.js';

// The brand symbol used by the boot guard (R5).
// Declared as a module-level const so it's the same symbol across all calls.
export const scrubberBrand: unique symbol = Symbol('resilient-otel.scrubber');

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
 * Create a real scrubber instance. Merge order:
 *   DEFAULT_DENYLIST ∪ extraDenylist ∪ env LOG_REDACT_EXTRA_FIELDS
 */
export function createScrubber(config?: ScrubberConfig): Scrubber {
  const envCfg = readEnvConfig();

  const mode = config?.mode ?? envCfg.sanitizationMode;
  const replacement = config?.replacement ?? '[REDACTED]';
  const maxStringLength = config?.maxStringLength ?? envCfg.maxStringLength;
  const readEnvDenylist = config?.readEnvDenylist ?? true;

  // Build merged denylist
  const denylist = new Set(DEFAULT_DENYLIST);
  for (const entry of config?.extraDenylist ?? []) {
    denylist.add(entry.toLowerCase());
  }
  if (readEnvDenylist) {
    for (const field of envCfg.extraDenylistFields) {
      denylist.add(field.toLowerCase());
    }
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
