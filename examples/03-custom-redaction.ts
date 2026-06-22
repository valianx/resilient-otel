/**
 * Extending the scrubber — the headline feature.
 *
 * Add your own denylist words and secret patterns at runtime, on top of the
 * built-in PII denylist and secret bank. All config is code-level — no env vars.
 *
 * Run: node --import tsx examples/03-custom-redaction.ts
 */
import { createScrubber } from 'resilient-otel/scrub';

const scrubber = createScrubber({
  mode: 'strict',
  extraDenylist: ['internal_account_id', 'partner_secret'],
  extraSecretPatterns: [/acme-[A-Za-z0-9]{32}/], // a vendor token format of ours
});

// Object attributes: denylisted keys are replaced, safe keys preserved.
console.log(
  scrubber.scrubAttrs({
    internal_account_id: 'acct_123',
    password: 'hunter2',
    email: 'jane@example.com',
    productId: 'sku-42', // safe — preserved
  }),
);
// → { internal_account_id: '[REDACTED]', password: '[REDACTED]',
//     email: '[REDACTED]', productId: 'sku-42' }

// Free text: secrets + denylisted key=value pairs are redacted inline.
console.log(
  scrubber.redact('login partner_secret=abc123 token acme-0123456789abcdef0123456789abcdef'),
);
// → 'login partner_secret=[REDACTED] token [REDACTED]'
