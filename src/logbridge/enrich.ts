import { executionContext } from '../context/execution-context.js';

/**
 * Enrich a log record with OTel trace context + execution context.
 * Safe: never throws — returns original data on error.
 *
 * Ported from nest-template/observability/services/logger.service.ts:65-129
 */
export function enrichWithContext(
  data: Record<string, unknown>,
): Record<string, unknown> {
  try {
    return doEnrich(data);
  } catch {
    return data;
  }
}

function doEnrich(data: Record<string, unknown>): Record<string, unknown> {
  // NOTE: trace_id/span_id are NOT added as attributes here. Log↔trace
  // correlation uses the LogRecord's native trace fields, which the SDK
  // populates from the active context (see bridge.ts). Duplicating them as
  // attributes is non-standard and backends do not correlate on them.
  const enriched: Record<string, unknown> = { ...data };

  const execCtx = executionContext.get();
  if (!execCtx) return enriched;

  enriched.execution_id = execCtx.executionId;
  enriched.context_type = execCtx.contextType;

  if (execCtx.userId) enriched.usrtx = execCtx.userId;
  if (execCtx.channel) enriched.channel = execCtx.channel;
  if (execCtx.country) enriched.country = execCtx.country;
  if (execCtx.commerce) enriched.commerce = execCtx.commerce;

  if (execCtx.contextType === 'http') {
    enriched.http_method = execCtx.httpMethod;
    enriched.http_url = execCtx.httpUrl;
    const headers = execCtx.httpHeaders ?? {};
    const clientTraceId =
      headers['x-trace-id'] ?? headers['x-b3-traceid'] ?? headers['b3'];
    if (clientTraceId) enriched.client_trace_id = clientTraceId;
  } else if (execCtx.contextType === 'kafka') {
    enriched.kafka_topic = execCtx.kafkaTopic;
    enriched.kafka_partition = execCtx.kafkaPartition;
    enriched.kafka_offset = execCtx.kafkaOffset;
    if (execCtx.kafkaKey) enriched.kafka_key = execCtx.kafkaKey;
  } else if (execCtx.contextType === 'job') {
    enriched.job_name = execCtx.jobName;
    if (execCtx.jobId) enriched.job_id = execCtx.jobId;
  }

  if (execCtx.metadata) enriched.metadata = execCtx.metadata;

  return enriched;
}
