# Local development

## Current scope

The repository provides Phase 0 tooling, a disposable PostgreSQL service, a Phase 1 web prototype,
and thirty-nine checksum-ledgered database migrations. Repository verification uses synthetic data
and injected capabilities only. It has procedure-only identity, passkey login/management, restricted
recovery, pairing, and source/device lifecycle database capabilities plus Community ingest,
retention cleanup, bounded primary profile deletion, scoring, terminal finalization, and public
score/race/status projection procedures. A local Web slice now composes invite redemption, GitHub
OAuth state plus PKCE, encrypted browser cookies, initial WebAuthn registration, returning
discoverable-credential login, a private session-scoped passkey inventory, an account page, fresh
revocation of an owned non-current passkey, and logout. It can also add a backup passkey after
separate existing-key assertion and registration ceremonies and rotate a ten-code recovery batch
after a fresh passkey assertion. A separate local `/recover` flow performs bounded exact-code/dummy
Argon2id work, creates only a five-minute restricted authority, and requires exact replacement
WebAuthn registration before a normal session exists. It has no working invite/OAuth/database
credential or live-authenticator evidence. A local `/connect` page adds session-rate-limited
pending-code review, opaque new or active existing source selection, and fresh-passkey approval with
synthetic evidence. Distributed recovery/anonymous pairing edge controls, deployed cleanup cadence,
real-user ingestion, audited correction, and an operational connector remain absent. A library-only
Rust crate implements the bounded stable App Server initialization exchange and a candidate
`0.144.5` account/usage parser with fixed methods, discarded account/summary fields, and bounded
normalized daily output. A one-shot supervisor now composes those states with a fixed child
argument, local pipes, cleared ambient environment, output/deadline limits, and reap-before-success
behavior. One Windows x86_64 development command validates the active native credential before
bounded fixed-name `PATH` discovery or the explicit path fallback, and can construct that private
launch only after the selected artifact matches the exact `0.144.5` size and SHA-256. It then builds
the previously inaccessible context/key, signs the exact bounded sync JSON, and makes one fixed
upload. It does not retry the POST or establish support. A separate explicitly invoked `check-codex`
command performs only that same point-in-time candidate admission without opening credential
storage, starting Codex, reading an account, persisting a result, or using the network; later sync
repeats admission. A separate inaccessible pending-key/challenge signer and pure Web verifier agree
on an exact synthetic pairing-possession proof. Two transport-free Web/Auth applications create
bounded pending material and later handle protected poll-verifier derivation, a fixed approved-row
lookup through a separately probed read-write pool, that strict proof, and exact atomic activation
with server-owned IDs behind local admission/timing. They cannot perform pairing browser or WebAuthn
approval themselves; the separate `/connect` flow supplies only that intervening step. Two exact
local POST routes now compose those applications behind fixed distributed global/client-bucket
admission. All four connector/browser pairing route modules remain default-off unless exact
`VIBERACING_PAIRING_ENABLED=true` was resolved when each loaded. Creating a new source separately
requires exact `VIBERACING_SOURCE_CREATION_ENABLED=true` in `/connect` and both approval modules;
its default-off state preserves active existing-source pairing. One pairing-only Rust command
generates a device key through the OS CSPRNG, stores resumable pairing state in the native
credential store, and performs the exact start/poll proof. A separate exact local-only command
deletes one origin/label native entry without reading it or revoking server authority. No supported
Codex version, macOS/Linux admission, real-account/deployed sync result, package, release, or
deployment exists. A local Ingest kernel bounds and authenticates a synthetic exact-body sync
request, and a separate adapter constrains origin replay, database lookup, and submission mapping
with mock-pool evidence. A transport-free application composes those exact boundaries, generates a
server request ID, and validates the acknowledgement/problem decision; isolated PostgreSQL tests
separately prove atomic replay and cleanup. A bounded local Fastify factory now preserves exact raw
HTTP evidence, applies no-queue and deadline policy, and serializes only revalidated contracts. A
separate local host now binds that exact composition only on loopback in development/test or under
an explicit Railway-edge production declaration, with bounded partial-startup cleanup and process
shutdown. A separate opt-in gate now proves one full synthetic loopback HTTP-to-PostgreSQL path
through a disposable dedicated Ingest login. There is no deployment database credential/certificate,
trusted external TLS/edge path, supported connector adapter, or deployment. A bounded local one-shot
Jobs process now wraps only cleanup/refresh/finalization. A separate default-off local scheduler
invokes only that runner from fixed UTC process slots. An opt-in synthetic gate composes its
production core under fixed injected UTC time with the real Jobs runner and disposable PostgreSQL. A
second advances the fixed clock by one hour, invokes the production interval handler twice during
the active real-runner cycle, proves the exact recurring catalog plus overlap and same-slot
suppression, and verifies the rearmed terminal reset. A third composes the production process
lifecycle, injects its first handler during the penultimate real database job, and proves graceful
active-call settlement plus no later scheduler job. A fourth starts the built entry point under the
real host clock, reaches the terminal startup-catalog marker without process output, then forcibly
ends only its persistent test child. There is no host-timer delivery, OS-signal delivery,
emitted-child controller settlement before forced termination, wall-clock recurring process
callback, production login, deployed cadence, monitor, or deployment. A bounded server-only Web
PostgreSQL adapter and local public-score GET are implemented and unit/build-tested, but this
repository supplies no working deployment login or TLS certificate. A successful setup proves
repository gates, synthetic frontend behavior, route/adapter boundaries, SQL constraints,
session-bound procedure behavior, lifecycle/scoring concurrency, and database role isolation; it
does not prove a live adapter, deployed API, or production flow. The Ingest server tests bind only
ephemeral loopback sockets and use synthetic requests; no development command exposes it to the LAN
or Internet.

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
Git-history scan, external-host policy, English spelling, dependency-license inventory, contract,
Ingest, Ingest-host, Jobs, and Jobs-scheduler lint/types/coverage, their required production
compilation, the built Ingest-host and Jobs-scheduler entrypoint checks, contract generation/drift
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

