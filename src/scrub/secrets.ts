/**
 * Secret regex bank — recipe §11.6.
 * One pattern per provider, named for test coverage traceability.
 * Each entry: { name, pattern } where `pattern` matches a secret value in text.
 */

export interface SecretPattern {
  readonly name: string;
  readonly pattern: RegExp;
}

export const DEFAULT_SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    // Axiom API token: xaat- prefix, 40+ chars
    name: 'axiom-token',
    pattern: /xaat-[A-Za-z0-9_-]{32,}/g,
  },
  {
    // Anthropic API key: sk-ant- prefix
    name: 'anthropic-key',
    pattern: /sk-ant-[A-Za-z0-9_-]{40,}/g,
  },
  {
    // OpenAI API key: sk- prefix (not sk-ant-)
    name: 'openai-key',
    pattern: /sk-(?!ant-)[A-Za-z0-9_-]{40,}/g,
  },
  {
    // GitHub Personal Access Token (classic: ghp_ or fine-grained: github_pat_)
    name: 'github-pat',
    pattern: /(?:ghp_|github_pat_)[A-Za-z0-9_]{30,}/g,
  },
  {
    // Stripe secret key: sk_live_ or sk_test_
    name: 'stripe-key',
    pattern: /sk_(?:live|test)_[A-Za-z0-9]{24,}/g,
  },
  {
    // AWS access key ID: AKIA prefix (20-char uppercase alphanum)
    name: 'aws-access-key',
    pattern: /AKIA[A-Z0-9]{16}/g,
  },
  {
    // AWS session token (longer, starts with //BQID or similar base64 patterns)
    name: 'aws-session-token',
    pattern: /(?:aws_session_token|AWSSessionToken)[=:\s"']+[A-Za-z0-9/+=]{100,}/gi,
  },
  {
    // Slack bot/app token: xoxb- or xoxa-
    name: 'slack-token',
    pattern: /xox[baprs]-[A-Za-z0-9_-]{10,}/g,
  },
  {
    // JWT Bearer token (3 base64url segments)
    name: 'jwt-bearer',
    pattern: /Bearer\s+eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  },
  {
    // RSA private key PEM block
    name: 'rsa-private-key',
    pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC )?PRIVATE KEY-----/g,
  },
];
