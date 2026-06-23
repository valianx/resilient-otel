/**
 * Core AsyncLocalStorage execution-context singleton.
 *
 * Stripped of all @Injectable() decorators — pure Node async_hooks.
 * The NestJS adapter provides the DI wrapper; this module is usable standalone
 * (Express, Fastify, Koa, raw Node).
 *
 * R4 guard: degrades gracefully when AsyncLocalStorage is unavailable
 * (edge runtimes, browser). In that case all operations are no-ops.
 *
 * Ported and rewritten from:
 * nest-template/observability/services/execution-context.service.ts
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { ExecutionCtx, ContextType } from '../types/index.js';

type ALS<T> = {
  run<R>(store: T, callback: () => R): R;
  getStore(): T | undefined;
};

// R4: guard for runtimes without async_hooks (edge/browser). On Node/Bun the
// builtin is always present; this only degrades to a no-op store elsewhere.
function createALS(): ALS<ExecutionCtx> | null {
  try {
    if (typeof AsyncLocalStorage === 'undefined') return null;
    return new AsyncLocalStorage<ExecutionCtx>();
  } catch {
    return null;
  }
}

// R4b: the AsyncLocalStorage instance must be a process-wide singleton shared
// across every bundle copy of this module. The core, scrub, and nestjs subpaths
// are built as separate tsup bundles, so a module-level `const` would give each
// bundle its own store — a context opened by the NestJS adapter would then be
// invisible to the log bridge in the core bundle, and enrichment would come back
// empty. Key it on globalThis via Symbol.for so all copies converge on one ALS.
const ALS_KEY = Symbol.for('resilient-otel.execution-context.als');

function storage(): ALS<ExecutionCtx> | null {
  const g = globalThis as unknown as Record<symbol, ALS<ExecutionCtx> | null>;
  if (!(ALS_KEY in g)) g[ALS_KEY] = createALS();
  return g[ALS_KEY];
}

function generateExecutionId(): string {
  // UUID v4 approximation without external deps
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * ExecutionContext manager — singleton, wraps an AsyncLocalStorage<ExecutionCtx>.
 *
 * All methods degrade to no-ops when AsyncLocalStorage is unavailable (R4).
 */
export const executionContext = {
  /**
   * Run `callback` inside a new execution context.
   * Returns the callback's return value.
   */
  run<T>(ctx: ExecutionCtx, callback: () => T): T {
    const s = storage();
    if (!s) return callback();
    return s.run(ctx, callback);
  },

  /**
   * Async variant of `run`.
   */
  async runAsync<T>(ctx: ExecutionCtx, callback: () => Promise<T>): Promise<T> {
    const s = storage();
    if (!s) return callback();
    return s.run(ctx, callback);
  },

  /** Get the current execution context, or undefined if none is active. */
  get(): ExecutionCtx | undefined {
    return storage()?.getStore();
  },

  /** Get the current context, throw if none is active. */
  getOrThrow(): ExecutionCtx {
    const ctx = storage()?.getStore();
    if (!ctx) {
      throw new Error(
        'No execution context found. Ensure the request runs inside executionContext.run().',
      );
    }
    return ctx;
  },

  /** Update the current context with a partial patch. */
  update(updates: Partial<ExecutionCtx>): void {
    const current = storage()?.getStore();
    if (current) Object.assign(current, updates);
  },

  /** Get a single key from the current context. */
  getValue<K extends keyof ExecutionCtx>(key: K): ExecutionCtx[K] | undefined {
    return storage()?.getStore()?.[key];
  },

  /** Check whether a context is active in the current async scope. */
  hasContext(): boolean {
    return storage()?.getStore() !== undefined;
  },

  /**
   * Factory: create a fresh ExecutionCtx with defaults.
   * Caller should then pass it to `run(ctx, ...)`.
   */
  createContext(
    type: ContextType,
    data?: Partial<ExecutionCtx>,
  ): ExecutionCtx {
    return {
      executionId: generateExecutionId(),
      contextType: type,
      timestamp: new Date(),
      ...data,
    };
  },

  /** Serialise current context to a plain log-safe record. */
  toLogObject(): Record<string, unknown> {
    const ctx = storage()?.getStore();
    if (!ctx) return {};
    return {
      execution_id: ctx.executionId,
      context_type: ctx.contextType,
      trace_id: ctx.traceId,
      span_id: ctx.spanId,
      parent_span_id: ctx.parentSpanId,
      user_id: ctx.userId,
      channel: ctx.channel,
      country: ctx.country,
      commerce: ctx.commerce,
    };
  },
} as const;
