// Core barrel — all framework-agnostic public API

// SDK init
export { init } from './core/init.js';

// Next.js instrumentation.ts register() helper (NEXT_RUNTIME-guarded init)
export { register } from './core/register.js';

// Types
export type {
  ResilientOtelConfig,
  ShutdownHandle,
  MetricsHandles,
  ExecutionCtx,
  ContextType,
  Scrubber,
  ScrubberConfig,
} from './types/index.js';

// Taxonomy
export { Operation, Target, SIGNAL_TAG, taxonomyAttrs } from './taxonomy/index.js';

// Metrics
export { createInstruments } from './metrics/index.js';

// Log bridge
export { emitLog, enrichWithContext } from './logbridge/index.js';

// Execution context (AsyncLocalStorage singleton)
export { executionContext } from './context/index.js';

// Utilities
export { normalizeRoute, makeHttpAllowlistFilter } from './utils/index.js';
export { hashPayload, getPayloadSize } from './utils/index.js';

// Standard OTEL_* env fallbacks (advanced consumers)
export { readOtelEnv, type OtelEnv } from './config/index.js';
