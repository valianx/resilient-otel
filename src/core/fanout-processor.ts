/**
 * FanOutLogRecordProcessor — forwards onEmit to N downstream processors.
 *
 * Used to split the already-scrubbed log record stream to multiple sinks
 * (e.g. OTLP batch + console-simple) without duplicating the scrub stage.
 *
 * Mirrors the delegation shape of ScrubLogRecordProcessor but forwards to an
 * array of downstreams instead of one. forceFlush/shutdown run concurrently
 * via Promise.all so all downstreams drain together.
 *
 * Security: this processor receives records AFTER the ScrubLogRecordProcessor
 * has already applied redaction. All downstreams therefore see the same
 * post-scrub record; there is exactly one scrub stage above this fan-out.
 */
import type { LogRecordProcessor, SdkLogRecord } from '@opentelemetry/sdk-logs';
import type { Context } from '@opentelemetry/api';

export class FanOutLogRecordProcessor implements LogRecordProcessor {
  constructor(private readonly downstreams: LogRecordProcessor[]) {}

  onEmit(record: SdkLogRecord, context?: Context): void {
    for (const downstream of this.downstreams) {
      downstream.onEmit(record, context);
    }
  }

  forceFlush(): Promise<void> {
    return Promise.all(this.downstreams.map((d) => d.forceFlush())).then(
      () => undefined,
    );
  }

  shutdown(): Promise<void> {
    return Promise.all(this.downstreams.map((d) => d.shutdown())).then(
      () => undefined,
    );
  }
}
