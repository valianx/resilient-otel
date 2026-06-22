/**
 * exporters — the http/protobuf path must construct without throwing.
 *
 * Regression guard: the proto exporters were once loaded via require(), which
 * throws in an ESM bundle. They are now static imports; this test exercises the
 * path the boot-guard/kill-switch tests skip (they return before building
 * exporters when observability is disabled).
 */
import { describe, it, expect } from './helpers/test-kit';
import { buildExporters } from '../src/core/exporters';

describe('buildExporters — http/protobuf (default)', () => {
  it('builds trace/log/metric exporters with a static headers record', async () => {
    const ex = await buildExporters({
      protocol: 'http/protobuf',
      endpoint: 'http://localhost:4318',
      headers: { 'x-test': '1' },
    });
    expect(ex.traceExporter).toBeDefined();
    expect(ex.logExporter).toBeDefined();
    expect(ex.metricExporter).toBeDefined();
  });

  it('accepts a headers thunk (runtime token rotation)', async () => {
    let calls = 0;
    const ex = await buildExporters({
      protocol: 'http/protobuf',
      endpoint: undefined,
      headers: () => {
        calls += 1;
        return { Authorization: 'Bearer test' };
      },
    });
    expect(ex.traceExporter).toBeDefined();
    expect(calls).toBe(1);
  });
});
