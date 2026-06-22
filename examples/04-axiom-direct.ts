/**
 * Direct-to-Axiom export (no local Collector).
 *
 * The endpoint is plain OTLP/HTTP; authentication is two headers built at
 * runtime by axiomHeaders() from AXIOM_TOKEN / AXIOM_DATASET — so rotating the
 * token is an env change, never a code change, and the token is never compiled
 * into the bundle.
 *
 *   export OTEL_EXPORTER_OTLP_ENDPOINT=https://api.axiom.co
 *   export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
 *   export AXIOM_TOKEN=xaat-...
 *   export AXIOM_DATASET=my-dataset
 */
import { init, axiomHeaders } from 'resilient-otel';
import { createScrubber } from 'resilient-otel/scrub';

const handle = await init({
  serviceName: 'my-service',
  scrubber: createScrubber(),
  endpoint: 'https://api.axiom.co',
  protocol: 'http/protobuf',
  headers: axiomHeaders(), // () => ({ Authorization: 'Bearer …', 'X-Axiom-Dataset': … })
});

export { handle };
