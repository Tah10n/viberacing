# Vibe Racing Web

This Next.js workspace contains the synthetic public experience, three default-off public snapshot
routes, and local identity/account/pairing/CarRecipe slices. It is pre-release repository evidence,
not a deployed website or production authentication service.

## Synthetic public experience

`pnpm run dev:web` renders repository-owned synthetic data without an account or database:

- EN/RU semantic leaderboard;
- exact weekly token totals, shared rank, and separate stable display order;
- current/history controls, filtering, and pagination;
- explicit Community/unverified and tokenizer-difference copy;
- public profile and garage views;
- Neon Night, Cyber Rally, and accessible high-contrast themes;
- keyboard-visible focus, forced-colors, and reduced-motion support; and
- a lazy decorative pixel race with a meaningful table/text fallback.

Synthetic fallback is explicit. It never silently represents itself as live provider or production
data.

## Public snapshot routes

Three GET modules resolve exact `VIBERACING_PUBLIC_SNAPSHOTS_ENABLED=true` once at module load:

- `/v1/leaderboards/current`;
- `/v1/leaderboards/{seasonStart}`; and
- `/v1/profiles/{handle}`.

When disabled, the modules remain closed before path/query/header parsing, admission, database
configuration, or resource construction. When enabled, each route:

- accepts only the exact method and same-origin contract;
- applies four-call no-queue admission and a bounded deadline;
- parses closed path/query/header input;
- uses one narrow `viberacing_web` login;
- invokes only snapshot-reading procedures; and
- revalidates the generated public response before serialization.

Public procedures read immutable published snapshots only. They do not aggregate raw usage during a
request. A refresh failure preserves the last-good pointer; finalized snapshots cannot change.

The former score, race, race-status, and direct-token-ranking route modules are absent.

## Enrollment and authentication

Invite/OAuth/initial-passkey enrollment resolves `VIBERACING_ENROLLMENT_ENABLED=true` independently
from returning login and recovery. Optional invite-only policy has its own
`VIBERACING_INVITE_GATE_ENABLED=true` decision.

The local composition includes:

- exact invite parsing when invite policy is enabled;
- GitHub OAuth state plus PKCE with minimal identity scope;
- identity keyed only by immutable numeric GitHub user ID;
- initial passkey registration before a normal session;
- returning discoverable-passkey login;
- purpose-separated encrypted cookies;
- backup-passkey addition and owned non-current passkey revocation;
- one-time recovery-code rotation;
- Argon2id recovery into a five-minute restricted authority;
- replacement-passkey completion before normal session creation; and
- logout.

OAuth tokens are discarded after resolving identity and create no sync authority. WebAuthn
cryptographic verification stays in the application; PostgreSQL only consumes exact bounded
server-issued challenges after verification.

Tests use synthetic keys, ceremonies, OAuth results, clocks, and narrow disposable-database
fixtures. There is no live OAuth app, authenticator, distributed recovery-attempt perimeter, or
production session evidence.

## Private account lifecycle

The account page derives ownership from the active session and exposes no raw internal IDs. Its
local controls cover:

- public profile visibility and provider-breakdown preference;
- passkey and recovery-code management;
- installation, AgentAccount, and device inventory;
- immediate account pause;
- fresh-passkey account reactivation or terminal disconnect;
- fresh-passkey installation/device revocation;
- exact-handle fresh-passkey profile deletion request; and
- active/pending CarRecipe preview and decisions.

One profile may own multiple providers and multiple AgentAccounts for one provider. One installation
may service several accounts; one account may have several account-scoped keys. Device and
installation count never multiplies usage.

Deletion request immediately hides the profile and revokes browser, recovery, installation,
AgentAccount, device, and pending security authority before a bounded Jobs purge can run.

## Batch pairing

Pairing start/poll, `/connect`, and signed-in approval modules each resolve exact
`VIBERACING_PAIRING_ENABLED=true`. There is no separate “new source” gate or source model.

The connector submits one bounded sealed candidate batch. The browser:

- resolves a primary deep link or separately protected fallback code;
- renders bounded provider/reader/account-key evidence for every candidate;
- permits create, attach-to-owned-same-provider, or skip;
- binds the ordered decision digest to one fresh passkey challenge; and
- settles the complete batch atomically.

Polling proves pending-key possession. The database, not the browser, creates server IDs and seals
provider, reader, accounting revision, scope, and trust. Account labels are private metadata and
never ownership keys.

Anonymous start/poll use fixed global and 64-bucket PostgreSQL admission in addition to in-process
no-queue admission. Poll and fallback-code verifier keys are distinct, exact 32-byte values with
optional bounded rotation overlap.

The OpenAPI pairing routes remain `contract-only` because no hosted composed transport result
exists, even though transport-free applications and local connector clients are implemented.

## CarRecipe

Browser proposal creation/approval and device proposal ingress resolve exact
`VIBERACING_CAR_PROPOSALS_ENABLED=true`. Disabled mutation performs no request/state work. Reading
active/private preview and exact rejection remain separately available where required.

A session may propose one closed 24-hour `CarRecipeV1` and approve or reject only its own proposal.
An active account-scoped device may replace the pending proposal through a separate exact signature
but cannot read, approve, reject, or activate it. Only the active recipe reaches public snapshots.

## Database boundary

All Web-backed slices use the exact `VIBERACING_WEB_DATABASE_*` configuration:

- cleartext is accepted only in development/test on exact loopback;
- every other environment requires `verify-full` and a certificate-valid DNS hostname;
- the login must be distinct and have exactly `viberacing_web`;
- the pool probes login identity and TLS before role assumption;
- every borrow resets state before use and before reuse; and
- raw SQL, private tables, protected values, and database exceptions never cross into public
  responses.

The repository creates roles and functions but never a deployment login or password.

## Configuration

Tracked defaults in `.env.example` are intentionally false:

```text
VIBERACING_PUBLIC_SNAPSHOTS_ENABLED=false
VIBERACING_ENROLLMENT_ENABLED=false
VIBERACING_INVITE_GATE_ENABLED=false
VIBERACING_PAIRING_ENABLED=false
VIBERACING_CAR_PROPOSALS_ENABLED=false
```

Every alternate spelling, case, whitespace variant, inherited property, accessor, non-string value,
missing value, or read failure closes the capability. These decisions require module/process
replacement and are not dynamic production kill switches.

Protected session, recovery, pairing-verifier, OAuth, WebAuthn, and database values belong only in
ignored local or protected hosted configuration. Never add a working secret to a tracked file.

## Verification

```text
pnpm run lint:web
pnpm run typecheck:web
pnpm run test:web:coverage
pnpm run build:web
pnpm run test:web:postgres-integration
pnpm run test:web:standalone
```

The unit/coverage/build gates are deterministic. PostgreSQL evidence creates a disposable
hostname-verified TLS database and narrow Web login. The standalone gate exercises locally built
production processes. These commands do not prove external TLS/edge routing, live credentials,
OAuth/authenticator behavior, representative capacity, monitoring, real users, or deployment.

Read [Web agent guidance](AGENTS.md), the
[security invariants](../../docs/architecture/SECURITY_INVARIANTS.md), the
[privacy data map](../../docs/security/PRIVACY_DATA_MAP.md), and the
[implementation ledger](../../docs/IMPLEMENTATION_STATUS.md) before changing this workspace.
