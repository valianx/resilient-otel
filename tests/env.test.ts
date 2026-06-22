/**
 * env — standard OTEL_* fallbacks only (the library reads no env of its own).
 */
import { describe, it, expect, afterEach } from './helpers/test-kit';
import { readOtelEnv } from '../src/config/env';
import { axiomHeaders } from '../src/core/init';

afterEach(() => {
  delete process.env['OTEL_SDK_DISABLED'];
  delete process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
  delete process.env['OTEL_EXPORTER_OTLP_PROTOCOL'];
  delete process.env['OTEL_SERVICE_NAME'];
  delete process.env['OTEL_TRACES_SAMPLER_ARG'];
  delete process.env['AXIOM_TOKEN'];
  delete process.env['AXIOM_DATASET'];
});

describe('readOtelEnv — standard OTEL_* fallbacks', () => {
  it('reads OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_SERVICE_NAME', () => {
    process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] = 'http://collector:4317';
    process.env['OTEL_SERVICE_NAME'] = 'svc';
    const env = readOtelEnv();
    expect(env.endpoint).toBe('http://collector:4317');
    expect(env.serviceName).toBe('svc');
  });

  it('returns undefined for endpoint/serviceName when unset (no defaults here)', () => {
    const env = readOtelEnv();
    expect(env.endpoint).toBeUndefined();
    expect(env.serviceName).toBeUndefined();
  });

  it('reads OTEL_SDK_DISABLED=true', () => {
    process.env['OTEL_SDK_DISABLED'] = 'true';
    expect(readOtelEnv().sdkDisabled).toBe(true);
  });

  it('honors grpc protocol; leaves unknown/unset as undefined', () => {
    process.env['OTEL_EXPORTER_OTLP_PROTOCOL'] = 'grpc';
    expect(readOtelEnv().protocol).toBe('grpc');
    process.env['OTEL_EXPORTER_OTLP_PROTOCOL'] = 'nonsense';
    expect(readOtelEnv().protocol).toBeUndefined();
    delete process.env['OTEL_EXPORTER_OTLP_PROTOCOL'];
    expect(readOtelEnv().protocol).toBeUndefined();
  });

  it('parses and clamps OTEL_TRACES_SAMPLER_ARG; undefined when unset', () => {
    process.env['OTEL_TRACES_SAMPLER_ARG'] = '0.5';
    expect(readOtelEnv().samplingRatio).toBe(0.5);
    process.env['OTEL_TRACES_SAMPLER_ARG'] = '2.0';
    expect(readOtelEnv().samplingRatio).toBe(1.0);
    delete process.env['OTEL_TRACES_SAMPLER_ARG'];
    expect(readOtelEnv().samplingRatio).toBeUndefined();
  });
});

describe('axiomHeaders — runtime token thunk (AC-7)', () => {
  it('reads AXIOM_TOKEN and AXIOM_DATASET at call time, not at factory time', () => {
    const thunk = axiomHeaders();
    // Token not set yet at factory time
    process.env['AXIOM_TOKEN'] = 'runtime-token';
    process.env['AXIOM_DATASET'] = 'my-dataset';
    const headers = thunk();
    expect(headers['Authorization']).toBe('Bearer runtime-token');
    expect(headers['X-Axiom-Dataset']).toBe('my-dataset');
  });

  it('opts override env vars', () => {
    process.env['AXIOM_TOKEN'] = 'env-token';
    const thunk = axiomHeaders({ token: 'explicit-token', dataset: 'explicit-ds' });
    const headers = thunk();
    expect(headers['Authorization']).toBe('Bearer explicit-token');
    expect(headers['X-Axiom-Dataset']).toBe('explicit-ds');
  });

  it('returns empty string for token when env is unset', () => {
    delete process.env['AXIOM_TOKEN'];
    delete process.env['AXIOM_DATASET'];
    const thunk = axiomHeaders();
    const headers = thunk();
    expect(headers['Authorization']).toBe('Bearer ');
  });
});
