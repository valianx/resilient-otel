/**
 * propagation — AC-6 of PR-2:
 * CompositePropagator uses W3C TraceContext + W3C Baggage, no B3.
 */
import { describe, it, expect } from 'bun:test';
import { buildPropagator } from '../src/core/propagation';
import { W3CTraceContextPropagator, W3CBaggagePropagator } from '@opentelemetry/core';

describe('propagation — W3C TraceContext + Baggage, no B3', () => {
  const propagator = buildPropagator();

  it('returns a CompositePropagator', () => {
    expect(propagator).toBeDefined();
    expect(typeof propagator.inject).toBe('function');
    expect(typeof propagator.extract).toBe('function');
  });

  it('propagator fields include traceparent (W3C TraceContext)', () => {
    const fields = propagator.fields();
    expect(fields).toContain('traceparent');
  });

  it('propagator fields include baggage (W3C Baggage)', () => {
    const fields = propagator.fields();
    expect(fields).toContain('baggage');
  });

  it('propagator fields do NOT include b3 (Istio sidecar conflict)', () => {
    const fields = propagator.fields();
    expect(fields).not.toContain('b3');
    expect(fields).not.toContain('X-B3-TraceId');
    expect(fields).not.toContain('x-b3-traceid');
  });
});
