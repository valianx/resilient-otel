import type { Meter } from '@opentelemetry/api';
import type { MetricsHandles } from '../types/index.js';

/**
 * Create the standard set of metric instruments — recipe §7.
 * Caller provides a `meter` obtained from the SDK's MeterProvider.
 *
 * Instruments:
 * - requests counter (http.requests.total)
 * - request duration histogram (http.request.duration)
 * - unhandled rejections counter (process.unhandled_rejections)
 * - active requests gauge (http.requests.active)
 */
export function createInstruments(meter: Meter): MetricsHandles {
  const requestsCounter = meter.createCounter('http.requests.total', {
    description: 'Total number of HTTP requests received',
    unit: '{request}',
  });

  const requestDurationHistogram = meter.createHistogram(
    'http.request.duration',
    {
      description: 'HTTP request duration in milliseconds',
      unit: 'ms',
    },
  );

  const unhandledRejectionsCounter = meter.createCounter(
    'process.unhandled_rejections',
    {
      description: 'Number of unhandled promise rejections',
      unit: '{rejection}',
    },
  );

  const activeRequestsGauge = meter.createUpDownCounter(
    'http.requests.active',
    {
      description: 'Number of in-flight HTTP requests',
      unit: '{request}',
    },
  );

  return {
    requestsCounter,
    requestDurationHistogram,
    unhandledRejectionsCounter,
    activeRequestsGauge,
  };
}