Open the configured port through the `localhost` hostname. The development server binds to that
loopback hostname; do not change it to a LAN-wide address for convenience. The matching browser
origin keeps local WebAuthn standards compliant. All displayed participants and activity are
synthetic.

Useful focused commands:

```text
pnpm run lint:web
pnpm run typecheck:web
pnpm run test:web
pnpm run test:web:coverage
pnpm run build:web
pnpm run check:phase1-visual-baselines
```

The baseline check is browser-free and validates the committed 18-image synthetic viewport matrix.
To re-render and compare those images without changing them, first build and start the production
frontend on an explicit loopback port, then run verification from another terminal with an absolute
path to a reviewed Chromium executable:

In the first terminal:

```text
pnpm run build:web
pnpm --filter @viberacing/web exec next start --hostname 127.0.0.1 --port 3317
```

In a second PowerShell terminal, construct the exact loopback origin without treating it as a public
link:

```powershell
$phase1Origin = [System.UriBuilder]::new("http", "127.0.0.1", 3317).Uri.AbsoluteUri
$browserPath = "<absolute-path-to-reviewed-chromium>"
pnpm run verify:phase1-visual-baselines -- --origin $phase1Origin --browser $browserPath
```

Verification first checks the committed manifest and PNGs, requires the reported browser product and
local platform to match that manifest exactly, decodes both sides in isolated Chromium, and fails on
one changed pixel channel. It does not write baseline files. The executable itself remains an
explicit operator-reviewed input rather than a repository-provisioned artifact.

Only when intentionally refreshing the reviewed evidence, use the separate write command and then
the offline checker:

```powershell
pnpm run capture:phase1-visual-baselines -- --origin $phase1Origin --browser $browserPath --write
pnpm run check:phase1-visual-baselines
```

