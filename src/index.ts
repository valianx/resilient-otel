// Core barrel — all framework-agnostic public API

// SDK init + Axiom helper
export { init, axiomHeaders } from './core/init.js';

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

// Environment config resolver (advanced consumers)
export { readEnvConfig, type EnvConfig } from './config/index.js';
