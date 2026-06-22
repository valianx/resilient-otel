/**
 * resilient-otel/preload
 *
 * Node --import preload entry for auto-instrumentation ordering.
 *
 * OTel auto-instrumentation patches libraries at MODULE LOAD TIME. The SDK
 * must start BEFORE any application module is imported. Running the app with:
 *
 *   node --import resilient-otel/preload ./dist/main.js
 *
 * ensures @nestjs/*, pg, http, etc. are patched before the NestJS module
 * cache is populated.
 *
 * This file provides a minimal default preload. For custom instrumentations,
 * create your own preload file that imports and configures the SDK directly.
 *
 * Research C4 — the preload covers auto-instrumentation;
 * ObservabilityModule.forRoot() covers the manual layer (scrubber,
 * log bridge, lifecycle).
 *
 * NOTE: This preload intentionally does NOT call init() — it only registers
 * auto-instrumentations. The full init (with scrubber + config) must be called
 * by the application (ObservabilityModule.forRoot or explicit init() call).
 *
 * Usage:
 *   node --import resilient-otel/preload dist/main.js
 *
 * Or in package.json scripts:
 *   "start": "node --import resilient-otel/preload dist/main.js"
 */

// This module is intentionally a side-effect-only entry.
// It signals to consumers that this path is the canonical preload location.
// Auto-instrumentation setup that must happen before module load goes here.

export {};
