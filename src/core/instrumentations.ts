/**
 * buildDefaultInstrumentations — library-owned pruned instrumentation allowlist.
 *
 * The default set covers the dependencies a typical NestJS + pg + ioredis service
 * actually uses: http, express, nestjs-core, pg, ioredis, undici, runtime-node.
 * All other auto-instrumentation packages (amqplib, aws-sdk, graphql, …) are
 * disabled, so consumers avoid noisy spans without hand-writing ~25 enabled:false
 * entries.
 *
 * Built via dynamic import of @opentelemetry/auto-instrumentations-node (an
 * optional peer dep) so the library does not hard-depend on the full
 * auto-instrumentation package. If the package is absent, diag.warn is emitted
 * and [] is returned — the SDK still starts with no auto-instrumentations rather
 * than crashing. This mirrors the gRPC exporter fallback in src/core/exporters.ts.
 *
 * ignoreIncomingPaths wires an ignoreIncomingRequestHook on HttpInstrumentation
 * so health-check routes are excluded from HTTP tracing without additional code
 * in the consumer.
 *
 * Documented allowlist (the set this function enables):
 *   @opentelemetry/instrumentation-http
 *   @opentelemetry/instrumentation-express
 *   @opentelemetry/instrumentation-nestjs-core
 *   @opentelemetry/instrumentation-pg
 *   @opentelemetry/instrumentation-ioredis
 *   @opentelemetry/instrumentation-redis
 *   @opentelemetry/instrumentation-undici
 *   @opentelemetry/instrumentation-runtime-node
 */
import { diag } from '@opentelemetry/api';
import type { IncomingMessage } from 'http';

/** Instrumentation package names that the library enables by default. */
const ALLOWED_INSTRUMENTATIONS = new Set([
  '@opentelemetry/instrumentation-http',
  '@opentelemetry/instrumentation-express',
  '@opentelemetry/instrumentation-nestjs-core',
  '@opentelemetry/instrumentation-pg',
  '@opentelemetry/instrumentation-ioredis',
  '@opentelemetry/instrumentation-redis',
  '@opentelemetry/instrumentation-undici',
  '@opentelemetry/instrumentation-runtime-node',
]);

export interface DefaultInstrumentationsOptions {
  /** Extra instrumentations appended after the default set is built. */
  extraInstrumentations?: unknown[];
  /** Instrumentation package names to remove from the default set. */
  disableInstrumentations?: string[];
  /** URL patterns (string = substring match, RegExp = test) for HTTP ignore hook. */
  ignoreIncomingPaths?: (string | RegExp)[];
}

/**
 * Build the library's default pruned instrumentation set.
 *
 * Returns [] (never throws) when @opentelemetry/auto-instrumentations-node is
 * absent, logging a diag.warn so the consumer knows why spans are missing.
 */
export async function buildDefaultInstrumentations(
  opts: DefaultInstrumentationsOptions = {},
): Promise<unknown[]> {
  let getNodeAutoInstrumentations: (
    config: Record<string, { enabled: boolean }>,
  ) => unknown[];

  try {
    const mod = await import('@opentelemetry/auto-instrumentations-node');
    getNodeAutoInstrumentations = (mod as { getNodeAutoInstrumentations: typeof getNodeAutoInstrumentations }).getNodeAutoInstrumentations;
  } catch {
    diag.warn(
      '[resilient-otel] @opentelemetry/auto-instrumentations-node is not installed. ' +
        'useDefaultInstrumentations: true requires it as an optional peer dep. ' +
        'Falling back to no auto-instrumentations.',
    );
    return [...(opts.extraInstrumentations ?? [])];
  }

  // Build the disable map: everything NOT in the allowlist is disabled.
  // Also honour disableInstrumentations from the consumer.
  const disableSet = new Set(opts.disableInstrumentations ?? []);

  // We need to discover all instrumentation names to disable the ones not in
  // our allowlist. We do this by calling getNodeAutoInstrumentations with all
  // known packages explicitly disabled, then only enabling our allowlist.
  // In practice we enumerate the known set and disable everything outside it.
  const ALL_KNOWN_INSTRUMENTATIONS = [
    '@opentelemetry/instrumentation-amqplib',
    '@opentelemetry/instrumentation-aws-lambda',
    '@opentelemetry/instrumentation-aws-sdk',
    '@opentelemetry/instrumentation-bunyan',
    '@opentelemetry/instrumentation-cassandra-driver',
    '@opentelemetry/instrumentation-connect',
    '@opentelemetry/instrumentation-cucumber',
    '@opentelemetry/instrumentation-dataloader',
    '@opentelemetry/instrumentation-dns',
    '@opentelemetry/instrumentation-express',
    '@opentelemetry/instrumentation-fastify',
    '@opentelemetry/instrumentation-fs',
    '@opentelemetry/instrumentation-generic-pool',
    '@opentelemetry/instrumentation-graphql',
    '@opentelemetry/instrumentation-grpc',
    '@opentelemetry/instrumentation-hapi',
    '@opentelemetry/instrumentation-http',
    '@opentelemetry/instrumentation-ioredis',
    '@opentelemetry/instrumentation-kafkajs',
    '@opentelemetry/instrumentation-knex',
    '@opentelemetry/instrumentation-koa',
    '@opentelemetry/instrumentation-lru-memoizer',
    '@opentelemetry/instrumentation-memcached',
    '@opentelemetry/instrumentation-mongodb',
    '@opentelemetry/instrumentation-mongoose',
    '@opentelemetry/instrumentation-mysql2',
    '@opentelemetry/instrumentation-mysql',
    '@opentelemetry/instrumentation-nestjs-core',
    '@opentelemetry/instrumentation-net',
    '@opentelemetry/instrumentation-oracledb',
    '@opentelemetry/instrumentation-pg',
    '@opentelemetry/instrumentation-pino',
    '@opentelemetry/instrumentation-redis',
    '@opentelemetry/instrumentation-restify',
    '@opentelemetry/instrumentation-router',
    '@opentelemetry/instrumentation-runtime-node',
    '@opentelemetry/instrumentation-socket.io',
    '@opentelemetry/instrumentation-tedious',
    '@opentelemetry/instrumentation-undici',
    '@opentelemetry/instrumentation-winston',
  ];

  // Build config map: disable everything outside the allowlist, or explicitly
  // in disableSet. HTTP gets special treatment for ignoreIncomingPaths.
  const configMap: Record<string, { enabled: boolean; ignoreIncomingRequestHook?: (req: IncomingMessage) => boolean }> = {};

  for (const name of ALL_KNOWN_INSTRUMENTATIONS) {
    const isAllowed = ALLOWED_INSTRUMENTATIONS.has(name) && !disableSet.has(name);
    if (!isAllowed) {
      configMap[name] = { enabled: false };
      continue;
    }

    // Wire ignoreIncomingRequestHook for http instrumentation if paths are provided.
    if (name === '@opentelemetry/instrumentation-http' && opts.ignoreIncomingPaths?.length) {
      const patterns = opts.ignoreIncomingPaths;
      configMap[name] = {
        enabled: true,
        ignoreIncomingRequestHook: (req: IncomingMessage): boolean => {
          const url = req.url ?? '';
          return patterns.some((p) =>
            typeof p === 'string' ? url.includes(p) : p.test(url),
          );
        },
      };
    } else {
      configMap[name] = { enabled: true };
    }
  }

  const instrumentations = getNodeAutoInstrumentations(configMap);
  return [...instrumentations, ...(opts.extraInstrumentations ?? [])];
}
