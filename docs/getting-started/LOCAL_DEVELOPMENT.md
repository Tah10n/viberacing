# Local development

## Current scope

The repository provides Phase 0 tooling, a disposable PostgreSQL service, a Phase 1 web prototype,
and twelve Phase 2/3 database-foundation migrations. Everything runnable uses synthetic data only.
It has procedure-only identity, passkey login/management, restricted recovery, pairing, and
source/device lifecycle database capabilities plus Community ingest, retention cleanup, scoring, and
terminal finalization and public score-projection procedures, but no browser/session authentication
or recovery application code, OAuth/Argon2id/WebAuthn or composed pairing route, Jobs scheduler,
real-user ingestion, audited correction, or operational connector. A library-only Rust crate
implements the bounded stable App Server initialization exchange and a candidate `0.144.4`
account/usage parser with fixed methods, discarded account/summary fields, and bounded normalized
daily output. A one-shot supervisor now composes those states with a fixed child argument, local
pipes, cleared ambient environment, output/deadline limits, and reap-before-success behavior. Its
reviewed-launch capability has no public constructor, so it cannot discover, admit, or execute a
local Codex installation. A second inaccessible reviewed context lets a composer consume the
minimized usage into the exact bounded sync JSON, SHA-256 digest, nonce encoding, and device message
checked by Ingest. An isolated one-use signer consumes that closed value only with a third
inaccessible device-bound key capability. A separate inaccessible pending-key/challenge signer and
pure Web verifier agree on an exact synthetic pairing-possession proof. A dormant Web/Auth
application now handles protected primary/secondary poll-verifier derivation, a fixed approved-row
lookup through a separately probed read-write pool, that strict proof, and exact atomic activation
with server-owned IDs behind local admission/timing. It cannot create a transaction, perform browser
or WebAuthn approval, generate/load a real key, or make an HTTP request; no supported version,
source/device provider, key store, connector pairing client, or upload exists. A local Ingest kernel
bounds and authenticates a synthetic exact-body sync request, and a separate adapter constrains
origin replay, database lookup, and submission mapping with mock-pool evidence. A transport-free
application composes those exact boundaries, generates a server request ID, and validates the
acknowledgement/problem decision; isolated PostgreSQL tests separately prove atomic replay and
cleanup. A bounded local Fastify factory now preserves exact raw HTTP evidence, applies no-queue and
deadline policy, and serializes only revalidated contracts, but it has no host/port/TLS launch entry
point. There is no working database login/certificate, live end-to-end PostgreSQL flow, edge path,
connector process, supported adapter, or deployment. A bounded local one-shot Jobs process now wraps
only cleanup/refresh/finalization, but has no live login, scheduler, monitor, or deployment. A
bounded server-only Web PostgreSQL adapter and local public-score GET are implemented and
unit/build-tested, but this repository supplies no working deployment login or TLS certificate. A
successful setup proves repository gates, synthetic frontend behavior, route/adapter boundaries, SQL
constraints, session-bound procedure behavior, lifecycle/scoring concurrency, and database role
isolation; it does not prove a live adapter, deployed API, or production flow. The Ingest server
tests bind only ephemeral loopback sockets and use synthetic requests; no development command
exposes it to the LAN or Internet.

## Prerequisites

- Node.js `24.18.0`, as recorded in `.node-version`;
- pnpm `11.7.0`, as recorded in `package.json`;
- Rust `1.94.0` with `rustfmt` and `clippy`, installed from `rust-toolchain.toml`;
- Git;
- Docker with Compose v2 only when using the local database.

Use a trusted package or toolchain manager. Do not pipe remote installation scripts into a shell.

## Install repository dependencies

From the repository root:

```text
pnpm install --frozen-lockfile --ignore-scripts
pnpm run verify
```

Direct dependencies are exact versions and the lockfile is committed. The workspace rejects
unreviewed dependency build scripts, newly published packages inside the quarantine window,
untrusted registry redirects, and exotic transitive sources.

