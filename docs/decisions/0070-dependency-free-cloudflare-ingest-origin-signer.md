# ADR 0070: Dependency-free Cloudflare Ingest origin signer

- Status: Superseded
- Date: 2026-07-26
- Decision owners: Edge, Ingest, Security, Privacy, Operations, and Dependencies
- Supersedes: None
- Superseded by: ADR 0075

## Context

ADRs 0004, 0015, 0017, 0018, 0020, and 0033 define and verify the Railway-side origin-proof
boundary, but the repository previously had no component that created that proof. The development
connector deliberately sends only device authentication, so deploying Ingest without an edge signer
would leave every connector sync unusable. Letting the connector hold the origin key, accepting a
caller-provided origin proof, or weakening Ingest to trust proxy headers would violate the selected
capability boundary.

The shortest deployable slice needs one public ingress for one route. It does not need a general
proxy, queue, cache, durable retry, analytics pipeline, or new dependency graph.

## Decision

Add a private dependency-free `@viberacing/edge` workspace whose default Cloudflare Worker export
handles only exact `POST /v1/community/sync` with no query string. It accepts the existing
`application/json` body and five connector device headers, rejects caller-supplied request IDs or
origin-proof headers, and bounds every header plus the raw body before configuration or upstream
work.

For each admitted request the Worker:

1. reads one exact HTTPS DNS Ingest origin and one active `edge_*` key pair from Worker secrets;
2. creates fresh request and origin nonces from Web Crypto;
3. hashes the unchanged raw body with SHA-256;
4. creates the canonical ADR 0015 HMAC-SHA-256 message over key ID, method, target, body digest,
   timestamp, and nonce;
5. forwards the body once with only the allowlisted connector and generated origin headers; and
6. relays only a bounded JSON/problem response with a valid Ingest request ID.

There is no retry, redirect following, alternate route, generic header forwarding, client IP trust,
storage, queue, cache, log, metric, trace, analytics event, filesystem access, database access, or
runtime dependency. Upstream failure becomes a generic retryable problem. Decoded key bytes are
discarded after the request.

`workers_dev` remains disabled. The tracked Wrangler configuration contains no route, hostname,
account, secret, or environment-specific value. Operators set the custom domain and three secret
bindings outside the repository. Wrangler is not added to the workspace lockfile; the deployment
runbook pins one reviewed CLI version for the one-shot operator action.

Rotation is primary-first: configure the new pair as Ingest primary while retaining the old pair as
its bounded secondary, update the Worker, then remove the old Ingest secondary only after the proof
window and old isolates drain. The Worker signs with one active pair and cannot verify or read
Ingest state.

## Security and privacy consequences

The origin key remains outside the connector and browser. An attacker who discovers the Railway
origin can still send traffic to it, but cannot pass origin verification without the key; the
Railway origin is not claimed unreachable. Device authentication, persistent origin-nonce
consumption, application admission, database role isolation, and request deadlines remain
independent controls.

The Worker transiently handles the existing Usage body, device authentication headers, one Security
proof, and one Operational request ID. It adds no field, database row, retained record, export, or
new data purpose. It intentionally emits no access log or application telemetry from repository
code; provider platform logs and analytics must stay disabled or receive a separate privacy and
operations decision before use.

Compromise of the Worker secret can produce valid origin proofs but cannot create a valid device
signature or obtain database credentials. Compromise of Railway still bypasses the edge boundary.
Cloudflare account security, custom-domain routing, provider access logs, secret delivery, rotation
execution, WAF/rate policy, monitoring, and capacity remain deployment responsibilities.

## Alternatives considered

- **Put the origin key in the connector:** rejected because every participant would gain shared
  ingress authority and could forge the edge boundary.
- **Trust Railway or forwarding headers:** rejected because direct callers can supply headers and
  ADR 0033 intentionally keeps proxy trust disabled.
- **Use a general reverse proxy framework:** rejected because one fixed route needs only Fetch and
  Web Crypto, while a framework would add dependencies and unneeded authority.
- **Add a queue and retries:** rejected because ADR 0020 is a no-queue admission boundary and
  retries could duplicate signed submissions or hide backpressure.
- **Bundle Wrangler as a workspace dependency:** rejected because its optional local-development
  graph materially expands the locked package and license surface without entering the Worker
  runtime.
- **Claim direct-origin denial from the Worker source:** rejected because only a deployed route,
  protected secret, and external negative test can establish that operational result.

## Migration and rollback

No public contract, database migration, stored value, connector field, or service grant changes.
Ingest already supports one primary and one bounded secondary origin key. Deployment introduces one
new key pair through protected configuration and points the connector sync origin at the Cloudflare
custom domain.

Rollback first disables or removes the Cloudflare sync route, then drains the Worker and Ingest
processes. Do not restore traffic by sending the shared key to clients, accepting missing proofs, or
trusting forwarding headers. If the key may be exposed, rotate the Ingest primary/secondary pair
before restoring the route.

## Verification

Current local evidence includes:

- 18 dependency-free tests for the exact canonical proof, unchanged body, key rebinding, route,
  method, media type, header and body bounds, inbound-proof rejection, one upstream attempt,
  response allowlisting, generic failures, and entropy failure;
- a separate production-build compatibility test in which the Worker's generated proof and a real
  synthetic Ed25519 device signature are accepted by `createCommunitySyncVerifier`, including
  persistent-nonce input and exact payload preservation;
- the existing disposable Ingest/PostgreSQL integration for the downstream HTTP, replay, device,
  submission, response, admission, and stored-state path; and
- an exact-version Wrangler dry run that bundles the Worker without deploying it.

This proves no Cloudflare account, custom-domain route, Worker secret, Railway origin, external TLS,
direct-origin negative result, provider logging state, WAF/rate policy, monitoring, representative
load, capacity, real connector upload, or real-user deployment.

## References

- [Cloudflare and database capability isolation](0004-edge-service-and-database-isolation.md)
- [Community sync verification kernel](0015-bounded-community-sync-verification-kernel.md)
- [Protected origin key configuration](0017-protected-ingest-origin-key-configuration.md)
- [Community sync HTTP boundary](0020-bounded-community-sync-fastify-http-boundary.md)
- [Railway Ingest host](0033-bounded-railway-ingest-host.md)
- [Edge workspace](../../apps/edge/README.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
