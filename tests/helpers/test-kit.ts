/**
 * Minimal assertion kit backed by the Node.js built-in test runner.
 *
 * The suite runs under `node --import tsx --test` with zero third-party test
 * dependencies. This module re-exports the `node:test` primitives and provides
 * a small `expect()` shim (over `node:assert`) covering only the matchers the
 * suite actually uses. It intentionally does NOT depend on any external runner.
 */
import assert from 'node:assert';
import {
  describe,
  it,
  mock,
  before,
  after,
  beforeEach,
  afterEach,
} from 'node:test';

// Re-export runner primitives. `beforeAll`/`afterAll` map to node:test
// `before`/`after` (run once per describe block).
export { describe, it, mock, beforeEach, afterEach };
export { before as beforeAll, after as afterAll };

function format(value: unknown): string {
  try {
    return typeof value === 'string' ? JSON.stringify(value) : String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

type ErrorMatcher = RegExp | string | (new (...args: never[]) => Error);

function matchError(err: unknown, expected: ErrorMatcher): void {
  const message = err instanceof Error ? err.message : String(err);
  if (expected instanceof RegExp) {
    assert.ok(
      expected.test(message),
      `expected error message ${format(message)} to match ${expected}`,
    );
  } else if (typeof expected === 'string') {
    assert.ok(
      message.includes(expected),
      `expected error message ${format(message)} to include ${format(expected)}`,
    );
  } else {
    assert.ok(
      err instanceof expected,
      `expected error to be an instance of ${expected.name}`,
    );
  }
}

class Matchers {
  constructor(
    private readonly actual: unknown,
    private readonly negated = false,
  ) {}

  private assertPass(pass: boolean, message: string): void {
    if (this.negated) assert.ok(!pass, `(not) ${message}`);
    else assert.ok(pass, message);
  }

  get not(): Matchers {
    return new Matchers(this.actual, !this.negated);
  }

  toBe(expected: unknown): void {
    this.assertPass(
      Object.is(this.actual, expected),
      `expected ${format(this.actual)} to be ${format(expected)}`,
    );
  }

  toEqual(expected: unknown): void {
    let pass = true;
    try {
      assert.deepStrictEqual(this.actual, expected);
    } catch {
      pass = false;
    }
    this.assertPass(
      pass,
      `expected ${format(this.actual)} to deep-equal ${format(expected)}`,
    );
  }

  toContain(item: unknown): void {
    let pass = false;
    if (typeof this.actual === 'string') pass = this.actual.includes(String(item));
    else if (Array.isArray(this.actual)) pass = this.actual.includes(item);
    this.assertPass(
      pass,
      `expected ${format(this.actual)} to contain ${format(item)}`,
    );
  }

  toBeDefined(): void {
    this.assertPass(this.actual !== undefined, `expected value to be defined`);
  }

  toBeUndefined(): void {
    this.assertPass(
      this.actual === undefined,
      `expected ${format(this.actual)} to be undefined`,
    );
  }

  toHaveLength(length: number): void {
    const actualLength = (this.actual as { length?: number } | null)?.length;
    this.assertPass(
      actualLength === length,
      `expected length ${actualLength} to be ${length}`,
    );
  }

  toThrow(expected?: ErrorMatcher): void {
    assert.ok(typeof this.actual === 'function', 'toThrow expects a function');
    let threw = false;
    let caught: unknown;
    try {
      (this.actual as () => unknown)();
    } catch (e) {
      threw = true;
      caught = e;
    }
    if (this.negated) {
      assert.ok(
        !threw,
        `expected function not to throw, but it threw ${format(caught)}`,
      );
      return;
    }
    assert.ok(threw, 'expected function to throw');
    if (expected !== undefined) matchError(caught, expected);
  }

  get resolves(): AsyncMatchers {
    return new AsyncMatchers(this.actual as Promise<unknown>, this.negated);
  }

  get rejects(): RejectMatchers {
    return new RejectMatchers(this.actual as Promise<unknown>);
  }
}

class AsyncMatchers {
  constructor(
    private readonly promise: Promise<unknown>,
    private readonly negated: boolean,
  ) {}

  private async value(): Promise<unknown> {
    try {
      return await this.promise;
    } catch (error) {
      assert.fail(`expected promise to resolve, but it rejected with ${format(error)}`);
    }
  }

  async toBe(expected: unknown): Promise<void> {
    new Matchers(await this.value(), this.negated).toBe(expected);
  }

  async toBeUndefined(): Promise<void> {
    new Matchers(await this.value(), this.negated).toBeUndefined();
  }

  async toEqual(expected: unknown): Promise<void> {
    new Matchers(await this.value(), this.negated).toEqual(expected);
  }
}

class RejectMatchers {
  constructor(private readonly promise: Promise<unknown>) {}

  private async error(): Promise<unknown> {
    try {
      const value = await this.promise;
      assert.fail(`expected promise to reject, but it resolved with ${format(value)}`);
    } catch (error) {
      return error;
    }
  }

  async toThrow(expected?: ErrorMatcher): Promise<void> {
    const err = await this.error();
    if (expected !== undefined) matchError(err, expected);
  }
}

export function expect(actual: unknown): Matchers {
  return new Matchers(actual);
}