`pnpm run verify` is deterministic and offline after installation. It includes a complete reachable
Git-history scan, external-host policy, English spelling, dependency-license inventory, contract and
Ingest/Jobs lint/types/coverage, Ingest/Jobs production compilation, contract generation/drift
checks and coverage, web component coverage, and a production web build. It also runs the offline
migration manifest/capability checker plus Rust formatting, all-target checking, tests, and Clippy;
the real PostgreSQL integration is a separate Docker command and a secretless CI job. The optional
`pnpm run check:external-links:online` performs bounded network validation and may fail closed
behind a private DNS/proxy; do not weaken its address or redirect rules to accommodate a
workstation.

After an intentionally reviewed dependency change, regenerate the machine inventory with
`node scripts/check-licenses.mjs --write`, inspect every added package/license, and rerun
verification. Regeneration is evidence capture, not approval. Platform-specific package metadata is
refreshed only with the explicit `--refresh-npm-metadata` flag; review that network-derived diff as
carefully as the lockfile.

## Run the synthetic web prototype

No environment file, account, database, or Codex installation is needed for Phase 1. From the
repository root:

```text
pnpm run dev:web
```

Open the loopback URL printed by Next.js. The development server binds to `127.0.0.1`; do not change
it to a LAN-wide address for convenience. All displayed participants and activity are synthetic.

Useful focused commands:

```text
pnpm run lint:web
pnpm run typecheck:web
pnpm run test:web
pnpm run test:web:coverage
pnpm run build:web
```

Contract-focused commands do not accept or read real account data:

```text
pnpm run check:contracts
pnpm run lint:contracts
pnpm run typecheck:contracts
pnpm run test:contracts:coverage
```

Run `pnpm run generate:contracts` only after intentionally changing a canonical file or manifest
operation under `contracts/v1/`; review both generated diffs and their source digest. The generated
OpenAPI document contains two paths marked `implemented-local`. The corresponding dynamic Next.js
GET and bounded Ingest POST have request/response and build evidence, but no working database login
is tracked and no deployment exists merely because the local operations are documented.

Connector-focused commands use only checked-in synthetic fixtures. Rust tests launch a target-built
fixture executable to prove fixed arguments, environment isolation, protocol order, timeout,
stdout/stderr overload, and cleanup. They do not discover or launch Codex, read a local account,
open a credential store, or upload:

```text
pnpm run check:codex-compatibility
pnpm run test:codex-compatibility-check
cargo test --workspace --all-targets --all-features --locked
```

The `0.144.4` directory, synthetic process fixture, and exact signed sync vector are candidate
development evidence, not a supported-version installation or live integration command. The vector
uses only synthetic identifiers, usage, public key, and signature; the private test seed is derived
at runtime from an obvious fixed label. Do not run a local account through repository tests.

Ingest-focused commands use only synthetic key material, injected capabilities, and mock database
pools:

```text
pnpm run lint:ingest
pnpm run typecheck:ingest
pnpm run test:ingest:coverage
pnpm run build:ingest
```

They verify protected primary/secondary origin-key parsing, the raw-envelope/origin/parser/contract/
device kernel, and redacted database config, fixed SQL, role/session probe, mapper, result, and
failure boundaries. They do not open a database connection or persistent/external HTTP endpoint;
some transport tests bind an ephemeral loopback socket and close it within the case. Do not supply a
real edge key, public key, signature, nonce, usage payload, database credential, or captured
request. See [`apps/ingest/README.md`](../../apps/ingest/README.md) for the exact boundary and
remaining integration work.

Jobs-focused commands use injected synthetic results and never need a database credential:

```text
pnpm run lint:jobs
pnpm run typecheck:jobs
pnpm run test:jobs:coverage
pnpm run build:jobs
```

The built one-shot CLI accepts only `cleanup-expired-ingest-state`,
`refresh-community-season YYYY-MM-DD`, or `finalize-community-season YYYY-MM-DD`. Do not invoke it
against a database until an environment-owned login has been separately provisioned with only
`viberacing_jobs`; the repository does not create that login or provide an application integration
test. See [`apps/jobs/README.md`](../../apps/jobs/README.md) for the exact boundary and remaining
scheduler/deployment work.

The product components and libraries must meet the committed coverage thresholds. Small Next.js
entrypoints are covered by the production build. See
[`apps/web/README.md`](../../apps/web/README.md) for the frontend trust boundaries and data
contract.

Database-focused commands use deterministic synthetic fixtures:

