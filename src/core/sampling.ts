import {
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';

/**
 * Build the sampler: standard ParentBased(TraceIdRatioBased(ratio)).
 *
 * Parent-based = the sampling decision is made ONCE at the head of a trace (e.g.
 * your ingress) and HONORED by every downstream service via the W3C `traceparent`
 * sampled flag:
 *   - remote parent sampled (…-01)     → sample  (AlwaysOn, the default)
 *   - remote parent not sampled (…-00) → drop    (AlwaysOff, the default)
 *   - no parent (a root span)          → the ratio
 *
 * This keeps a trace consistent across all hops (no orphaned "loose" spans). We
 * deliberately do NOT override `remoteParentNotSampled` to re-sample, which would
 * let downstream services emit spans the ingress chose to drop.
 *
 * The ratio only applies to ROOT spans; it is read explicitly from
 * OTEL_TRACES_SAMPLER_ARG by the caller (recipe §8 gotcha: a hardcoded sampler
 * ignores the env var).
 */
export function buildSampler(ratio = 1.0): ParentBasedSampler {
  return new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(ratio),
  });
}
