/**
 * Direct-to-vendor export (no local Collector), using Axiom as the example.
 *
 * There is nothing Axiom-specific in the library: OTLP authenticates via
 * headers, and the generic `headers` field takes a record or a thunk. The thunk
 * reads your own env at call time, so rotating the token is an env change (never
 * code) and the token is never compiled into the bundle. See docs/AXIOM.md.
 *
 *   export OTEL_EXPORTER_OTLP_ENDPOINT=https://api.axiom.co  (optional; or pass endpoint)
 *   export AXIOM_TOKEN=xaat-...
 *   export AXIOM_DATASET=my-dataset
 */
import { init } from 'resilient-otel';
import { createScrubber } from 'resilient-otel/scrub';

const handle = await init({
  serviceName: 'my-service',
  scrubber: createScrubber(),
  endpoint: 'https://api.axiom.co',
  protocol: 'http/protobuf',
  headers: () => ({
    Authorization: `Bearer ${process.env.AXIOM_TOKEN}`,
    'X-Axiom-Dataset': process.env.AXIOM_DATASET ?? '',
  }),
});

export { handle };