```text
pnpm run test:database-check
pnpm run check:database
pnpm run test:database:integration
```

The integration command creates a uniquely named Compose project containing only `postgres-test`.
That service publishes no host port, stores data on `tmpfs`, and is removed with its network and
storage after the test. It does not touch the normal local database volume. See
[`database/README.md`](../../database/README.md) before changing SQL, roles, or migrations.

## Local configuration

`.env.example` is a public schema containing placeholders and a known local-only compose bootstrap
password. The current web prototype optionally reads `VIBERACING_PUBLIC_ORIGIN` for absolute social
metadata. Without it, development uses loopback and production builds use a reserved `.example`
origin that is not suitable for deployment. A real hosted build must receive its public HTTPS DNS
origin through the deployment environment.

The server-only score and dormant pairing adapters use only `VIBERACING_WEB_DATABASE_*`. Their
tracked user/password are deliberately non-working placeholders and are checked against accidental
reuse of the `DATABASE_*` compose owner. Local integration requires a separately provisioned login
whose only membership is `viberacing_web`; login creation remains environment-owned and is not
automated here. `disable` requires explicit `NODE_ENV=development` or `test` plus loopback. Every
other environment requires `verify-full`, a certificate-valid multi-label DNS hostname, and TLS 1.2
or later. The synthetic page and build never construct either adapter, so they need none of these
settings.

Constructing the pairing applications additionally requires fresh, distinct 32-byte canonical
base64url values in `VIBERACING_WEB_PAIRING_POLL_PRIMARY_KEY_BASE64URL` and
`VIBERACING_WEB_PAIRING_CODE_PRIMARY_KEY_BASE64URL`. The tracked values are intentionally invalid.
During a bounded rotation only, each previous primary may be supplied under its corresponding
`VIBERACING_WEB_PAIRING_POLL_SECONDARY_KEY_BASE64URL` or
`VIBERACING_WEB_PAIRING_CODE_SECONDARY_KEY_BASE64URL`; all configured poll/code values must remain
pairwise distinct. Remove a secondary after every transaction created under that key has passed the
ten-minute database lifetime. Never track, print, or reuse real keys.

The one-shot Jobs runner independently uses only `VIBERACING_JOBS_DATABASE_*`. Its tracked
user/password are separate non-working placeholders, and configuration checks reject reuse of the
compose owner or Web login. Local integration requires another externally provisioned login whose
only membership is `viberacing_jobs`. It follows the same loopback-only cleartext and verified-TLS
rules as Web. Focused tests/builds do not construct a connection and need none of these settings.

If local work needs the public schema, copy `.env.example` to `.env`; `.env` is ignored and must
never be committed.

Do not put production or staging values on a development workstation. Do not use the example
database password anywhere except the loopback-only Compose service, and never pass that owner to
the Web or Jobs adapter.

## Start PostgreSQL

Validate and start the single local service:

```text
docker compose config --quiet
docker compose up -d postgres
docker compose ps
```

The service uses the official PostgreSQL `18.4-alpine` image pinned to a multi-platform SHA-256
index digest. Host access is bound to `127.0.0.1:54329`; it is not exposed on the LAN. Data is
stored in the local `postgres-data` Docker volume. Compose does not apply application migrations to
this persistent service automatically; revisions 0001 through 0012 are currently exercised by the
isolated integration runner only.

Stop the service without deleting its volume:

```text
docker compose down
```

Delete only this project's disposable local database and start clean:

```text
docker compose down --volumes
```

Never point these commands at a production Compose project or reuse this file for deployment.

## Before a commit

Run the complete deterministic gate, then scan the exact staged blobs:

```text
pnpm run verify
git add -- <intended paths>
pnpm run check:public:staged
git diff --cached --check
git diff --cached
```

The last command is a required human review, not ceremonial output. Check generated files, binary
metadata, fixtures, links, environment examples, and workflow permissions before committing.

## Troubleshooting versions

The following commands should report the pinned major or exact toolchain versions:

```text
node --version
pnpm --version
rustc --version
cargo --version
docker --version
```

If `pnpm run verify` says dependencies are stale, run the frozen install command above. Do not
weaken `verifyDepsBeforeRun`, disable the lockfile, or approve a dependency build merely to clear an
error.
