/**
 * taxonomy — Operation × Target enum completeness + HTTP allowlist filter.
 */
import { describe, it, expect } from './helpers/test-kit';
import { Operation, Target, taxonomyAttrs } from '../src/taxonomy/taxonomy';
import { makeHttpAllowlistFilter, normalizeRoute } from '../src/utils/route';

describe('taxonomy — enums and helpers', () => {
  describe('Operation enum (recipe §11.1 — request|response|error)', () => {
    it('covers the three flow operations', () => {
      expect(Operation.Request).toBe('request');
      expect(Operation.Response).toBe('response');
      expect(Operation.Error).toBe('error');
    });
  });

  describe('Target enum (recipe §11.1 — client|external|store|internal)', () => {
    it('covers the four interaction targets', () => {
      expect(Target.Client).toBe('client');
      expect(Target.External).toBe('external');
      expect(Target.Store).toBe('store');
      expect(Target.Internal).toBe('internal');
    });
  });

  describe('taxonomyAttrs()', () => {
    it('returns bare operation and target attributes (recipe keys)', () => {
      const attrs = taxonomyAttrs(Operation.Error, Target.External);
      expect(attrs['operation']).toBe('error');
      expect(attrs['target']).toBe('external');
      expect(attrs['signal']).toBe('log');
    });

    it('accepts custom string values for extensibility', () => {
      const attrs = taxonomyAttrs(Operation.Request, 'cache');
      expect(attrs['operation']).toBe('request');
      expect(attrs['target']).toBe('cache');
    });
  });
});

describe('HTTP allowlist filter', () => {
  it('returns true (ignore) for health check paths', () => {
    const filter = makeHttpAllowlistFilter([]);
    expect(filter('/api/health/status')).toBe(true);
    expect(filter('/health')).toBe(true);
  });

  it('returns false (keep) for all paths when allowlist is empty', () => {
    const filter = makeHttpAllowlistFilter([]);
    expect(filter('/api/users')).toBe(false);
    expect(filter('/api/products')).toBe(false);
  });

  it('keeps only paths matching the allowlist', () => {
    const filter = makeHttpAllowlistFilter([/^\/api\/users/]);
    expect(filter('/api/users/123')).toBe(false); // keep
    expect(filter('/api/orders')).toBe(true); // ignore
  });
});

describe('normalizeRoute', () => {
  it('replaces UUID segments with :id', () => {
    const path = '/users/550e8400-e29b-41d4-a716-446655440000/profile';
    expect(normalizeRoute(path)).toBe('/users/:id/profile');
  });

  it('replaces numeric segments with :id', () => {
    expect(normalizeRoute('/items/42')).toBe('/items/:id');
  });

  it('replaces long hex segments with :id', () => {
    expect(normalizeRoute('/sessions/abcdef1234567890abcdef12')).toBe('/sessions/:id');
  });

  it('preserves non-dynamic segments', () => {
    expect(normalizeRoute('/api/v1/users')).toBe('/api/v1/users');
  });

  it('passes through root path', () => {
    expect(normalizeRoute('/')).toBe('/');
  });

  it('preserves query strings', () => {
    expect(normalizeRoute('/items/42?page=1')).toBe('/items/:id?page=1');
  });
});
