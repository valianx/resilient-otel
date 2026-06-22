/**
 * taxonomy — Operation × Target enum completeness + HTTP allowlist filter.
 */
import { describe, it, expect } from 'bun:test';
import { Operation, Target, taxonomyAttrs } from '../src/taxonomy/taxonomy';
import { makeHttpAllowlistFilter, normalizeRoute } from '../src/utils/route';

describe('taxonomy — enums and helpers', () => {
  describe('Operation enum', () => {
    it('covers HTTP operations', () => {
      expect(Operation.HttpIncoming).toBe('http.incoming');
      expect(Operation.HttpOutgoing).toBe('http.outgoing');
    });

    it('covers DB operations', () => {
      expect(Operation.DbQuery).toBe('db.query');
      expect(Operation.DbTransaction).toBe('db.transaction');
    });

    it('covers cache operations', () => {
      expect(Operation.CacheGet).toBe('cache.get');
      expect(Operation.CachePut).toBe('cache.put');
    });

    it('covers messaging operations', () => {
      expect(Operation.MessagePublish).toBe('message.publish');
      expect(Operation.MessageConsume).toBe('message.consume');
    });

    it('covers auth operations', () => {
      expect(Operation.AuthLogin).toBe('auth.login');
      expect(Operation.AuthLogout).toBe('auth.logout');
      expect(Operation.AuthRefresh).toBe('auth.refresh');
    });
  });

  describe('Target enum', () => {
    it('covers infrastructure targets', () => {
      expect(Target.Postgres).toBe('postgres');
      expect(Target.Redis).toBe('redis');
      expect(Target.Kafka).toBe('kafka');
    });
  });

  describe('taxonomyAttrs()', () => {
    it('returns app.operation and app.target attributes', () => {
      const attrs = taxonomyAttrs(Operation.HttpIncoming, Target.HttpClient);
      expect(attrs['app.operation']).toBe('http.incoming');
      expect(attrs['app.target']).toBe('http.client');
      expect(attrs['signal']).toBe('log');
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
