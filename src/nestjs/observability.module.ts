import { Global, Module, DynamicModule, Scope } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { init } from '../core/init.js';
import { executionContext } from '../context/execution-context.js';
import type { ResilientOtelConfig, ShutdownHandle } from '../types/index.js';

import { ExecutionContextInterceptor } from './execution-context.interceptor.js';
import { HttpClientInterceptor } from './http-client.interceptor.js';
import { LoggingMiddleware } from './logging.middleware.js';
import { TraceMiddleware } from './trace.middleware.js';
import { HttpExceptionFilter } from './exception.filter.js';
import { RequestContext } from './request-context.provider.js';
import { TelemetryLifecycleService } from './telemetry-lifecycle.service.js';

// Token for injecting the shutdown handle into TelemetryLifecycleService
const SHUTDOWN_HANDLE = Symbol('RESILIENT_OTEL_SHUTDOWN_HANDLE');
// Token for injecting the scrubber into LoggingMiddleware and HttpExceptionFilter
const SCRUBBER_TOKEN = Symbol('RESILIENT_OTEL_SCRUBBER');

/**
 * ObservabilityModule
 *
 * @Global() module that wires the full observability stack:
 * - Calls core `init(config)` exactly once (AC-1 of PR-3)
 * - Provides the ShutdownHandle to TelemetryLifecycleService for graceful shutdown
 * - Registers ExecutionContextInterceptor as APP_INTERCEPTOR
 * - Exports all services for use in feature modules
 *
 * Usage:
 *   ObservabilityModule.forRoot({ scrubber: createScrubber(), headers: axiomHeaders() })
 */
@Global()
@Module({})
export class ObservabilityModule {
  static forRoot(config: ResilientOtelConfig): DynamicModule {
    return {
      module: ObservabilityModule,
      providers: [
        // 1. Init the SDK once at module load and provide the ShutdownHandle
        {
          provide: SHUTDOWN_HANDLE,
          useFactory: async (): Promise<ShutdownHandle> => {
            return init(config);
          },
        },

        // 2. Provide the scrubber for injection into middleware/filter
        {
          provide: SCRUBBER_TOKEN,
          useValue: config.scrubber,
        },

        // 3. ExecutionContextService is the core singleton (no decorator needed)
        {
          provide: 'ExecutionContext',
          useValue: executionContext,
        },

        // 4. TelemetryLifecycleService — singleton, receives ShutdownHandle
        {
          provide: TelemetryLifecycleService,
          useFactory: (handle: ShutdownHandle): TelemetryLifecycleService => {
            const svc = new TelemetryLifecycleService();
            svc.setShutdownHandle(handle);
            return svc;
          },
          inject: [SHUTDOWN_HANDLE],
          scope: Scope.DEFAULT,
        },

        // 5. LoggingMiddleware with scrubber injected
        {
          provide: LoggingMiddleware,
          useFactory: (scrubber: typeof config.scrubber) =>
            new LoggingMiddleware(scrubber),
          inject: [SCRUBBER_TOKEN],
        },

        // 6. HttpExceptionFilter with scrubber injected
        {
          provide: HttpExceptionFilter,
          useFactory: (scrubber: typeof config.scrubber) =>
            new HttpExceptionFilter(scrubber),
          inject: [SCRUBBER_TOKEN],
        },

        // 7. ExecutionContextInterceptor as global APP_INTERCEPTOR
        {
          provide: APP_INTERCEPTOR,
          useClass: ExecutionContextInterceptor,
        },

        // 8. Transient interceptors
        ExecutionContextInterceptor,
        HttpClientInterceptor,

        // 9. REQUEST-scoped RequestContext for compatibility
        {
          provide: RequestContext,
          useClass: RequestContext,
          scope: Scope.REQUEST,
        },

        // 10. TraceMiddleware for response header injection
        TraceMiddleware,
      ],
      exports: [
        'ExecutionContext',
        TelemetryLifecycleService,
        LoggingMiddleware,
        HttpExceptionFilter,
        HttpClientInterceptor,
        RequestContext,
        TraceMiddleware,
        ExecutionContextInterceptor,
      ],
    };
  }
}
