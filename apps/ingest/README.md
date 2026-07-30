# Vibe Racing Ingest

This TypeScript workspace implements the provider-neutral verification, application, PostgreSQL, and
HTTP factories for exact `POST /v1/usage`. It owns no listener or process lifecycle;
`apps/ingest-host` composes those reviewed factories.

Everything is local pre-release evidence. There is no deployed route, protected production key,
database credential/certificate, direct-origin control, supported connector/provider, or real-user
ingestion claim.

## Verification order

The kernel accepts bounded exact raw body/header evidence and performs:

1. request target, method, body, and header framing checks;
2. fresh Edge HMAC verification in memory without persistence;
3. duplicate-key-aware bounded JSON parsing;
4. strict `UsageSyncV1` validation;
5. exact timestamp, nonce, idempotency, AgentAccount, and body-digest header relationships;
6. non-mutating active installation/AgentAccount/device/provider/revision lookup;
7. canonical Ed25519 device-signature verification; and
8. one atomic least-privileged PostgreSQL submission.

Origin or device rejection is generic unauthorized; dependency failure is generic retryable
unavailable; internal drift is non-reflective. The application returns only a revalidated matching
usage result or `ProblemDetailsV1`.

The language-neutral proof format is defined in
[`connector-usage-sync-authentication.json`](../../contracts/v1/connector-usage-sync-authentication.json).
Both signatures bind the SHA-256 digest of the exact received body. The body contains no provider,
profile, trust tier, scope, accounting revision, device/installation identity, prompts,
conversations, code, repositories, paths, email, credentials, model, cost, or raw records.

## Origin-key boundary

The verifier factory reads:

- one exact primary key ID and canonical 32-byte base64url key; and
- at most one complete distinct secondary pair for bounded rotation overlap.

It returns only a verifier, clears temporary decoded buffers after copying, and reports generic
startup failures. The repository contains no usable key or secret-manager binding.

Edge verification itself is non-mutating. Durable origin replay is consumed inside the atomic
database submission before device lookup or idempotency, preventing unauthenticated replay-state
exhaustion and replay/idempotency leakage.

## Database boundary

The adapter uses one distinct login with exactly `viberacing_ingest`. It probes login/membership,
safe search path, required procedure, and TLS before role assumption. Cleartext is accepted only in
development/test on exact loopback; every other environment requires `verify-full` to a
certificate-valid DNS hostname.

The adapter reconstructs only the verified allowlist and calls one fixed parameterized procedure.
That transaction:

- consumes durable origin replay;
- revalidates active installation, AgentAccount, device, provider, reader, revision, scope, trust,
  and server-owned date policy;
- consumes the device nonce and classifies long-lived idempotency;
- stores immutable observations;
- replaces the device's cumulative account/day contribution;
- recomputes exact multi-device account/day totals;
- appends hash-chained ranking events; and
- coalesces every affected season into dirty work.

Any failure rolls back every mutation. Decimal strings are parsed by PostgreSQL into `numeric(30,0)`
and never through JavaScript `Number`.

Pools, acquisition, statements, locks, and driver waits are bounded. Failed clients are destroyed;
role/session state resets before reuse. Protected values, SQL, parameters, identifiers, and raw
driver/configuration errors are not logged or attached to public errors.

## HTTP factory

The factory registers only exact `POST /v1/usage` after receiving a true enable decision. Removed
pre-release usage paths and all unknown routes return closed 404 before application/database work.

It:

- removes default parsers and preserves at most 8192 exact raw JSON bytes;
- retains the original bounded raw-header sequence;
- accepts no forwarded identity or inbound request ID;
- disables framework logging;
- admits at most four unsettled application calls globally and one per device, without a queue;
- uses bounded request/handler/connection deadlines and socket/header budgets;
- enforces same-origin/no-CORS, JSON `Accept`, `no-store`, `Vary: Accept`, and `nosniff`; and
- validates generated result/problem contracts before serialization.

Malformed framing uses the same generic bounded problem where safe, otherwise the socket closes.

## Composition and cleanup

The configured application factory constructs one database boundary, injects its non-mutating lookup
into the verifier, binds the atomic submit method, and closes the pool if later construction fails.
The separate host:

- resolves exact startup enablement before protected configuration;
- binds only closed loopback development/test or the reviewed Railway-edge production declaration;
- cleans every partial startup; and
- bounds SIGINT/SIGTERM settlement.

## Verification

```text
pnpm run lint:ingest
pnpm run typecheck:ingest
pnpm run test:ingest:coverage
pnpm run build:ingest
pnpm run lint:ingest-host
pnpm run typecheck:ingest-host
pnpm run test:ingest-host:coverage
pnpm run test:edge-ingest-compatibility
pnpm run test:ingest:postgres-integration
pnpm run test:ingest:signal-postgres-integration
```

Focused tests use synthetic keys and injected pools. PostgreSQL integrations build the real host,
create a disposable hostname-verified TLS database and narrow login, send independently signed
loopback requests, prove replay/idempotency/cumulative/state/admission behavior and exact stored
state, exercise a separate emitted process, deliver a real local signal, and verify cleanup.

They do not prove Cloudflare/Railway deployment, external TLS, secret delivery, direct-origin
denial, WAF/rate policy, monitoring, representative capacity, orchestrator behavior, real provider
data, or real-user sync.

See [`apps/ingest-host/README.md`](../ingest-host/README.md) for listener/process details and
[`apps/edge/README.md`](../edge/README.md) for the independent origin signer/rate boundary.