The capture uses a new temporary profile, motion-off synthetic data, and page-only PNG output. It
fails if page resources leave the exact loopback origin or reviewed header/hero elements exceed the
viewport. It does not discover or reuse a signed-in browser. Inspect every image and manifest digest
before staging; the offline root gate protects stored evidence but does not decide whether a visual
change is acceptable.

Contract-focused commands do not accept or read real account data:

```text
pnpm run check:contracts
pnpm run lint:contracts
pnpm run typecheck:contracts
pnpm run test:contracts:coverage
pnpm run build:contracts
```

Run `pnpm run generate:contracts` only after intentionally changing a canonical file or manifest
operation under `contracts/v1/`; review both generated diffs and their source digest. The generated
OpenAPI document contains two paths marked `implemented-local`. The corresponding dynamic Next.js
GET and bounded Ingest POST have request/response and build evidence, but no working database login
is tracked. The separate Ingest integration creates and removes only a synthetic disposable login;
no deployment exists merely because the local operations are documented.

Connector-focused commands use only checked-in synthetic fixtures. Rust tests launch a target-built
fixture executable to prove fixed arguments, environment isolation, protocol order, timeout,
stdout/stderr overload, cleanup, and bounded candidate-selection logic. They do not discover or
launch an installed Codex binary, read a local account, open a credential store, or upload:

```text
pnpm run check:codex-compatibility
pnpm run test:codex-compatibility-check
cargo test --workspace --all-targets --all-features --locked
```

The `0.144.5` directory, synthetic process fixture, and exact signed sync vector are candidate
development evidence, not a supported-version installation. The vector uses only synthetic
identifiers, usage, public key, and signature; the private test seed is derived at runtime from an
obvious fixed label. Repository tests never run a local account or open a real credential.

Before pairing, a Windows x86_64 developer may explicitly check only the exact candidate artifact:

```text
cargo run -p viberacing-connector -- check-codex [--codex <absolute-codex-0.144.5-executable>] [--diagnostic-preview]
```

Without `--codex`, this reads only the bounded fixed-name `PATH` search defined by ADR 0051. The
explicit form uses identical canonical size/SHA-256 admission. The command starts no Codex process,
opens no connector credential or account, persists nothing, and uses no network. Success is only a
point-in-time candidate result, explicitly does not claim support, and is never reused by `sync`.

`--diagnostic-preview` replaces the normal success line with one closed local v1 preview containing
only the connector/candidate versions, fixed Windows x86_64 contract, a passed/not-admitted/
unsupported-platform class, and `supported-codex-versions: none`. A failed admission remains
nonzero. The preview excludes paths, digests, environment values, credentials, account, and usage;
the preview itself is written only to stdout, while the unchanged generic failure can still appear
on stderr. The connector neither saves nor sends it. Read the complete preview before deliberately
copying it to a trusted support context.

On Windows x86_64, the repository can also build and exercise only a disposable portable copy of the
development connector:

```text
pnpm run test:connector:windows-portable
```

This command builds the locked release profile, copies the fixed `0.0.0` binary under the operating
system temporary directory, runs only exact help and missing-candidate checks with a cleared
environment, and removes the copy. It is not an installer, package, upgrade, revoke, signature,
provenance, support, or clean-machine result. The secretless CI workflow declares the same smoke on
`windows-2025`; the tracked declaration alone is not evidence that a hosted run passed.

After an explicit `connect` has activated the same origin and label, a Windows x86_64 developer may
manually run one candidate sync:

```text
cargo run -p viberacing-connector -- sync --origin <https-origin> --label <device-label> [--codex <absolute-codex-0.144.5-executable>]
```

This command intentionally reads the local account's bounded daily usage and sends it once to the
explicit origin. Without `--codex` it considers only two fixed executable names through a bounded
absolute-directory `PATH` search; the optional explicit path is the controlled fallback. Both forms
fail unless the executable exactly matches the checked-in candidate size/SHA-256 policy and can be
held against write substitution. It does not supply edge origin proof, so a real remote origin still
needs the separately reviewed edge/Ingest deployment path; loopback tests use synthetic data only.

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

The separate host-focused gates use only synthetic placeholders and ephemeral loopback listeners:

