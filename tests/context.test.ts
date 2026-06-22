/**
 * context — ALS run/get/update; no-op degrade when ALS absent (R4).
 */
import { describe, it, expect } from 'bun:test';
import { executionContext } from '../src/context/execution-context';

describe('context — AsyncLocalStorage execution context', () => {
  it('returns undefined when no context is active', () => {
    expect(executionContext.get()).toBeUndefined();
  });

  it('hasContext returns false outside a run()', () => {
    expect(executionContext.hasContext()).toBe(false);
  });

  it('run() makes context available via get()', async () => {
    const ctx = executionContext.createContext('http', {
      httpMethod: 'GET',
      httpUrl: '/api/test',
    });
    let captured: ReturnType<typeof executionContext.get>;
    executionContext.run(ctx, () => {
      captured = executionContext.get();
    });
    expect(captured!.contextType).toBe('http');
    expect(captured!.httpMethod).toBe('GET');
  });

  it('runAsync() propagates context through await boundaries', async () => {
    const ctx = executionContext.createContext('kafka', { kafkaTopic: 'orders' });
    let captured: ReturnType<typeof executionContext.get>;
    await executionContext.runAsync(ctx, async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      captured = executionContext.get();
    });
    expect(captured!.kafkaTopic).toBe('orders');
  });

  it('update() mutates the active context', () => {
    const ctx = executionContext.createContext('http');
    executionContext.run(ctx, () => {
      executionContext.update({ userId: 'user-42' });
      const updated = executionContext.get();
      expect(updated!.userId).toBe('user-42');
    });
  });

  it('getOrThrow() throws when no context is active', () => {
    expect(() => executionContext.getOrThrow()).toThrow(
      /no execution context found/i,
    );
  });

  it('context does not leak across sibling run() calls', () => {
    const ctxA = executionContext.createContext('http', { httpUrl: '/a' });
    const ctxB = executionContext.createContext('http', { httpUrl: '/b' });
    let urlInB: string | undefined;
    executionContext.run(ctxA, () => {
      executionContext.run(ctxB, () => {
        urlInB = executionContext.get()?.httpUrl;
      });
    });
    expect(urlInB).toBe('/b');
  });

  it('createContext generates unique executionIds', () => {
    const a = executionContext.createContext('http');
    const b = executionContext.createContext('http');
    expect(a.executionId).not.toBe(b.executionId);
  });
});
