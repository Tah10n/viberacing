export function contentSecurityPolicy(nonce: string, development: boolean): string {
  return [
    "base-uri 'self'",
    "connect-src 'self'",
    "default-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "object-src 'none'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
  ].join("; ");
}
