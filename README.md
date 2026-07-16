# Vibe Racing

> Status: Phase 2/3 persistence foundations in progress. No production service or released connector
> exists.

External participation is closed until real public maintainers, CODEOWNERS, and private reporting
channels are configured. Local identities are never copied into the repository to fill that gap.

Vibe Racing is an open-source, pixel-art weekly leaderboard for people using Codex. Participants
connect a local, least-privileged connector, submit their own token-activity buckets, and appear as
racing cars on a public track.

The current runnable site is deliberately synthetic: it lets contributors evaluate the race,
leaderboard, profile, themes, localization, accessibility, and scoring presentation without an
account, connector, attached application database, analytics, or real usage data.

## Trust model

Community results are self-reported by local devices. They are not verified by OpenAI and must never
be used for prizes, money, access control, or other valuable benefits. A separate Verified league
remains disabled until a server-verifiable OpenAI data source exists.

The project does not collect prompts, conversations, repository contents, Codex access tokens, API
keys, or arbitrary user-uploaded files.

## Current documents

- [Public implementation plan](docs/PROJECT_PLAN.md)
- [Implementation status](docs/IMPLEMENTATION_STATUS.md)
- [Security invariants](docs/architecture/SECURITY_INVARIANTS.md)
- [Threat model](docs/security/THREAT_MODEL.md)
- [Abuse cases](docs/security/ABUSE_CASES.md)
- [Privacy data map](docs/security/PRIVACY_DATA_MAP.md)
- [System context](docs/architecture/SYSTEM_CONTEXT.md) and
  [data flows](docs/architecture/DATA_FLOW.md)
