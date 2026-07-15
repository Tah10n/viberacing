# Vibe Racing Ingest boundaries

This private TypeScript workspace implements two local application boundaries for Community sync
requests. The verification kernel validates a bounded raw request, verifies a fresh replay-consumed
edge proof, parses JSON without losing duplicate-key evidence, validates `ConnectorSyncV1`, reads
minimal device verification material through an injected capability, and verifies the canonical
Ed25519 device signature. The database adapter can provide that lookup and submit only the verified
allowlist through the existing least-privileged PostgreSQL procedures.

The language-neutral wire policy is
[`contracts/v1/connector-sync-authentication.json`](../../contracts/v1/connector-sync-authentication.json).
Both proof messages use UTF-8 fields separated by one LF and no trailing LF. Both bind the SHA-256
digest of the exact received body bytes. The device timestamp and idempotency header must exactly
match `observedAt` and `syncId` in the validated body.

The config-backed verifier factory requires an exact primary origin key ID and canonical 32-byte
base64url key through namespaced process configuration. It accepts a secondary ID/key only as one
complete, distinct rotation pair. It returns only the verifier, clears its temporary decoded key
buffers after the verifier copies them, and reports only generic bounded startup errors. The
repository provides no actual key, checked-in environment example, secret-manager binding, or edge
signer.

The verifier returns only a frozen, allowlisted submission record. The adapter reconstructs and
revalidates that record, copies its binary and array values, generates a server-side snapshot UUID,
and issues only fixed parameterized device-lookup or submission calls. Each checkout verifies the
exact Ingest role, dedicated non-privileged login scope, database capability, and safe search path.
Its config permits cleartext only for explicit loopback development/test and otherwise requires
certificate-verified TLS. Pool, statement, lock, and driver waits are bounded; failed clients are
destroyed; driver/configuration details are never attached to adapter errors.

The current tests use synthetic keys and mock pools. This workspace has no HTTP listener, live
protected key injection, persistent origin replay store, public acknowledgement, socket deadline,
no-queue admission, backpressure, monitoring backend, working database login/certificate, live
PostgreSQL connection, connector, edge path, or deployment. It therefore does not prove real-user
synchronization or production capacity.

Run from the repository root:

```text
pnpm run lint:ingest
pnpm run typecheck:ingest
pnpm run test:ingest:coverage
pnpm run build:ingest
```