```text
pnpm run lint:ingest-host
pnpm run typecheck:ingest-host
pnpm run test:ingest-host:coverage
pnpm run build:contracts
pnpm run build:ingest
pnpm run build:ingest-host
pnpm run check:ingest-host-entrypoint
```

After those ordered builds, the emitted entrypoint is `node apps/ingest-host/dist/main.js`. Start it
with Node directly so SIGTERM reaches the process. Tracked `.env.example` values are deliberately
non-working and keep `VIBERACING_INGEST_ENABLED=false`. An ignored local environment must first set
that field to exact `true`; only then can exact loopback host/port and `loopback-cleartext` be
evaluated. Production additionally requires exact `0.0.0.0`, Railway-injected `PORT`,
`railway-edge`, and a 40-to-300-second platform drain declaration. The latch is startup-only: it
does not prove a deployed restart, route denial, or already-running instance drain. Do not add real
login/key values to a repository file or treat a successful local bind as external TLS/deployment
evidence. See [`apps/ingest-host/README.md`](../../apps/ingest-host/README.md) for the complete
listener and shutdown contract.

Jobs-focused commands use injected synthetic results and never need a database credential:

```text
pnpm run lint:jobs
pnpm run typecheck:jobs
pnpm run test:jobs:coverage
pnpm run build:jobs
```

The built one-shot CLI accepts only `cleanup-expired-auth-state`, `cleanup-abandoned-enrollments`,
`cleanup-expired-audit-events`, `cleanup-expired-car-recipe-proposals`, `cleanup-expired-invites`,
`cleanup-expired-ingest-state`, `cleanup-expired-pairing-state`, `cleanup-expired-sessions`,
`cleanup-finalized-source-day-values`, `cleanup-aged-revoked-passkeys`,
`cleanup-aged-revoked-devices`, `reset-expired-pairing-request-windows`,
`cleanup-terminal-deletion-jobs`, `redact-aged-pairing-approval-provenance`,
`purge-profile-deletions`, `refresh-community-season YYYY-MM-DD`, or
`finalize-community-season YYYY-MM-DD`. Do not invoke it against a persistent database until an
environment-owned login has been separately provisioned with only `viberacing_jobs`; the repository
does not create a deployment login.

The separate synthetic Jobs application path is opt-in and requires Docker:

```text
pnpm run test:jobs:postgres-integration
```

It applies the reviewed migrations to one disposable PostgreSQL container, creates only synthetic
narrow and negative-control logins, runs all seventeen built commands, verifies generic output and
exact state, and removes the container and storage. It proves no external audit sink, combined
scheduler execution, production login/TLS, monitoring, capacity, real-user retention, or deployment.
See [`apps/jobs/README.md`](../../apps/jobs/README.md) for the exact boundary.

The separate local scheduler uses injected time, timers, and a fake runner in its focused checks:

```text
pnpm run lint:jobs-scheduler
pnpm run typecheck:jobs-scheduler
pnpm run test:jobs-scheduler:coverage
pnpm run build:jobs
pnpm run build:jobs-scheduler
pnpm run check:jobs-scheduler-entrypoint
pnpm run test:jobs-scheduler:postgres-integration
pnpm run test:jobs-scheduler:timer-postgres-integration
pnpm run test:jobs-scheduler:lifecycle-postgres-integration
pnpm run test:jobs-scheduler:process-postgres-integration
```

The first PostgreSQL command is a separate opt-in Docker gate. It builds the production scheduler
core and Jobs runner, injects one fixed UTC clock/timer, runs the exact ordered seventeen-job
catalog against one disposable PostgreSQL database, fingerprints every private table around a
widened-login denial, and checks exact narrow-login stored state. The second advances the fixed
clock by one hour, invokes the production interval handler twice during the active real-runner
cycle, proves the exact recurring catalog plus overlap and same-slot suppression, and verifies the
rearmed terminal reset. The third injects the production first-signal handler during the penultimate
real database job, proves active-call settlement and no later scheduler job, and requires exact
graceful cleanup plus code 0 before invoking the omitted reset separately. The fourth starts the
built scheduler entry point under the real host clock, requires host/database UTC-date agreement,
waits for the terminal startup-catalog marker without process output, forcibly ends only its
persistent test child, and then verifies the same exact state. It does not prove controller
settlement before that forced termination. The timer mode does not prove host-timer delivery, and
the lifecycle mode does not prove OS-signal delivery. None proves a wall-clock recurring process
callback, durable/deployed cadence, production credentials/TLS, monitoring, capacity, or real-user
retention.

