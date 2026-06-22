import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from '@opentelemetry/core';

/**
 * Build the W3C TraceContext + W3C Baggage propagator.
 *
 * B3 propagator is intentionally EXCLUDED — recipe §3 and the Istio note:
 * Istio sidecars inject x-b3-sampled:0 on incoming requests, which causes
 * ParentBasedSampler to drop all HTTP spans. B3 propagation is handled at the
 * mesh level; the app must not inherit Istio's sampling decision via B3.
 */
export function buildPropagator(): CompositePropagator {
  return new CompositePropagator({
    propagators: [
      new W3CTraceContextPropagator(),
      new W3CBaggagePropagator(),
    ],
  });
}
