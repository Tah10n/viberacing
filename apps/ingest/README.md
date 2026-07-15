# Vibe Racing Ingest verification kernel

This private TypeScript workspace implements the first local application boundary for Community sync
requests. It validates a bounded raw request, verifies a fresh replay-consumed edge proof, parses
JSON without losing duplicate-key evidence, validates `ConnectorSyncV1`, reads minimal device
verification material through an injected capability, and verifies the canonical Ed25519 device
signature.

The language-neutral wire policy is
[`contracts/v1/connector-sync-authentication.json`](../../contracts/v1/connector-sync-authentication.json).
Both proof messages use UTF-8 fields separated by one LF and no trailing LF. Both bind the SHA-256
digest of the exact received body bytes. The device timestamp and idempotency header must exactly
match `observedAt` and `syncId` in the validated body.

The verifier returns only a frozen, allowlisted submission record suitable for a future narrow
database adapter. It does not expose an HTTP listener, read environment variables, connect to
PostgreSQL, consume a live replay store, submit usage, or return a public acknowledgement. Tests use
synthetic keys and injected in-memory capabilities. Therefore this workspace is not a deployed
Ingest API and does not prove real-user synchronization, edge delivery, a live device binding, rate
limits, deadlines, backpressure, or production capacity.

Run from the repository root:

```text
pnpm run lint:ingest
pnpm run typecheck:ingest
pnpm run test:ingest:coverage
pnpm run build:ingest
```