The emitted process accepts no arguments and remains disabled unless the runtime supplies exact
`VIBERACING_JOBS_SCHEDULER_ENABLED=true`. That latch is read before the Jobs runner or any database
configuration. The fixed catalog derives only the current and latest grace-eligible Community
Monday, stores slot state in memory, and invokes the existing runner sequentially. Do not enable it
against a persistent database until the separate narrow Jobs login, single-replica deployment,
cadence, monitoring, capacity, and missed-backlog policy have been reviewed. See
[`apps/jobs-scheduler/README.md`](../../apps/jobs-scheduler/README.md) for the exact local boundary.

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

The separate full Ingest path is opt-in and also requires Docker:

```text
pnpm run test:ingest:postgres-integration
```

This command builds emitted contracts, Ingest, and host code; starts one one-off `postgres-test`
container with only an ephemeral `127.0.0.1` port; applies the reviewed migration manifest; and
creates an obviously synthetic login with only `viberacing_ingest`. It sends independently composed
signed HTTP requests through the real loopback host and checks accepted, duplicate, persistent
origin-replay, revoked-device, response-header, request-ID, and exact persistence behavior. It also
holds four valid requests at the first replay-store call, requires a fifth generic 503 without a
fifth replay call, and proves the four accepted responses after release. After closing the imported
host, it starts the built entry point as a separate silent process, observes listener readiness with
a connection-only probe, proves another accepted request, and forcibly ends only that child. The
blocker, emitted child, container, network, and storage are removed in `finally`; the normal local
database volume is never used. This is synthetic local evidence, not OS-signal delivery, graceful
emitted-child settlement, a deployment credential, external TLS/edge route, secret-manager
integration, real-user result, or capacity test.

## Local configuration

`.env.example` is a public schema containing placeholders and a known local-only compose bootstrap
password. The current web prototype optionally reads `VIBERACING_PUBLIC_ORIGIN` for absolute social
metadata. Without it, development uses loopback and production builds use a reserved `.example`
origin that is not suitable for deployment. A real hosted build must receive its public HTTPS DNS
origin through the deployment environment.

The three public score/race/status routes remain generically unavailable unless an ignored local
environment sets exact `VIBERACING_PUBLIC_RANKING_ENABLED=true` before their modules load. The
tracked example stays false, so the visible page keeps its synthetic fallback. This local gate does
not prove deployed route/cache denial or reload already-running instances.

The separate full public-read path is opt-in and requires Docker:

```text
pnpm run test:web:postgres-integration
```

It applies the reviewed migrations to a one-off `postgres-test` container, starts all three real
Next development GETs on loopback, proves a login with extra membership fails generically without
private-table mutation, validates exact score/race/status contracts through the narrow synthetic
login, and repeats the full private-state fingerprint after successful reads. It then holds exactly
four observed score queries behind a controlled owner lock, rejects a fifth request without a fifth
public-score query, rolls back, and validates the four original responses. It restores the exact
pre-run `next-env.d.ts`, bounds and discards all child output, and removes both Next processes plus
the blocker, container, network, and storage. It is not a production Next process, deployment
credential/TLS, cache, edge, monitoring, load/capacity, real-user, or deployment test.

Connector pairing start/poll and signed-in approval options/verification remain generically
unavailable unless an ignored local environment sets exact `VIBERACING_PAIRING_ENABLED=true` before
all four modules load. The tracked example stays false. Disabled POST cancels an available request
body before request parsing, runtime/service construction, admission acquisition, protected
configuration, or database work. This is not a dynamic/deployed switch.

