/**
 * Business taxonomy enums — recipe §11.1.
 * Used as `operation` and `target` span/log attributes to group telemetry.
 */

/**
 * Axis 1 — what kind of event this is in the flow (recipe §11.1).
 * Every flow starts with `request` and ends with `response` OR `error`.
 */
export enum Operation {
  Request = 'request',
  Response = 'response',
  Error = 'error',
}

/**
 * Axis 2 — who the event interacts with (recipe §11.1). Extensible: pass a
 * custom string to `taxonomyAttrs` when you need a finer-grained value
 * (e.g. 'cache', 'queue', 'auth').
 */
export enum Target {
  Client = 'client', // the original caller (HTTP/gRPC) hitting the server
  External = 'external', // an external service the server calls
  Store = 'store', // persistence (DB, cache, blob)
  Internal = 'internal', // purely internal (validation, transform, policy)
}

/** Signal tag for log records — recipe §11.7. */
export const SIGNAL_TAG = 'log';

/**
 * Signal tag for spans — recipe §11.7. Set automatically on every span by the
 * SDK pipeline so traces are symmetric with logs (`signal: 'log'`) and the same
 * `where ['attributes.signal'] == 'trace'` query partitions telemetry by signal.
 */
export const SIGNAL_TAG_TRACE = 'trace';

/**
 * Attach standard taxonomy attributes to a span/log attributes record.
 * Uses the recipe's bare `operation` / `target` keys so the documented APL
 * queries (e.g. `where ['attributes.operation'] == 'error'`) work verbatim.
 */
export function taxonomyAttrs(
  operation: Operation | string,
  target: Target | string,
): Record<string, string> {
  return {
    operation,
    target,
    signal: SIGNAL_TAG,
  };
}
