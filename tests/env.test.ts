/**
 * env — AC-7 / env contract tests.
 */
import { describe, it, expect, afterEach } from './helpers/test-kit';
import { readEnvConfig } from '../src/config/env';
import { axiomHeaders } from '../src/core/init';

afterEach(() => {
  delete process.env['OBSERVABILITY_ENABLED'];
  delete process.env['MY_PREFIX_OBSERVABILITY_ENABLED'];
  delete process.env['OTEL_SDK_DISABLED'];
  delete process.env['OTEL_EXPORTER_OTLP_PROTOCOL'];
  delete process.env['OTEL_TRACES_SAMPLER_ARG'];
  delete process.env['OTEL_SHUTDOWN_TIMEOUT'];
  delete process.env['LOG_SANITIZATION_MODE'];
  delete process.env['LOG_REDACT_EXTRA_FIELDS'];
  delete process.env['AXIOM_TOKEN'];
  delete process.env['AXIOM_DATASET'];
});

describe('env — typed env-contract resolver', () => {
  it('reads OBSERVABILITY_ENABLED=true', () => {
    process.env['OBSERVABILITY_ENABLED'] = 'true';
    const cfg = readEnvConfig();
    expect(cfg.observabilityEnabled).toBe(true);
  });

  it('reads OBSERVABILITY_ENABLED=false', () => {
    process.env['OBSERVABILITY_ENABLED'] = 'false';
    const cfg = readEnvConfig();
    expect(cfg.observabilityEnabled).toBe(false);
  });

  it('envPrefix redirects the master switch key', () => {
    process.env['MY_PREFIX_OBSERVABILITY_ENABLED'] = 'true';
    const cfg = readEnvConfig('MY_PREFIX_');
    expect(cfg.observabilityEnabled).toBe(true);
  });

  it('defaults observabilityEnabled to false when unset', () => {
    const cfg = readEnvConfig();
    expect(cfg.observabilityEnabled).toBe(false);
  });

  it('reads OTEL_SDK_DISABLED=true', () => {
    process.env['OTEL_SDK_DISABLED'] = 'true';
    const cfg = readEnvConfig();
    expect(cfg.sdkDisabled).toBe(true);
  });

  it('selects grpc protocol when OTEL_EXPORTER_OTLP_PROTOCOL=grpc', () => {
    process.env['OTEL_EXPORTER_OTLP_PROTOCOL'] = 'grpc';
    const cfg = readEnvConfig();
    expect(cfg.otlpProtocol).toBe('grpc');
  });

  it('defaults to http/protobuf protocol', () => {
    const cfg = readEnvConfig();
    expect(cfg.otlpProtocol).toBe('http/protobuf');
  });

  it('parses OTEL_TRACES_SAMPLER_ARG as float', () => {
    process.env['OTEL_TRACES_SAMPLER_ARG'] = '0.5';
    const cfg = readEnvConfig();
    expect(cfg.samplingRatio).toBe(0.5);
  });

  it('clamps OTEL_TRACES_SAMPLER_ARG to [0,1]', () => {
    process.env['OTEL_TRACES_SAMPLER_ARG'] = '2.0';
    const cfg = readEnvConfig();
    expect(cfg.samplingRatio).toBe(1.0);
  });

  it('parses LOG_REDACT_EXTRA_FIELDS as comma-separated array', () => {
    process.env['LOG_REDACT_EXTRA_FIELDS'] = 'field_a,field_b , field_c';
    const cfg = readEnvConfig();
    expect(cfg.extraDenylistFields).toEqual(['field_a', 'field_b', 'field_c']);
  });

  it('parses LOG_SANITIZATION_MODE=strict', () => {
    process.env['LOG_SANITIZATION_MODE'] = 'strict';
    const cfg = readEnvConfig();
    expect(cfg.sanitizationMode).toBe('strict');
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