New-source selection and approval separately remain unavailable unless the ignored local environment
sets exact `VIBERACING_SOURCE_CREATION_ENABLED=true` before `/connect` and both approval modules
load. The tracked example stays false. While disabled, the EN/RU form omits the new-source choice,
defaults to the first active existing source, and disables submission when none exists. The service
also rejects new-source initiation before code/challenge work and rejects an in-flight new-source
challenge before passkey/database completion; its encrypted choice and v2 context digest remain
exactly bound. Existing-source pairing still requires the pairing flag but not this second flag.
Changing either environment value does not reload an existing worker, stop an old enabled instance,
or prove deployed route denial.

CarRecipe proposal creation and approval separately remain unavailable unless the ignored local
environment sets exact `VIBERACING_CAR_PROPOSALS_ENABLED=true` before the account page, browser
create/approve modules, and device proposal module load. The tracked example stays false. Disabled
EN/RU account UI keeps active and private pending previews plus the exact encrypted session-bound
reject form, but omits editor and approve. Browser/device mutation returns generic no-store 503
before parsing, runtime/service construction, admission, proof, or database work; the browser
service repeats the decision before recipe/control/session work. Changing the value does not reload
an existing worker, stop an old enabled instance, or prove deployed route denial.

Invite/OAuth/initial-passkey enrollment separately remains unavailable unless the ignored local
environment sets exact `VIBERACING_ENROLLMENT_ENABLED=true` before `/join`, `/join/passkey`, GitHub
start/callback, and initial-passkey options/verification modules load. The tracked example stays
false. Disabled EN/RU pages omit both forms, and disabled HTTP returns generic no-store 503 before
request parsing, runtime/service construction, admission, protected configuration, OAuth/WebAuthn,
or database work. All four service methods repeat the literal decision before input, cookie, time,
entropy, or private dependency work. Active-session redirects, returning login, restricted recovery,
logout, and account security actions remain available. Changing the value does not clear an existing
continuation or pending session, invoke the separate abandoned-enrollment cleanup, repair an invite,
reload an existing worker, stop an enabled in-flight request, or prove deployed route denial. The
explicit `cleanup-abandoned-enrollments` Jobs command is separately available only for canonical
rows after every retained session/challenge expiry is past. The default-off local scheduler includes
that exact object in its hourly catalog and combined synthetic PostgreSQL integration, but no
deployed invocation is proven.

The server-only score, enrollment, and local pairing adapters use only `VIBERACING_WEB_DATABASE_*`.
Their tracked user/password are deliberately non-working placeholders and are checked against
accidental reuse of the `DATABASE_*` compose owner. Local integration requires a separately
provisioned login whose only membership is `viberacing_web`; login creation remains
environment-owned and is not automated here. `disable` requires explicit `NODE_ENV=development` or
`test` plus loopback. Every other environment requires `verify-full`, a certificate-valid
multi-label DNS hostname, and TLS 1.2 or later. The synthetic page and build never construct either
adapter, so they need none of these settings. The disabled join shell also renders without protected
configuration; enabled server actions fail closed until the complete enrollment environment exists.

