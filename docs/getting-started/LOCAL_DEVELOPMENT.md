# Local development

## Current scope

The repository currently provides Phase 0 tooling and a disposable PostgreSQL service. It does not
yet contain a web application, API, jobs process, or connector. A successful setup proves the
repository gates and local database work; it does not prove product behavior.

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

## Local configuration

`.env.example` is a public schema containing placeholders and a known local-only database password.
If an implementation phase needs environment variables, copy it to `.env`; `.env` is ignored and
must never be committed.

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
stored in the local `postgres-data` Docker volume.

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
