import { DEFAULT_DENYLIST, INFRASTRUCTURE_HEADERS } from './denylist.js';
import { DEFAULT_SECRET_PATTERNS, type SecretPattern } from './secrets.js';

const CIRCULAR_SENTINEL = '[CIRCULAR_REFERENCE]';
const FIELD_ERROR_SENTINEL = '[FIELD_SANITIZATION_ERROR]';
const REDACTED = '[REDACTED]';

export interface RedactOptions {
  denylist: ReadonlySet<string>;
  secretPatterns: readonly SecretPattern[];
  replacement: string;
  maxStringLength: number;
  mode: 'strict' | 'moderate' | 'disabled';
}

/** Check whether a field name matches any entry in the denylist (case-insensitive substring). */
function isDenylisted(key: string, denylist: ReadonlySet<string>): boolean {
  const lower = key.toLowerCase();
  for (const entry of denylist) {
    if (lower.includes(entry)) return true;
  }
  return false;
}

/** Apply all secret-regex patterns to a string, replacing matches. */
export function redactSecrets(
  text: string,
  patterns: readonly SecretPattern[],
  replacement: string,
): string {
  let result = text;
  for (const { pattern } of patterns) {
    // Reset lastIndex for global regexes to avoid state pollution between calls
    const globalPattern = new RegExp(
      pattern.source,
      pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g',
    );
    result = result.replace(globalPattern, replacement);
  }
  return result;
}

/** Truncate a string to maxLength with a suffix showing how many chars were cut. */
function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...[truncated ${value.length - maxLength} chars]`;
}

/** Recursively scrub an object or value. */
export function scrubValue(
  key: string | null,
  value: unknown,
  options: RedactOptions,
  seen: WeakSet<object>,
  isHeader = false,
): unknown {
  if (options.mode === 'disabled') return value;

  // Redact denylisted fields immediately
  if (key !== null && isDenylisted(key, options.denylist)) {
    return options.replacement;
  }

  if (typeof value === 'string') {
    let result = value;
    if (options.mode === 'strict') {
      result = truncate(result, options.maxStringLength);
    }
    // Apply secret patterns to string values
    result = redactSecrets(result, options.secretPatterns, options.replacement);
    return result;
  }

  if (typeof value !== 'object' || value === null) {
    return value;
  }

  // Circular reference guard
  if (seen.has(value as object)) return CIRCULAR_SENTINEL;
  seen.add(value as object);

  try {
    if (Array.isArray(value)) {
      return value.map((item) => scrubValue(null, item, options, seen, isHeader));
    }

    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const k of Object.keys(record)) {
      // Drop infrastructure headers entirely (noise reduction)
      if (isHeader && INFRASTRUCTURE_HEADERS.has(k.toLowerCase())) continue;

      try {
        result[k] = scrubValue(k, record[k], options, seen, isHeader);
      } catch {
        result[k] = FIELD_ERROR_SENTINEL;
      }
    }
    return result;
  } finally {
    seen.delete(value as object);
  }
}

/** Top-level entry: scrub a flat or nested attributes object. */
export function scrubAttrs<T extends Record<string, unknown>>(
  obj: T,
  options: RedactOptions,
): T {
  if (options.mode === 'disabled') return obj;
  const seen = new WeakSet<object>();
  return scrubValue(null, obj, options, seen) as T;
}

/** Top-level entry: redact secrets from a single string. */
export function redactString(
  text: string,
  options: Pick<RedactOptions, 'secretPatterns' | 'replacement'>,
): string {
  return redactSecrets(text, options.secretPatterns, options.replacement);
}

export { DEFAULT_DENYLIST, DEFAULT_SECRET_PATTERNS, REDACTED };
