/**
 * Business taxonomy enums — recipe §11.1.
 * Used as `operation` and `target` span/log attributes to group telemetry.
 */

export enum Operation {
  // HTTP layer
  HttpIncoming = 'http.incoming',
  HttpOutgoing = 'http.outgoing',
  // Data layer
  DbQuery = 'db.query',
  DbTransaction = 'db.transaction',
  CacheGet = 'cache.get',
  CachePut = 'cache.put',
  // Messaging
  MessagePublish = 'message.publish',
  MessageConsume = 'message.consume',
  // Background
  JobRun = 'job.run',
  JobSchedule = 'job.schedule',
  // Auth
  AuthLogin = 'auth.login',
  AuthLogout = 'auth.logout',
  AuthRefresh = 'auth.refresh',
}

export enum Target {
  // Infrastructure
  Postgres = 'postgres',
  Redis = 'redis',
  Kafka = 'kafka',
  // External services
  HttpClient = 'http.client',
  // Internal
  Internal = 'internal',
}

/** Signal tag for log records — recipe §11.7. */
export const SIGNAL_TAG = 'log';

/**
 * Attach standard taxonomy attributes to a span-attributes record.
 * Convenience helper — consumers call this instead of hand-writing attribute keys.
 */
export function taxonomyAttrs(
  operation: Operation | string,
  target: Target | string,
): Record<string, string> {
  return {
    'app.operation': operation,
    'app.target': target,
    signal: SIGNAL_TAG,
  };
}
