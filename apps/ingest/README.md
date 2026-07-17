# Vibe Racing Ingest boundaries

This private TypeScript workspace implements local application boundaries for Community sync
requests. The verification kernel validates a bounded raw request, verifies a fresh replay-consumed
edge proof, parses JSON without losing duplicate-key evidence, validates `ConnectorSyncV1`, reads
minimal device verification material through an injected capability, and verifies the canonical
Ed25519 device signature. The database adapter can atomically consume that origin nonce, provide the
device lookup, and submit only the verified allowlist through least-privileged PostgreSQL
procedures. A transport-free application boundary composes those exact capabilities, creates one
server-owned request ID before verification, waits for submission settlement, and returns only a
validated `ConnectorSyncResultV1` or generic `ProblemDetailsV1` decision. A separate Fastify server
factory now exposes that application through one bounded local HTTP operation without adding a
deployment entry point to this workspace. The separate `apps/ingest-host` workspace now consumes
only those reviewed factories for closed listener configuration, one bind call, and bounded process
shutdown.

The language-neutral wire policy is
[`contracts/v1/connector-sync-authentication.json`](../../contracts/v1/connector-sync-authentication.json).
Both proof messages use UTF-8 fields separated by one LF and no trailing LF. Both bind the SHA-256
digest of the exact received body bytes. The device timestamp and idempotency header must exactly
match `observedAt` and `syncId` in the validated body.

The config-backed verifier factory requires an exact primary origin key ID and canonical 32-byte
base64url key through namespaced process configuration. It accepts a secondary ID/key only as one
complete, distinct rotation pair. It returns only the verifier, clears its temporary decoded key
buffers after the verifier copies them, and reports only generic bounded startup errors. The
repository provides no actual key, usable checked-in environment value, secret-manager binding, or
edge signer.

The verifier returns only a frozen, allowlisted submission record. The adapter strictly reconstructs
the origin key ID, domain-separated nonce digest, and millisecond expiry, accepts only one boolean
consume row, and returns `false` for an exact replay. It also reconstructs and revalidates the
submission record, copies binary and array values, generates a server-side snapshot UUID, and issues
only fixed parameterized origin-consume, device-lookup, or submission calls. Each checkout verifies
the exact Ingest role, dedicated non-privileged login scope, database capability, and safe search
path. Its config permits cleartext only for explicit loopback development/test and otherwise
requires certificate-verified TLS. Pool, statement, lock, and driver waits are bounded; failed
clients are destroyed; driver/configuration details are never attached to adapter errors.

The configured application factory creates one database boundary, injects its origin-consume and
device-lookup methods into the protected-key verifier, binds its submit method, and closes the pool
if verifier construction fails. Origin or device rejection becomes the same generic unauthorized
decision; dependency outages become retryable unavailable decisions; internal drift becomes a
non-reflective internal problem. Accepted, duplicate, and quarantined acknowledgements contain only
the request ID, sync ID, coarse outcome, and accepted count. The application creates no `Response`,
HTTP header, socket, log, cache, or retained request-ID copy.

The HTTP factory registers only exact `POST /v1/community/sync` plus closed 404/405 handling. It
removes default content parsers, accepts at most 8192 raw JSON bytes, and gives the verifier a copy
of those exact bytes and the original raw-header sequence. It does not trust forwarded headers or an
inbound request ID, disables framework logging, admits four unsettled application calls without a
queue, and binds 5/33/34-second request/handler/connection deadlines, 32 connections, 16 requests
per socket, 16384 parsed header bytes, and 64 raw header pairs. A bounded JSON `Accept` grammar,
same-origin/no-CORS posture, `no-store`, `Vary: Accept`, `nosniff`, generic errors, CSPRNG request
IDs, and final generated-contract validation apply before serialization. Malformed HTTP framing uses
the same generic problem shape or closes the socket if safe serialization is impossible.

The canonical manifest and generated OpenAPI describe this implemented-local POST alongside the
public score GET. They bind the exact request/result/problem schemas, problem matrix, no-queue
policy, and `connector-sync-authentication.json`; documentation does not imply deployment.

The focused tests use synthetic keys and mock pools; one signed request exercises the actual
verifier and database adapter together, while the isolated PostgreSQL suite separately proves
persistent atomic consume and cleanup races. Loopback socket tests prove malformed framing,
duplicate-header evidence, and partial-request closure; injection tests prove the remaining route,
overload, timeout policy, and serialization behavior. The current 426-test Ingest suite has 100%
statement, branch, function, and line coverage. This workspace still owns no listener or process
lifecycle; the separate host's 121 local tests prove only its closed configuration, composition,
bind, and shutdown behavior. A separate opt-in root integration builds the emitted host, creates a
synthetic dedicated Ingest login in disposable PostgreSQL, sends independently composed signed
loopback requests, and proves accepted, duplicate, persistent replay denial, revoked-device denial,
closed response headers, four unique server request IDs, and exact stored state. There is still no
deployment protected-key injection, edge signer, direct-origin denial, trusted external TLS route,
monitoring backend, deployment database login/certificate, connector, load/capacity evidence, or
deployment. These boundaries therefore do not prove real-user synchronization or production
capacity.

Run from the repository root:

```text
pnpm run lint:ingest
pnpm run typecheck:ingest
pnpm run test:ingest:coverage
pnpm run build:ingest
pnpm run test:ingest:postgres-integration
```

See [`apps/ingest-host/README.md`](../ingest-host/README.md) for the separate listener and process
boundary.