Enabled local enrollment additionally requires a dedicated GitHub OAuth app whose callback is
exactly `/auth/github/callback` on the configured `localhost` origin, valid `GITHUB_CLIENT_ID` and
`GITHUB_CLIENT_SECRET`, and a fresh canonical 32-byte base64url `SESSION_SECRET`. Set
`WEBAUTHN_ORIGIN` exactly equal to `VIBERACING_PUBLIC_ORIGIN` and set `WEBAUTHN_RP_ID` to that
origin's lowercase hostname (`localhost` for the documented loopback setup). WebAuthn RP IDs cannot
be IP addresses. Recovery-code rotation additionally needs a distinct canonical 32-byte
`VIBERACING_RECOVERY_PEPPER` and deployment-reviewed integer values for the three
`VIBERACING_RECOVERY_ARGON2_*` settings within the application's accepted range. Recovery options
also require `VIBERACING_RECOVERY_MINIMUM_RESPONSE_MS`, a deployment-reviewed integer from 100 to
5000; do not commit the chosen production timing value. The tracked values are non-working
placeholders and intentionally do not publish deployment work factors or response timing. The
`/connect` approval path additionally requires a distinct canonical 32-byte
`VIBERACING_WEB_PAIRING_CODE_PRIMARY_KEY_BASE64URL` plus deployment-reviewed private integers in
`VIBERACING_PAIRING_APPROVAL_ATTEMPT_LIMIT` and `VIBERACING_PAIRING_APPROVAL_WINDOW_SECONDS`. Do not
commit real keys or selected production attempt policy. A manual flow also needs an externally
issued invite whose stored digest matches its 256-bit secret; this repository intentionally provides
no issuer shortcut or sample valid invite. Never reuse these values between development, staging,
and production.

Constructing the start/activation pairing service additionally requires a fresh, distinct 32-byte
canonical base64url value in `VIBERACING_WEB_PAIRING_POLL_PRIMARY_KEY_BASE64URL`; the code key above
is shared only as protected configuration, never as a returned container. The tracked values are
intentionally invalid. During a bounded rotation only, each previous primary may be supplied under
its corresponding `VIBERACING_WEB_PAIRING_POLL_SECONDARY_KEY_BASE64URL` or
`VIBERACING_WEB_PAIRING_CODE_SECONDARY_KEY_BASE64URL`; all configured poll/code values must remain
pairwise distinct. Remove a secondary after every transaction created under that key has passed the
ten-minute database lifetime. Never track, print, or reuse real keys.

The anonymous pairing routes also require six deployment-private decimal settings:
`VIBERACING_WEB_PAIRING_START_GLOBAL_LIMIT`, `VIBERACING_WEB_PAIRING_START_BUCKET_LIMIT`,
`VIBERACING_WEB_PAIRING_START_WINDOW_SECONDS`, `VIBERACING_WEB_PAIRING_POLL_GLOBAL_LIMIT`,
`VIBERACING_WEB_PAIRING_POLL_BUCKET_LIMIT`, and `VIBERACING_WEB_PAIRING_POLL_WINDOW_SECONDS`. Bucket
limits must not exceed their operation-global limit; windows are one through 3600 seconds and global
limits are at most 1,000,000. The tracked values are deliberately non-working placeholders. Review
real values privately against capacity; do not commit them.

### Inspect the local connector command

```text
cargo run -p viberacing-connector -- --help
```

After the complete Web/Auth database environment is configured, the local command shape is:

```text
cargo run -p viberacing-connector -- connect --origin <loopback-origin> --label "Local device"
```

This writes a real device credential to the current user's native OS credential store before the
network start. Run only one connect process for an origin/label and do not use production or shared
credentials in local development. The repository does not ship a valid invite, Web login, pairing
HMAC key, database login, or released connector, so the command is not an end-to-end setup shortcut.

To delete only that exact local origin/label record, use:

```text
cargo run -p viberacing-connector -- forget-local --origin <loopback-origin> --label "Local device"
```

The command is idempotent and does not inspect the record or contact the service. It does not revoke
an activated server device or erase copied key material; review and revoke the matching device in
the authenticated Vibe Racing account before reconnecting. Do not use it against a shared or
production credential as a local-development cleanup shortcut.

The one-shot Jobs runner independently uses only `VIBERACING_JOBS_DATABASE_*`. Its tracked
user/password are separate non-working placeholders, and configuration checks reject reuse of the
compose owner or Web login. Local integration requires another externally provisioned login whose
only membership is `viberacing_jobs`. It follows the same loopback-only cleartext and verified-TLS
rules as Web. Focused tests/builds do not construct a connection and need none of these settings.
The scheduler's separate exact enable latch is not a credential and does not relax any of those
requirements.

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
this persistent service automatically; revisions 0001 through 0029 are currently exercised by the
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
