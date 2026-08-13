# Security policy

## Reporting a vulnerability

Use GitHub's **Report a vulnerability** action to open a private security advisory. Do not disclose
security details in a public issue, pull request, discussion, commit message, or social post.

Include the affected component, realistic impact, minimal reproduction with synthetic data, and a
safe contact method. Do not send credentials, production database exports, or unrelated personal
data.

## Priority areas

- GitHub OAuth, sessions, browser pairing, and device authorization;
- cross-account access or mutation;
- usage tampering outside the documented self-reporting limitation;
- collection or disclosure of prompts, code, repositories, paths, or credentials;
- connector hook installation and local token storage;
- dependency, container, CI, and npm package supply chain.

Good-faith research must avoid accessing another person's data, persistence, destructive actions,
denial of service, social engineering, credential theft, and production testing when a local
reproduction is possible.

## Security properties

Browser mutations require a valid HttpOnly session and exact same-origin `Origin`. OAuth state is
random and timing-safe compared; login rotates the browser session. Installation, pairing, poll,
device, and session capabilities are stored only as SHA-256 hashes. The server accepts usage only
for an active source belonging to the authenticated installation and enforces body/range/count/
numeric limits plus PostgreSQL-backed rate limits.

Production requires an explicit HTTPS origin and starts as a non-root user with CSP, frame,
referrer, content-type, permissions, and cross-origin isolation headers. The only insecure-origin
escape hatch accepts loopback and is reserved for the documented local production preview.

The ranking is intentionally self-reported: these controls prevent anonymous/manual web writes and
cross-account access, but they cannot prove that a user-controlled local usage store is honest.
