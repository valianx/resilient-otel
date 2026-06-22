import { describe, it, expect } from 'bun:test';
import { createScrubber } from '../src/scrub/scrubber';

const scrubber = createScrubber({ mode: 'moderate' });

describe('scrub.denylist — default PII field groups', () => {
  describe('authentication fields', () => {
    it('redacts password', () => {
      const result = scrubber.scrubAttrs({ password: 'secret123', safe: 'ok' });
      expect(result.password).toBe('[REDACTED]');
      expect(result.safe).toBe('ok');
    });

    it('redacts apiKey (camelCase)', () => {
      const result = scrubber.scrubAttrs({ apiKey: 'ak-123' });
      expect(result.apiKey).toBe('[REDACTED]');
    });

    it('redacts access_token (snake_case)', () => {
      const result = scrubber.scrubAttrs({ access_token: 'tok-abc' });
      expect(result.access_token).toBe('[REDACTED]');
    });

    it('redacts refreshToken', () => {
      const result = scrubber.scrubAttrs({ refreshToken: 'rt-xyz' });
      expect(result.refreshToken).toBe('[REDACTED]');
    });

    it('redacts secret', () => {
      const result = scrubber.scrubAttrs({ secret: 'mysecret' });
      expect(result.secret).toBe('[REDACTED]');
    });

    it('redacts private_key', () => {
      const result = scrubber.scrubAttrs({ private_key: 'pem-data' });
      expect(result.private_key).toBe('[REDACTED]');
    });
  });

  describe('financial data fields', () => {
    it('redacts creditCardNumber', () => {
      const result = scrubber.scrubAttrs({ creditCardNumber: '4111111111111111' });
      expect(result.creditCardNumber).toBe('[REDACTED]');
    });

    it('redacts cvv', () => {
      const result = scrubber.scrubAttrs({ cvv: '123' });
      expect(result.cvv).toBe('[REDACTED]');
    });

    it('redacts iban', () => {
      const result = scrubber.scrubAttrs({ iban: 'DE89370400440532013000' });
      expect(result.iban).toBe('[REDACTED]');
    });

    it('redacts ssn', () => {
      const result = scrubber.scrubAttrs({ ssn: '123-45-6789' });
      expect(result.ssn).toBe('[REDACTED]');
    });

    it('redacts account_number', () => {
      const result = scrubber.scrubAttrs({ account_number: '12345678' });
      expect(result.account_number).toBe('[REDACTED]');
    });
  });

  describe('sensitive personal data fields', () => {
    it('redacts dateOfBirth', () => {
      const result = scrubber.scrubAttrs({ dateOfBirth: '1990-01-01' });
      expect(result.dateOfBirth).toBe('[REDACTED]');
    });

    it('redacts passport', () => {
      const result = scrubber.scrubAttrs({ passport: 'AB123456' });
      expect(result.passport).toBe('[REDACTED]');
    });

    it('redacts taxId', () => {
      const result = scrubber.scrubAttrs({ taxId: '123456789' });
      expect(result.taxId).toBe('[REDACTED]');
    });

    it('redacts driver_license', () => {
      const result = scrubber.scrubAttrs({ driver_license: 'DL-123' });
      expect(result.driver_license).toBe('[REDACTED]');
    });
  });

  describe('biometric fields', () => {
    it('redacts fingerprint', () => {
      const result = scrubber.scrubAttrs({ fingerprint: 'fp-data' });
      expect(result.fingerprint).toBe('[REDACTED]');
    });

    it('redacts biometric', () => {
      const result = scrubber.scrubAttrs({ biometric: 'data' });
      expect(result.biometric).toBe('[REDACTED]');
    });
  });

  describe('sensitive header fields', () => {
    it('redacts authorization header', () => {
      const result = scrubber.scrubAttrs({ authorization: 'Bearer token' });
      expect(result.authorization).toBe('[REDACTED]');
    });

    it('redacts cookie header', () => {
      const result = scrubber.scrubAttrs({ cookie: 'session=abc' });
      expect(result.cookie).toBe('[REDACTED]');
    });

    it('redacts x-api-key header', () => {
      const result = scrubber.scrubAttrs({ 'x-api-key': 'my-key' });
      expect(result['x-api-key']).toBe('[REDACTED]');
    });
  });

  describe('safe fields are preserved', () => {
    it('does not redact safe fields', () => {
      const result = scrubber.scrubAttrs({
        userId: '123',
        operation: 'http.incoming',
        statusCode: 200,
        route: '/api/users',
      });
      expect(result.userId).toBe('123');
      expect(result.operation).toBe('http.incoming');
      expect(result.statusCode).toBe(200);
    });
  });
});
