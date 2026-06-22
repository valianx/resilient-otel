import { createHash } from 'crypto';

/**
 * Compute SHA-256 hash of a payload (for large-payload metadata logging).
 * Ported from sanitizer.util.ts:329-343.
 */
export function hashPayload(payload: unknown): string {
  const str =
    typeof payload === 'string' ? payload : JSON.stringify(payload);
  return createHash('sha256').update(str).digest('hex');
}

/**
 * Compute the UTF-8 byte length of a payload.
 */
export function getPayloadSize(payload: unknown): number {
  const str =
    typeof payload === 'string' ? payload : JSON.stringify(payload);
  return Buffer.byteLength(str, 'utf8');
}