- [Compatibility policy](docs/architecture/COMPATIBILITY_POLICY.md)
- [Versioned public contracts](contracts/README.md)
- [Database foundation](database/README.md)
- [Architecture decisions](docs/decisions/README.md)
- [Local development](docs/getting-started/LOCAL_DEVELOPMENT.md)
- [Web prototype](apps/web/README.md)
- [Ingest verification kernel](apps/ingest/README.md)
- [Connector protocol foundation](crates/connector/README.md)
- [Dependency policy](docs/security/DEPENDENCY_POLICY.md)
- [Dependency inventory](docs/reference/dependency-inventory.json)
- [Asset provenance](docs/reference/ASSET_PROVENANCE.md)
- [Pull-request CI trust model](docs/architecture/CI_TRUST_MODEL.md)
- [Public repository data policy](docs/security/PUBLIC_REPOSITORY_POLICY.md)
- [Documentation index](docs/README.md)
- [Repository guidance for coding agents](AGENTS.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Governance](GOVERNANCE.md)
- [Maintainers and publication gate](MAINTAINERS.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [Support](SUPPORT.md)
- [Roadmap](ROADMAP.md)
- [Release policy](RELEASE.md)
- [Changelog](CHANGELOG.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
- [Russian overview](README.ru.md)

## Open-source baseline

The code is licensed under [Apache-2.0](LICENSE). The current product visuals are local HTML, CSS,
canvas primitives, fixed pixel recipes, and one documented project-generated social preview; no
remote fonts or third-party source visual assets are loaded. The current tree has pinned toolchains,
locked dependencies, reproducible repository gates, read-only secretless pull-request CI, and a
disposable loopback-only PostgreSQL service. Protected reviews, remote security settings, documented
governance, and signed and attested connector releases remain gates before public beta.

The governance documents and structured contribution forms are now present and policy-tested. The
repository still has no GitHub remote, public maintainer registry, CODEOWNERS file, or verified
private reporting channels; those hosted controls cannot be safely invented from local data.

Phase 2/3 contract and persistence foundations are also present: five closed, bounded JSON Schemas
plus generated TypeScript validators and locally implemented OpenAPI GET and POST operations. They
cover connector sync/result, problem details, a one-season Community score query, and a
response-only top-32 Community score page with fixed self-reported trust metadata. A server-only
fail-closed mapper now converts only the exact ten-column SQL projection into that response and
rejects malformed, inconsistent, oversized, or contract-invalid results. A bounded server-only
PostgreSQL adapter now uses a separate least-privileged Web login contract, certificate-verified
production transport, a four-connection pool, per-checkout role/read-only verification, fixed
deadlines, and one parameterized top-32 procedure call. A server-only HTTP problem factory now
generates opaque 128-bit request IDs and closed, contract-validated, no-store error responses. A
thin server-only route now enforces the exact query, GET-only method and `Accept` policy,
four-request no-queue admission, adapter deadline policy, store-error translation, final response
validation, and no-store/no-CORS headers. It is locally implemented, not deployed: there is still no
cache, deployment login/TLS integration, edge rate policy, or live API, and this is not evidence
that real Codex data can be submitted. A separate pure local Ingest kernel now copies and bounds the
exact Community sync body and raw headers, verifies a replay-consumed body-bound origin HMAC before
JSON or device work, rejects duplicate headers/decoded keys and excessive parser structure,
validates the generated sync contract, and strictly verifies the source-bound Ed25519 request. It
returns only a frozen database-ready allowlist. A separate bounded Ingest PostgreSQL adapter now
revalidates that allowlist, copies all binary/array parameters, verifies the exact least-privileged
Ingest login/role boundary on every checkout, and exposes only fixed origin-replay, device-lookup,
and submission calls through a four-client deadline-bound pool. Its transport config is
loopback-only without TLS and otherwise certificate-verified; tests use mock pools and no working
login. A protected local factory now requires one exact primary origin HMAC pair and permits one
complete distinct rotation pair through namespaced configuration; it returns only the verifier and
the repository contains no real key or secret-manager binding. A forced-RLS PostgreSQL replay table
now stores only the origin key ID, domain-separated nonce digest, and millisecond expiry; one Ingest
procedure atomically consumes it, and an observed race proves one winner for an expired tuple. A
transport-free application boundary now generates one server request ID, composes that
replay/device/submission adapter with the exact verifier, waits for database settlement, and returns
only a validated acknowledgement or generic problem decision. A separate local Fastify server
factory now preserves the exact raw body/header evidence for `POST /v1/community/sync`, rejects
proxy and inbound request ID trust, admits four application calls without a queue, applies bounded
parser/header/connection and 5/33/34-second request/handler/connection deadlines, and serializes
only revalidated `no-store` success/problem contracts. It has loopback and injection evidence but no
deployment entry point. A library-only Rust foundation now emits the fixed stable App Server
handshake and, only after it succeeds, a candidate `0.144.4` account/usage sequence. It confirms
ChatGPT mode while discarding email/plan/summary values and returns at most 31 sorted strict
date/token entries. Exact release metadata, schema digests, minimal extracts, fixtures, and a
drift/matrix checker are committed, but the official artifact was not independently executed and the
compatibility matrix remains empty. A one-shot supervisor now proves the exact sequence against a
target-built synthetic child with a fixed `app-server` argument, local pipes, cleared ambient
environment, bounded stdout/stderr/time, late-output rejection, and reap-before-success cleanup. Its
reviewed-launch capability has no public constructor. A second inaccessible reviewed context now
lets a candidate composer consume the minimized entries into the exact `ConnectorSyncV1` JSON,
SHA-256 digest, unpadded base64url nonce, and LF-separated device-signature message. An isolated
one-use signer consumes that closed material with an equally inaccessible device-bound Ed25519 key
capability and returns only the same body plus five exact header values. A shared synthetic vector
proves the exact public key/signature across Rust and the production Ingest verifier. A separate
inaccessible pending-key/challenge signer and server-only Web verifier now agree on the exact
domain-separated pairing-possession message and a second shared vector. There is still no executable
discovery/path or artifact/version admission, real Codex execution, cross-platform result,
source/device context provider, secure key generation/store, pairing transaction/HTTP client,
poll-token verifier, browser approval/activation composition, signed upload, live protected key
injection, edge signer, direct-origin denial, host/port/TLS configuration, distributed rate policy,
monitoring, operational connector, live database connection, load evidence, or deployment. Twelve
SQL migrations now add 24 private identity, passkey, restricted-recovery, source, device, pairing,
audit, deletion, replay, usage, and Community scoring tables with deny-by-default runtime roles,
forced RLS, state-machine constraints, checksum drift detection, and an isolated PostgreSQL
capability test. A narrow procedure boundary implements invite issuance, atomic enrollment,
session-bound initial-passkey challenges, credential-derived login, bounded multi-passkey
management, session rotation/revocation, the immediate lock-down portion of profile deletion,
one-time new/existing-source device pairing, private source/device inventory, source
pause/reactivation/unlink, immediate device revoke, passkey-protected recovery-code rotation, and
short-lived recovery-only replacement-passkey authority. Pairing creates only opaque user-declared
sources: it never reads or stores Codex account email or claims account uniqueness. The source
unlink/reactivation procedures require a fresh consumed source-bound step-up record, but the
application that cryptographically verifies WebAuthn is still absent. Anonymous login challenges
also require edge rate limits and bounded cleanup before exposure. A database-only Community ingest
capability now exposes minimal active-device verification material and accepts bounded source-bound
snapshots with exact retry, nonce replay, monotonic source/date, quarantine, and lifecycle-race
enforcement. A Jobs-only procedure deletes independently bounded batches of expired origin nonces,
device nonces, and raw snapshots while preserving current source/day values. The database does not
verify a wire signature; the local kernel and adapter are composed locally and exercised together
with a signed synthetic request, while the Fastify boundary separately proves the raw transport
handoff with a mock application. The complete HTTP-to-PostgreSQL path is not exercised through a
real login. A second Jobs-only procedure serializes an atomic refresh of one open ISO-week Community
season: it sums distinct eligible sources before one profile daily cap, stores an immutable formula
and season binding, shares rank on equal score and active days, and persists no raw token or source
identifier in the score tables. Revision 0010 adds a public 48-hour server-time grace rule,
late-snapshot quarantine, and a Jobs-only idempotent finalization procedure whose terminal metadata
and score projection reject silent rewrites while profile purge can still remove personal rows. One
local one-shot Jobs runner now wraps exactly cleanup, refresh, or finalization with a distinct
least-privileged configuration namespace, one-client pool, per-checkout role/login/search-path
probe, fixed deadlines and prepared parameters, closed result validation, destructive release after
failure, and stable non-reflective CLI output. It has no scheduler, live login/certificate,
monitoring backend, retry loop, application-to-PostgreSQL integration result, or deployment.
Revision 0011 gives only the Web database role a bounded active-profile score projection containing
no raw values, private identifiers, or exact timestamps. The score response component and Web
PostgreSQL adapter preserve only that public allowlist through the local score route; the visible
site still uses synthetic fixtures. There is still no browser/session authentication or recovery
route, OAuth callback, Argon2id/WebAuthn or composed pairing application/route, deployed
Ingest/score API, operational connector, cleanup/scoring scheduler, audited correction flow,
asynchronous purge worker, live Ingest/Jobs database integration, or deployed database.

## Run and verify the synthetic prototype

```text
pnpm install --frozen-lockfile --ignore-scripts
pnpm run dev:web
pnpm run verify
```

`pnpm run check:publication` is a separate fail-closed gate. It is expected to fail in the current
pre-public state and must pass only after real hosted identities and controls are configured.

The development site binds to loopback and displays only committed synthetic fixtures. See
[local development](docs/getting-started/LOCAL_DEVELOPMENT.md) before running it or starting
PostgreSQL. Application authentication and real-user ingestion do not exist yet; the database
evidence uses only rolled-back or disposable synthetic fixtures.

## Important warning

Do not place production credentials, personal account data, private logs, internal anti-abuse
thresholds, or local machine paths in this repository. Treat every tracked file as public. Run
`pnpm run verify`, then scan and review the exact staged snapshot before committing.
