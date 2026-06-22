export { ObservabilityModule } from './observability.module.js';
export { ExecutionContextInterceptor } from './execution-context.interceptor.js';
export { HttpClientInterceptor } from './http-client.interceptor.js';
export { LoggingMiddleware } from './logging.middleware.js';
export { TraceMiddleware } from './trace.middleware.js';
export { HttpExceptionFilter } from './exception.filter.js';
export { RequestContext } from './request-context.provider.js';
export { TelemetryLifecycleService } from './telemetry-lifecycle.service.js';
export { WinstonOtelTransport } from './winston-transport.js';

// Re-export core types needed by NestJS consumers
export type { ResilientOtelConfig, ShutdownHandle } from '../types/index.js';
