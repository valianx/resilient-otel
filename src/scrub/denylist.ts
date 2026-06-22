/**
 * Default PII field denylist.
 * Ported verbatim from sanitizer.util.ts:10-111 (PII_BODY_FIELDS + SENSITIVE_HEADERS).
 *
 * Matching is case-insensitive substring: a field is redacted if its lowercase key
 * contains any denylist entry in lowercase.
 */
export const DEFAULT_DENYLIST: ReadonlySet<string> = new Set([
  // Authentication
  'password',
  'currentpassword',
  'newpassword',
  'confirmpassword',
  'secret',
  'apikey',
  'api_key',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'privatekey',
  'private_key',

  // Financial data
  'creditcardnumber',
  'cardnumber',
  'card_number',
  'cvv',
  'cvc',
  'accountnumber',
  'account_number',
  'iban',
  'swift',
  'routing',
  'pin',
  'ssn',
  'social_security_number',

  // Sensitive personal data
  'birthdate',
  'birth_date',
  'dateofbirth',
  'date_of_birth',
  'taxid',
  'tax_id',
  'identificationnumber',
  'identification_number',
  'passport',
  'driverlicense',
  'driver_license',

  // Biometrics
  'fingerprint',
  'faceid',
  'face_id',
  'biometric',

  // Sensitive headers (lowercase canonical form)
  'authorization',
  'auth',
  'x-auth-token',
  'x-api-key',
  'cookie',
  'set-cookie',
  'x-access-token',
  'x-refresh-token',
  'x-csrf-token',
  'x-xsrf-token',
  'x-github-token',
  'x-gitlab-token',
  'x-stripe-key',
  'x-aws-access-key',
  'x-gcp-key',
]);

/**
 * Infrastructure/noise headers to drop entirely (not just redact).
 * These add noise to telemetry without business value.
 */
export const INFRASTRUCTURE_HEADERS: ReadonlySet<string> = new Set([
  'x-envoy-peer-metadata',
  'x-envoy-peer-metadata-id',
  'x-envoy-decorator-operation',
  'x-envoy-attempt-count',
  'x-envoy-external-address',
  'x-envoy-original-path',
  'x-envoy-upstream-service-time',
  'x-envoy-expected-rq-timeout-ms',
  'cf-ray',
  'cf-visitor',
  'cf-connecting-ip',
  'cf-ipcountry',
  'cdn-loop',
  'x-forwarded-for',
  'x-forwarded-proto',
  'x-forwarded-host',
  'x-real-ip',
  'request-id',
  'request-context',
]);
