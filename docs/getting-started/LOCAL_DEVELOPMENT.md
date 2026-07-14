# Local development

## Current scope

The repository provides Phase 0 tooling, a disposable PostgreSQL service, a Phase 1 web prototype,
and the first two Phase 2 database migrations. Everything runnable uses synthetic data only. It has
procedure-only identity database capabilities but no authentication application code, HTTP API,
OAuth/WebAuthn verifier, jobs process, real-user ingestion, or connector. A successful setup proves
repository gates, synthetic frontend behavior, SQL constraints, session-bound procedure behavior,
and database role isolation; it does not prove a production flow.

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
Git-history scan, external-host policy, English spelling, dependency-license inventory, web lint,
strict type checking, contract generation/drift checks and coverage, web component coverage, and a
production web build. It also runs the offline migration manifest/capability checker; the real
PostgreSQL integration is a separate Docker command and a secretless CI job. The optional
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

Run `pnpm run generate:contracts` only after intentionally changing a canonical file under
`contracts/v1/`; review both generated diffs and their source digest. The generated OpenAPI document
currently has no paths because no API endpoint exists.

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

`.env.example` is a public schema containing placeholders and a known local-only database password.
The current web prototype optionally reads `VIBERACING_PUBLIC_ORIGIN` for absolute social metadata.
Without it, development uses loopback and production builds use a reserved `.example` origin that is
not suitable for deployment. A real hosted build must receive its public HTTPS DNS origin through
the deployment environment. If local work needs the public schema, copy `.env.example` to `.env`;
`.env` is ignored and must never be committed.

Do not put production or staging values on a development workstation. Do not use the example
database password anywhere except the loopback-only Compose service.

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
this persistent service automatically; revisions 0001 and 0002 are currently exercised by the
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
