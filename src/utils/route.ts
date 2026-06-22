/**
 * Normalize a URL path into a low-cardinality route pattern.
 * Replaces dynamic segments (UUIDs, numeric IDs, long hex strings) with :id
 * so APM tools group spans by route instead of by unique URL.
 *
 * Ported from nest-template/observability/middlewares/logging.middleware.ts:17-36
 */
export function normalizeRoute(path: string): string {
  if (!path || path === '/') return path;

  const [pathname, query] = path.split('?');
  const normalized = pathname
    .split('/')
    .map((segment) => {
      if (!segment) return segment;
      // UUID pattern
      if (
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          segment,
        )
      ) {
        return ':id';
      }
      // Pure numeric ID
      if (/^\d+$/.test(segment)) return ':id';
      // Long hex string (e.g. short hashes, object IDs)
      if (/^[0-9a-f]{20,}$/i.test(segment)) return ':id';
      return segment;
    })
    .join('/');

  return query ? `${normalized}?${query}` : normalized;
}

/**
 * Build a filter function for `ignoreIncomingRequestHook` in HttpInstrumentation.
 * Only spans whose path matches an entry in the allowlist are kept.
 *
 * @param allowlistPatterns - RegExp patterns for paths to KEEP (all others ignored)
 * @param excludePatterns - RegExp patterns for paths to always SKIP (e.g. health checks)
 */
export function makeHttpAllowlistFilter(
  allowlistPatterns: RegExp[],
  excludePatterns: RegExp[] = [/\/health(\/status)?$/, /^\/\.well-known\//],
): (url: string) => boolean {
  return (url: string): boolean => {
    // Always ignore excluded paths
    if (excludePatterns.some((p) => p.test(url))) return true;
    // If allowlist is empty, keep everything
    if (allowlistPatterns.length === 0) return false;
    // Only keep paths in the allowlist
    return !allowlistPatterns.some((p) => p.test(url));
  };
}
