/**
 * NestJS wiring. ObservabilityModule.forRoot() calls core init() once and
 * registers graceful shutdown via the Nest lifecycle.
 *
 * For full HTTP/DB auto-instrumentation, still launch the app with the preload:
 *   node --import resilient-otel/preload ./dist/main.js
 */
import { Module } from '@nestjs/common';
import { ObservabilityModule } from 'resilient-otel/nestjs';
import { createScrubber } from 'resilient-otel/scrub';

@Module({
  imports: [
    ObservabilityModule.forRoot({
      serviceName: 'nest-service',
      scrubber: createScrubber({ extraDenylist: ['tenant_secret'] }),
      // For direct-to-vendor export, pass OTLP auth headers (see docs/AXIOM.md):
      // headers: () => ({ Authorization: `Bearer ${process.env.VENDOR_TOKEN}` }),
    }),
  ],
})
export class AppModule {}
