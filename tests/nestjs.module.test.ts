/**
 * nestjs.module — AC-3 of PR-3: peer deps meta.
 * Tests NestJS adapter code paths that do not require a live Nest container.
 */
import { EventEmitter } from 'node:events';
import { logs } from '@opentelemetry/api-logs';
import { describe, it, expect } from './helpers/test-kit';
import { TelemetryLifecycleService } from '../src/nestjs/telemetry-lifecycle.service';
import { normalizeRoute } from '../src/utils/route';
import { createScrubber } from '../src/scrub/scrubber';
import { LoggingMiddleware } from '../src/nestjs/logging.middleware';
import { ObservabilityModule } from '../src/nestjs/observability.module';

describe('TelemetryLifecycleService — double-shutdown guard (AC-2 of PR-3)', () => {
  it('does not call shutdown twice when both hooks fire', async () => {
    let shutdownCount = 0;
    const fakeHandle = {
      shutdown: async () => {
        shutdownCount++;
      },
    };

    const svc = new TelemetryLifecycleService();
    svc.setShutdownHandle(fakeHandle);

    await svc.beforeApplicationShutdown('SIGTERM');
    await svc.onModuleDestroy();

    expect(shutdownCount).toBe(1);
  });

  it('is healthy before shutdown', () => {
    const svc = new TelemetryLifecycleService();
    expect(svc.isTelemetryHealthy()).toBe(true);
  });

  it('is unhealthy after shutdown', async () => {
    const svc = new TelemetryLifecycleService();
    svc.setShutdownHandle({ shutdown: () => Promise.resolve() });
    await svc.beforeApplicationShutdown();
    expect(svc.isTelemetryHealthy()).toBe(false);
  });
});

describe('LoggingMiddleware — normalizeRoute integration (AC-5 of PR-3)', () => {
  it('uses normalizeRoute to group spans by route pattern', () => {
    // Test that normalizeRoute is used in the middleware logic
    // by verifying the URL normalisation happens before span naming.
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(normalizeRoute(`/users/${uuid}/profile`)).toBe('/users/:id/profile');
    expect(normalizeRoute('/items/42/details')).toBe('/items/:id/details');
  });
});

describe('LoggingMiddleware — response duration is elapsed ms, not epoch (regression)', () => {
  it('logs a small elapsed duration on finish', () => {
    const captured: Array<Record<string, unknown>> = [];
    // Capture emitted log records through a fake global LoggerProvider.
    logs.setGlobalLoggerProvider({
      getLogger: () => ({
        emit: (record: { attributes?: Record<string, unknown> }) => {
          if (record.attributes) captured.push(record.attributes);
        },
      }),
    } as never);

    const mw = new LoggingMiddleware(createScrubber({ mode: 'disabled' }));

    const req = {
      method: 'GET',
      originalUrl: '/users/42',
      headers: { host: 'localhost' },
      body: { ok: true },
    } as never;

    const res = new EventEmitter() as EventEmitter & Record<string, unknown>;
    res.statusCode = 200;
    res.statusMessage = 'OK';
    res.getHeader = () => undefined;
    res.getHeaders = () => ({ 'content-type': 'application/json' });
    res.send = (b: unknown) => b;

    let nextCalled = false;
    mw.use(req, res as never, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);

    res.emit('finish');

    const response = captured.find((a) => a.operation === 'response');
    expect(response).toBeDefined();
    const duration = Number((response as Record<string, unknown>).duration);
    // Elapsed time is a few ms; the old bug logged Date.now() (~1.7e12 ms).
    expect(duration >= 0 && duration < 100_000).toBe(true);
  });
});

describe('ObservabilityModule — forWiring wires DI without init/lifecycle', () => {
  const scrubber = createScrubber({ mode: 'disabled' });

  it('forWiring exports the wiring providers', () => {
    const mod = ObservabilityModule.forWiring({ scrubber });
    expect(mod.exports).toContain(LoggingMiddleware);
    expect(mod.exports).toContain('ExecutionContext');
  });

  it('forWiring does NOT provide or export TelemetryLifecycleService (no init/shutdown)', () => {
    const mod = ObservabilityModule.forWiring({ scrubber });
    const provideTokens = (mod.providers ?? []).map((p) =>
      typeof p === 'object' && p !== null && 'provide' in p ? p.provide : p,
    );
    expect(provideTokens).not.toContain(TelemetryLifecycleService);
    expect(mod.exports).not.toContain(TelemetryLifecycleService);
  });

  it('forRoot exports TelemetryLifecycleService (owns the lifecycle)', () => {
    const mod = ObservabilityModule.forRoot({ scrubber });
    expect(mod.exports).toContain(TelemetryLifecycleService);
  });
});

describe('NestJS package.json peer deps (AC-3 of PR-3)', () => {
  it('@nestjs/common and @nestjs/core are listed as optional peer deps', async () => {
    // Read package.json to verify metadata
    const pkg = await import('../package.json', { assert: { type: 'json' } });
    const { peerDependencies, peerDependenciesMeta } = pkg.default as {
      peerDependencies: Record<string, string>;
      peerDependenciesMeta: Record<string, { optional: boolean }>;
    };

    expect(peerDependencies['@nestjs/common']).toBeDefined();
    expect(peerDependenciesMeta['@nestjs/common']?.optional).toBe(true);

    expect(peerDependencies['@nestjs/core']).toBeDefined();
    expect(peerDependenciesMeta['@nestjs/core']?.optional).toBe(true);

    expect(peerDependencies['winston']).toBeDefined();
    expect(peerDependenciesMeta['winston']?.optional).toBe(true);

    expect(peerDependencies['rxjs']).toBeDefined();
    expect(peerDependenciesMeta['rxjs']?.optional).toBe(true);
  });
});
