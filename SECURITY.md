# Security policy

## Supported versions

Security fixes are made on the default branch and released in the next connector or deployment
update. Before the first authoritative GitHub Release, only the current default branch is supported.
After releases begin, support covers the default branch and latest release; older commits and
versions may not receive backports.

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

Dynamic Codex account registration authenticates the device and admits only `clientSourceId`,
`profileClientSourceId`, and the fixed Codex agent/method/surface metadata. It locks the user,
installation, and physical profile, then validates every fixed field before creating a generic
numbered label server-side while taking the aggregation mode from the central agent registry. It is
idempotent and enforces eight logical accounts per profile, 32 sources per installation, and the
existing 100-source/100-account per-user limits. Provider email and the connector's local account
HMAC are never accepted by the endpoint.

Public production also requires a trusted client-address boundary. Railway deployments use the
edge-overwritten `X-Real-IP`; self-hosted deployments must use a reverse proxy that removes the
client value and overwrites that header before selecting `trusted-x-real-ip`. Missing or invalid
trusted headers are rate-limited in a bounded fail-closed bucket. Direct `none` mode is restricted
to loopback preview and tests, and the application deliberately does not interpret arbitrary
`X-Forwarded-For` chains.

Production requires an explicit HTTPS origin and starts as a non-root user with CSP, frame,
referrer, content-type, permissions, and cross-origin isolation headers. The only insecure-origin
escape hatch accepts loopback and is reserved for the documented local production preview.

The ranking is intentionally self-reported: these controls prevent anonymous/manual web writes and
cross-account access, but they cannot prove that a user-controlled local usage store is honest.
