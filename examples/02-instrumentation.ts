/**
 * Preload entry for auto-instrumentation ordering.
 *
 * OpenTelemetry patches libraries at module-load time, so the SDK must start
 * before your app imports http/pg/etc. Launch your app with this file via the
 * Node --import flag:
 *
 *   node --import ./dist/02-instrumentation.js ./dist/server.js
 *
 * (The package also ships a ready-made `resilient-otel/preload` entry; use this
 * file instead when you need to pass a custom scrubber or instrumentations.)
 */
import { init } from 'resilient-otel';
import { createScrubber } from 'resilient-otel/scrub';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

await init({
  serviceName: 'my-service',
  scrubber: createScrubber(),
  instrumentations: [
    getNodeAutoInstrumentations({
      // Never attach query parameter values to db.statement (PII).
      '@opentelemetry/instrumentation-pg': { enhancedDatabaseReporting: false },
      // Filesystem spans are noisy; turn them off.
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
});
