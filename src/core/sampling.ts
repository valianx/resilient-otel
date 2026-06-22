import {
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';

/**
 * Build the sampler: ParentBased(TraceIdRatioBased(ratio)).
 *
 * Reads OTEL_TRACES_SAMPLER_ARG from env (recipe §8 gotcha: hardcoded sampler
 * ignores the env var — we read it explicitly).
 *
 * The `remoteParentNotSampled` root is set to our own ratio instead of the
 * default AlwaysOff, so service-to-service Istio calls with sampled=0 are
 * re-sampled by our own ratio rather than unconditionally dropped.
 */
export function buildSampler(ratio = 1.0): ParentBasedSampler {
  const rootSampler = new TraceIdRatioBasedSampler(ratio);
  return new ParentBasedSampler({
    root: rootSampler,
    remoteParentNotSampled: rootSampler,
  });
}
