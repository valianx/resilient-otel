import {
  Global,
  Module,
  DynamicModule,
  Provider,
  Scope,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { init } from '../core/init.js';
import { createScrubber } from '../scrub/scrubber.js';
import { executionContext } from '../context/execution-context.js';
import type {
  ResilientOtelConfig,
  Scrubber,
  ShutdownHandle,
} from '../types/index.js';

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
 * Providers shared by both entry points: the scrubber, the execution-context
 * singleton, the request interceptor (also registered globally), the HTTP-client
 * interceptor, the request/response logging middleware, the exception filter,
 * the per-request RequestContext, and the trace-header middleware. None of these
 * touch the SDK lifecycle — `init()` and shutdown are wired only by `forRoot`.
 */
function wiringProviders(scrubber: Scrubber): Provider[] {
  return [
    // Provide the scrubber for injection into middleware/filter
    {
      provide: SCRUBBER_TOKEN,
      useValue: scrubber,
    },

    // ExecutionContextService is the core singleton (no decorator needed)
    {
      provide: 'ExecutionContext',
      useValue: executionContext,
    },

    // LoggingMiddleware with scrubber injected
    {
      provide: LoggingMiddleware,
      useFactory: (s: Scrubber) => new LoggingMiddleware(s),
      inject: [SCRUBBER_TOKEN],
    },

    // HttpExceptionFilter with scrubber injected
    {
      provide: HttpExceptionFilter,
      useFactory: (s: Scrubber) => new HttpExceptionFilter(s),
      inject: [SCRUBBER_TOKEN],
    },

    // ExecutionContextInterceptor as global APP_INTERCEPTOR
    {
      provide: APP_INTERCEPTOR,
      useClass: ExecutionContextInterceptor,
    },

    // Transient interceptors
    ExecutionContextInterceptor,
    HttpClientInterceptor,

    // REQUEST-scoped RequestContext for compatibility
    {
      provide: RequestContext,
      useClass: RequestContext,
      scope: Scope.REQUEST,
    },

    // TraceMiddleware for response header injection
    TraceMiddleware,
  ];
}

const WIRING_EXPORTS = [
  'ExecutionContext',
  LoggingMiddleware,
  HttpExceptionFilter,
  HttpClientInterceptor,
  RequestContext,
  TraceMiddleware,
  ExecutionContextInterceptor,
] as const;

/**
 * ObservabilityModule
 *
 * @Global() module that wires the observability stack. Two entry points:
 *
 * - `forRoot(config)` — owns the full lifecycle: calls core `init(config)` once,
 *   provides the ShutdownHandle to TelemetryLifecycleService for graceful
 *   shutdown, and wires the interceptor/middleware/filter/context providers.
 *     ObservabilityModule.forRoot({ scrubber: createScrubber(), ... })
 *
 * - `forWiring({ scrubber })` — wires ONLY the DI providers (interceptor,
 *   middleware, filter, context) and does NOT call `init()`. Use this when the
 *   SDK is initialised earlier in a preload step (e.g. an `instrumentation.ts`
 *   awaited before the app modules load), which is required for auto-
 *   instrumentation to patch http/pg/redis before they are first required.
 *     ObservabilityModule.forWiring({ scrubber: createScrubber() })
 */
@Global()
@Module({})
export class ObservabilityModule {
  static forRoot(config: ResilientOtelConfig): DynamicModule {
    return {
      module: ObservabilityModule,
      providers: [
        // Init the SDK once at module load and provide the ShutdownHandle
        {
          provide: SHUTDOWN_HANDLE,
          useFactory: async (): Promise<ShutdownHandle> => {
            return init(config);
          },
        },

        // TelemetryLifecycleService — singleton, receives ShutdownHandle
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

        // Resolve scrubber for DI wiring. Explicit scrubber wins; fall back to
        // scrubberConfig. The boot guard in init() will catch missing-scrubber.
        ...wiringProviders(config.scrubber ?? createScrubber(config.scrubberConfig)),
      ],
      exports: [TelemetryLifecycleService, ...WIRING_EXPORTS],
    };
  }

  static forWiring(options: { scrubber?: Scrubber }): DynamicModule {
    // Defense in depth: never wire an undefined scrubber into the middleware/
    // filter (failure mode #2). A consumer may pass `handle.scrubber` from an
    // older/disabled init() where it was undefined — fall back to a real
    // redactor so `this.scrubber.scrubAttrs(...)` can never be a TypeError.
    return {
      module: ObservabilityModule,
      providers: wiringProviders(options.scrubber ?? createScrubber()),
      exports: [...WIRING_EXPORTS],
    };
  }
}
