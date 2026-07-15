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

Phase 2/3 contract and persistence foundations are also present: three closed, bounded JSON Schemas
plus generated TypeScript validators and OpenAPI components. They are pre-implementation contracts,
not a live API or evidence that real Codex data can be submitted. Nine SQL migrations now add 23
private identity, passkey, restricted-recovery, source, device, pairing, audit, deletion, replay,
usage, and open-season scoring tables with deny-by-default runtime roles, forced RLS, state-machine
constraints, checksum drift detection, and an isolated PostgreSQL capability test. A narrow
procedure boundary implements invite issuance, atomic enrollment, session-bound initial-passkey
challenges, credential-derived login, bounded multi-passkey management, session rotation/revocation,
the immediate lock-down portion of profile deletion, one-time new/existing-source device pairing,
private source/device inventory, source pause/reactivation/unlink, immediate device revoke,
passkey-protected recovery-code rotation, and short-lived recovery-only replacement-passkey
authority. Pairing creates only opaque user-declared sources: it never reads or stores Codex account
email or claims account uniqueness. The source unlink/reactivation procedures require a fresh
consumed source-bound step-up record, but the application that cryptographically verifies WebAuthn
is still absent. Anonymous login challenges also require edge rate limits and bounded cleanup before
exposure. A database-only Community ingest capability now exposes minimal active-device verification
material and accepts bounded source-bound snapshots with exact retry, nonce replay, monotonic
source/date, quarantine, and lifecycle-race enforcement. A Jobs-only procedure deletes bounded
batches of expired nonces and raw snapshots while preserving current source/day values; no scheduler
invokes it. The database does not verify a wire signature. A second Jobs-only procedure serializes
an atomic refresh of one open ISO-week Community season: it sums distinct eligible sources before
one profile daily cap, stores an immutable formula and season binding, shares rank on equal score
and active days, and persists no raw token or source identifier in the score tables. There is still
no HTTP authentication, recovery, ingest, or public-score route, OAuth callback,
Argon2id/WebAuthn/Ed25519 application verifier, connector, cleanup/scoring scheduler or service,
season grace/finalization/correction flow, asynchronous purge worker, or deployed database.

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
