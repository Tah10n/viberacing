# Implementation status

This page records only evidence that exists in the public working tree. The
[project plan](PROJECT_PLAN.md) remains the source of intended behavior.

## Capability summary

A scannable index of what exists and what does not. "Local" means synthetic or injected evidence in
the working tree, not a deployed service, production credential, or real-user result. The detailed
evidence for each row follows in the sections below and in the linked ADRs; this table is an index,
not a replacement for them. [ADR 0068](decisions/0068-multi-agent-token-leaderboard-and-mcp.md)
records the proposed direct multi-agent token accounting, leaderboard, and optional MCP direction,
and [ADR 0069](decisions/0069-thin-client-and-low-friction-onboarding.md) records the proposed thin
client, anonymous onboarding, and low-friction hybrid enrollment direction. Those broad directions
remain planning scope. ADRs [0071](decisions/0071-provider-attributed-usage-sync-foundation.md),
[0072](decisions/0072-direct-community-token-leaderboard.md), and
[0073](decisions/0073-candidate-connector-usage-sync-cutover.md) implement the shortest local
Codex-only path from the existing reader through `UsageSyncV1` to a direct token leaderboard.

| Capability                                                                               | Status                             | Evidence pointer                                                                                                  |
| ---------------------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Public foundation: governance, CI, supply-chain, licenses, links, history                | Implemented                        | `check:community`, `check:licenses`, `check:external-links`, `check:history`                                      |
| Public-safety scans: secrets, personal data, local paths, staged blobs                   | Implemented                        | `check:public`, `check:public:staged`                                                                             |
| Phase 1 visual prototype: three themes, pixel renderer, a11y, EN/RU                      | Implemented (local)                | `check:phase1-visual-baselines`                                                                                   |
| Web preview production image and standalone runtime smoke                                | Implemented (local)                | `verify:web:deployment`, `Dockerfile`, `railway.json`                                                             |
| Web search metadata, root canonical, robots and sitemap                                  | Implemented (local)                | `test:web`, `verify:web:deployment`                                                                               |
| Ingest, Jobs-scheduler, and migration production images and Railway configs              | Implemented (local packaging)      | `deploy/`, three local image builds                                                                               |
| Cloudflare sync origin signer and production-Ingest proof compatibility                  | Implemented (local)                | `test:edge`, `test:edge-ingest-compatibility`, ADR 0070                                                           |
| Design system and standalone race-broadcast exploration                                  | Documented reference only          | `docs/design/`; manual reference review, not implemented in `apps/web`                                            |
| Contracts: JSON Schema, generated TypeScript/OpenAPI, runtime validator                  | Implemented                        | `check:contracts`, `test:contracts:coverage`                                                                      |
| Database: 43 migrations, forced-RLS private tables, isolated roles, procedures           | Implemented (local integration)    | `check:database`, `test:database:integration`                                                                     |
| Public score/race/status/token routes and least-privilege Web adapters                   | Implemented (local, default-off)   | `test:web:postgres-integration`, `test:web-query-plan-evidence`                                                   |
| Identity, passkeys, restricted recovery, sessions, account controls                      | Implemented (local, synthetic)     | `test:web:coverage`                                                                                               |
| Source/device lifecycle and pairing approval                                             | Implemented (local, default-off)   | `test:web:coverage`                                                                                               |
| CarRecipe proposal/approval: session, device ingress, agent skill                        | Implemented (local, default-off)   | `test:web:coverage`, `check:agent-skills`                                                                         |
| Ingest: kernel, adapter, application, HTTP factory, host                                 | Implemented (local, default-off)   | `test:ingest:coverage`, `test:ingest:postgres-integration`                                                        |
| Provider-attributed UsageSyncV1 for the existing Codex source path                       | Implemented (local, default-off)   | ADR 0071, `check:contracts`, `test:ingest:postgres-integration`                                                   |
| Direct Community token leaderboard and EN/RU token-first race                            | Implemented (local, default-off)   | ADR 0072, `test:web:coverage`, `test:web:postgres-integration`                                                    |
| Jobs runner: eighteen bounded maintenance capabilities                                   | Implemented (local)                | `test:jobs:coverage`, `test:jobs:postgres-integration`                                                            |
| Jobs scheduler: default-off UTC catalog, no-overlap, bounded lifecycle                   | Implemented (local)                | `test:jobs-scheduler:coverage` plus six scheduler integrations                                                    |
| Migration runner: default-off, digest-verified ledger, narrow login                      | Implemented (local)                | `test:migrate:coverage`, `test:migrate:postgres-integration`                                                      |
| Rust connector: handshake, reader, UsageSync signer, connect/sync commands               | Implemented (library, Windows dev) | ADR 0073, `cargo test --workspace`, `test:connector:windows-portable`                                             |
| Admin: invitation kernel and Access/membership verifier                                  | Implemented (local)                | `test:admin:coverage`, `test:admin:postgres-integration`                                                          |
| Operational runbooks: migration, restore, containment, deletion-failure                  | Implemented (static checks)        | `check:migration-runbook`, `check:restore-runbook`, `check:containment-runbook`, `check:deletion-failure-runbook` |
| Additional agent readers, optional MCP, and per-provider Verified tier                   | Proposed (ADR 0068)                | [ADR 0068](decisions/0068-multi-agent-token-leaderboard-and-mcp.md); plan Phases 6, 9, and 10                     |
| Thin client, hybrid onboarding, ownership lease, per-device keys, partitioned backfill   | Proposed (ADR 0069)                | [ADR 0069](decisions/0069-thin-client-and-low-friction-onboarding.md); plan Phase 6                               |
| Hosted deployment, production login/TLS, live edge route, released connector, real OAuth | Not implemented                    | See [Not implemented yet](#not-implemented-yet)                                                                   |
| Phase 0 public source: maintainer, CODEOWNERS, PVR, hosted controls                      | Pending                            | `check:publication` (intentionally failing)                                                                       |
| Phase 1 release evidence: provisioned browser, native screen-reader, field CWV           | Pending                            | See [Phase 1 still pending](#phase-1-still-pending)                                                               |

## Current phase

Phase 1 product code is locally complete, with the manual release-evidence items below still open.
The Phase 2 language-neutral contract and SQL persistence foundations now include database-only
passkey login, multi-passkey management, restricted recovery, Community usage ingest, bounded
retention cleanup for ingest, authentication, invitation, session, abandoned enrollment,
terminal-deletion-job, database audit-event, aged revoked-passkey state, and aged minimized
revoked-device/pairing state plus pairing approval-provenance redaction and fixed anonymous
pairing-rate-window reset, primary profile deletion, open-season scoring, terminal season
finalization, a public score-only database projection, a separate compatible active-CarRecipe race
projection, a third compatible rounded-freshness/optional-streak status projection, and a direct
token-total projection with their server-only projection-to-contract mappers; Phase 3 database-only
source/device lifecycle, same-source deduplication, and bounded pairing-retention cleanup have also
started. A server-only public problem-response factory, closed query/OpenAPI operations, and locally
implemented public score/race/status GETs now exist behind one exact default-off module-load gate.
The additive token GET has its own independent exact default-off module-load gate. A separate opt-in
synthetic integration applies the reviewed migrations to TLS-enabled disposable PostgreSQL, builds
the standalone Web artifact with the reviewed `pg` driver bundled, and starts two emitted Next
production processes on loopback. It rejects a deliberately widened Web login without changing any
private table, validates exact contracts plus TLS 1.2/1.3 through a narrow login, and proves the
successful reads are also non-mutating. It additionally proves the four-request no-queue boundary
through four observed blocked score queries, a rejected fifth request with no fifth public-score
query, and four successful responses after release. The narrow synthetic login also produces eight
parameter-payload-free bounded `auto_explain` adapter/projection oracles with exact reviewed-index,
no-mutation/locking, no-dirty/written-block, and no-temporary-I/O assertions; its server log is
bounded, private-marker scanned, discarded, and removed with the container. The visible home race
requests the current server-selected Community week from the same-origin token route first and falls
back to the legacy status route when that surface is unavailable, replaces only its race/leaderboard
after closed browser-side validation, uses an exact current approved recipe or repository-owned
absence fallback, shows only complete-UTC-day freshness and an optional preference-gated streak,
lets a handle select a same-page summary from those public fields, exposes that selection through a
canonical public-handle URL and public-account link, and retains a labeled synthetic fallback on
failure. The production home metadata and visible EN/RU copy now use the honest alternate search
phrase `vibecode rating`; one root canonical, origin-bound robots/sitemap discovery, and `noindex`
account/enrollment/recovery/pairing pages are locally covered by unit and standalone-runtime
evidence. This lets search crawlers discover a hosted origin but is not evidence of search-engine
indexing or ranking. The same public page now exposes a local-only EN/RU score simulator that
validates one hypothetical daily token total, applies the production daily and weekly scoring
functions for one to seven active days, and never requests, logs, stores, preloads, or submits that
value or changes a standing. Local identity slices now implement exact same-origin bounded forms,
GitHub OAuth state and S256 PKCE with no extra scope, purpose-separated encrypted HttpOnly
continuations, atomic profile/session creation, required initial WebAuthn registration, returning
discoverable-credential login, a session-scoped minimal passkey inventory, an active account page,
immediate public-profile hide/show, source inventory and pause, fresh-passkey paused-source
reactivation and terminal unlink, fresh backup-passkey addition, revocation of an owned non-current
passkey, a bounded active-device inventory with immediate owned-device revoke, fresh-passkey
recovery-code rotation with one-time display, an exact-handle fresh-passkey profile-deletion
request, one-time recovery-code replacement-passkey sign-in, and database-backed logout. Login
options retain the profile-free challenge only in a separate encrypted cookie; valid proof alone
reaches one atomic create-consume-session call. Its GitHub, passkey-verifier, database, and browser
evidence is injected or synthetic; no working invite issuer, OAuth registration, secret, live
authenticator/database login, distributed edge abuse control, deployed recovery/deletion cleanup
cadence, cache/backup/tombstone purge, restore replay, notification, or deployment is supplied. A
local one-shot Jobs runner invokes only the eighteen existing maintenance functions through a
bounded least-privileged adapter. One opt-in synthetic integration applies the reviewed migrations
to disposable PostgreSQL, runs every emitted Jobs command through a narrow login, rejects an
extra-membership login before mutation, and verifies exact stored state. A separate
exact-default-off local Jobs scheduler derives only fixed UTC five-minute/hour/day slots, invokes
that closed runner sequentially without overlap or same-slot retry, retains slot state only in
memory, and bounds first-signal shutdown. An opt-in synthetic integration composes the production
scheduler core under a fixed injected UTC clock/timer with the real Jobs runner and disposable
PostgreSQL, proving exact catalog order, full private-table non-mutation for a widened login, and
exact narrow-login stored state. A second advances that fixed clock by one hour, invokes the
production interval handler twice during the active real-runner cycle, proves exact recurring
catalog execution plus overlap and same-slot suppression, and verifies the rearmed terminal reset. A
third composes the production process lifecycle under that fixed clock, injects its first handler
during the penultimate database job, proves the active call settles and no later scheduler job
starts, and requires exact graceful interval/deadline/handler/runner cleanup plus exit code 0; only
afterward does the harness invoke the omitted reset for the shared exact-state oracle. A fourth
constructs a link-free production-only runtime from the built scheduler, built runner, and exact
installed dependency graph, mounts it read-only under a pinned Linux Node image, and starts the
built entry point under the real host clock. The harness temporarily revokes only the Jobs role's
exact backlog-function execution grant. The first process emits one generic cycle-failure line,
leaves the backlog unchanged, reaches the later terminal marker, and exits with code 0 after an OS
`SIGTERM`. The harness restores and verifies the grant, rearms the marker, holds the scoring mutex,
and starts the same runtime again. It observes the first finalization lock-wait, delivers `SIGKILL`,
requires exit 137 plus session release, and proves the backlog and marker remain unchanged. After
releasing the holder, a restart finalizes the backlog before a silent code-0 signal exit. It then
rearms the marker and installs a disposable post-insert barrier for a second backlog. The same
runtime reaches that barrier after its first daily projection insert; a second `SIGKILL` must
release the session and roll back the season plus all projection rows while retaining the source/day
input and marker. The harness removes the test trigger/function, verifies no schema residue, and a
clean-schema restart finalizes that backlog exactly once. A final rearm/restart proves another
silent repeated cycle, with session cleanup after all six starts, an unchanged runtime fingerprint,
and the same exact state. A fifth uses the same bounded runtime shape and leaves the native clock
and minute timer unchanged. After startup it holds the scoring mutex until refresh is active in a
later real five-minute slot, delivers an OS `SIGTERM`, releases the mutex, and proves refresh
settlement with a newer timestamp, silent code-0 exit, session release, and an unchanged runtime
fingerprint. A sixth holds the emitted first finalization call, delivers an OS `SIGTERM`, and proves
graceful settlement, no later job, silent code-0 exit, session release, and an unchanged runtime
fingerprint. The injected-timer result still does not prove host-timer delivery. The fourth gate
proves local failure/crash containment, later-job continuation, successful clean-schema retries, a
later repeated restart, four graceful post-startup `SIGTERM` settlements, two abrupt active-call
`SIGKILL` exits, and one controlled uncommitted post-insert PostgreSQL transaction rollback; the
fifth proves one local wall-clock recurring refresh plus active-call signal settlement. None proves
recovery from committed/external side effects or every Jobs capability, automatic privilege repair,
a deployed signal route, controller/orchestrator grace policy, managed restart, or durable/deployed
cadence. A separate exact-default-off one-shot migration runner now loads only the canonical
repository catalog, verifies closed manifest/file inventory plus every SHA-256 digest, creates one
maximum-one pool, and probes a distinct login that can set only the NOLOGIN owner group. Under one
fixed session advisory lock it sets the owner role, rereads an exact ledger prefix, applies only the
missing reviewed SQL bodies sequentially, requires the complete ledger, resets the role, and
releases the lock. Missing or malformed enablement fails before catalog, protected configuration, or
pool work; every failure destroys the client and process output is generic. Its evidence is 97
injected unit/policy tests at 99.34% statements, 98.59% branches, 100% functions, and 99.34% lines
plus strict build and built disabled-startup checks. A separate opt-in synthetic integration runs
one widened and two narrow emitted processes against one disposable hostname-verified TLS PostgreSQL
database. It denies the widened login before schema creation, observes both narrow controllers
behind one external holder, requires both to converge successfully after release, and verifies the
exact 43-row ledger, all 28 owner-owned forced-RLS private tables, identity invariants, and
connection/lock cleanup. It proves no production credential/TLS, staging orchestration/rollback,
deployed-replica behavior, monitoring, deployment, or recovery. A local Ingest kernel now bounds and
authenticates the exact Community sync envelope, consumes an injected origin nonce, parses bounded
JSON, validates the generated contract, and strictly verifies the source-bound device request. A
separate bounded Ingest PostgreSQL adapter revalidates that output and exposes only atomic
origin-nonce consumption, device lookup, and submission through a probed least-privileged pool. A
protected local reader supplies one mandatory and one optional rotation origin key directly to the
verifier without returning raw configuration. A forced-RLS replay tuple, Ingest-only atomic consume,
separate Jobs cleanup paths for ingest, pairing, authentication, invites, sessions, abandoned
enrollments, CarRecipe proposals, finalized source/day values, terminal deletion jobs, audit events,
aged revoked passkeys, and aged minimized revoked devices plus pairing approval-provenance redaction
and primary profile deletion now have real isolated PostgreSQL evidence. A transport-free Ingest
application now composes those exact verifier and database capabilities, generates a server-owned
request ID, waits for submission, and returns only a validated acknowledgement or generic problem
decision. A bounded local Fastify server factory now preserves exact raw HTTP evidence, admits four
application calls without a queue, applies fixed parser/header/connection/deadline policies, and
serializes only revalidated sync acknowledgement/problem contracts. A separate exact-default-off
local host composes that factory under closed listener and process-lifecycle policy. Its required
synthetic PostgreSQL gate now closes the imported emitted host after the full request/no-queue
matrix, starts the built entry point as a separate silent child, proves another accepted request,
and forcibly ends only that child. A separate pinned-Linux gate mounts the exact link-free emitted
production graph read-only, blocks one independently signed request at origin replay, delivers a
real `SIGTERM`, then proves exact acknowledgement/persistence settlement, silent code-0 exit,
session release, immutable runtime contents, and cleanup. Neither local result proves deployed
signal routing or Railway/orchestrator drain. A library-only Rust connector foundation now bounds
the stable App Server handshake and a candidate `0.144.5` account/usage parser, discarding
account/summary fields and returning only bounded normalized daily usage in caller memory. An
inaccessible one-shot supervisor composes those exact states through fixed local pipes, a fixed
child argument, no ambient environment, bounded stdout/stderr/time, terminal-event draining, and
reap-before-success cleanup. An inaccessible reviewed sync context now lets a candidate-only
composer consume those minimized entries into the exact bounded JSON body, SHA-256 digest, nonce
encoding, and device-signature message shared with the production Ingest verifier. An isolated
one-use signer removes public unsigned access, consumes that value only with an inaccessible
device-bound key capability, and returns the same body plus five exact signed header values. The
shared synthetic vector is strictly verified across Rust and Ingest. A second inaccessible signer
and pure Web verifier now agree on an exact synthetic pairing-possession proof. A transport-free
Web/Auth start application now generates fresh server identifiers, 32-byte poll/challenge material,
a 60-bit human code, separate protected poll/code verifiers, and a nine-minute pending transaction
from closed device metadata through one fixed call on the probed read-write Web pool. A second
activation application derives two fixed-shape HMAC poll-verifier candidates, selects at most one
approved row, runs that strict proof, and alone invokes exact atomic activation with server-owned
identifiers behind four-call admission and a 250-millisecond settlement floor. The authenticated
`/connect` flow supplies browser approval. Two closed local POST routes now compose both
applications behind one shared four-call admission boundary, versioned request/response validation,
generic problems, and revision 0022's fixed global-and-64-bucket distributed rate windows. Those two
connector routes and the two signed-in approval routes now each require exact
`VIBERACING_PAIRING_ENABLED=true` at module evaluation; the tracked default is false and disabled
POST reaches no parser, runtime/service, admission acquisition, protected configuration, or database
work after body cancellation. Independently, the `/connect` page and both browser approval modules
now resolve exact `VIBERACING_SOURCE_CREATION_ENABLED=true`; the tracked default is false. A
disabled decision omits new-source UI in EN/RU, retains active existing-source choices, and blocks
both initiation and completion of a new-source approval in the service. The encrypted five-minute
challenge and v2 context digest bind exact source choice so a restarted disabled verification module
also rejects an in-flight new-source challenge before passkey/database completion. Independently,
the account page, browser proposal create/approve modules, and source-bound device proposal module
resolve exact `VIBERACING_CAR_PROPOSALS_ENABLED=true`; the tracked default is false. Disabled
mutation stops before request/runtime/admission/proof/database work, the browser service repeats
literal-true checks, and EN/RU UI preserves active/private previews plus exact rejection while
omitting editor/approve. The two enrollment pages and four GitHub/initial-passkey route modules now
independently require exact `VIBERACING_ENROLLMENT_ENABLED=true`; the tracked default is false.
Disabled EN/RU pages omit both forms, HTTP stops before request/runtime/admission/private work, and
all four service methods repeat literal-true enforcement before OAuth/WebAuthn/database work while
returning login/recovery remain available.

A separate transport-free Admin invitation kernel now requires an exact injected
Access/individual-admin/fresh-passkey authorization, an acknowledged external `authorized` audit, a
second non-regressing clock check, one probed `viberacing_api.issue_invite` call under the bounded
Admin role, and an acknowledged external `committed` audit before returning one fixed seven-day beta
credential compatible with the Web parser. It withholds the credential and never retries on
ambiguous state. A local prerequisite now reads one protected exact team domain, audience,
one-or-two-key RS256 JWKS snapshot, and one-to-sixteen individual opaque member mappings; it
verifies only `Cf-Access-Jwt-Assertion`, rejects alternate algorithms/keys/issuers/audiences,
service tokens, email-shaped or unknown subjects, broad/expired assertions, and returns only a
redacted `invite_issue` actor identity. The combined 236 deterministic tests reach 98.9% statements,
98.89% lines, 97.8% branches, and 100% functions. Complete authorization and external audit remain
fixture-injected; the unit suite adds one OS-backed credential-shape check. A separate opt-in
synthetic integration applies the reviewed 43-migration ledger to disposable hostname-verified TLS
PostgreSQL, rejects an extra-membership login before any private mutation, and composes the built
production kernel through the narrow login to prove one exact active invite, one database audit row,
no non-target mutation, role reset, and connection cleanup. There is no Admin host, real Access
policy/token or protected key-refresh workflow, fresh-passkey verifier, complete authorization
composer, append-only backend, operational issuer, UI/API/CLI, protected production
login/certificate, monitoring, capacity evidence, or deployment.

A checked capability-containment and recovery rehearsal runbook now binds the six Web decisions and
the Ingest, Jobs-scheduler, and migration startup decisions to 24 ordered controls and eight exact
commands. It requires nine tracked false defaults, absent tracked migration enablement, exact source
admission at 21 Web module-load points, process replacement/settlement, independent containment,
preserved returning security/deletion paths, redacted evidence, and recovery of one capability at a
time. Twenty-five unsafe or drifted regression variants fail closed. This is static public
prerequisite evidence, not a private reporting channel, deployed control plane, dynamic kill switch,
monitoring backend, production containment, recovery, staging, or deployment.

A separate checked profile-deletion failure rehearsal runbook now binds the atomic Web request,
Jobs-only maximum-ten primary purge, separate 30-day terminal-job retention, fixed scheduler
catalog, and existing rollback/role/race evidence to 26 ordered controls and ten exact commands. It
preserves confirmed request lock-down, separates request/purge/retention/restore state, requires
protected aggregate diagnosis, allows only one reviewed deployment-owned retry, and rejects any
claim that unused `running`/`retry_wait`/lease fields create automatic retry. Twenty-five unsafe or
drifted variants fail closed. This is static public prerequisite evidence, not a deployed alert,
retry controller, notification path, cache/backup purge, stale-backup replay, real-user deletion
result, recovery, staging, or deployment.

A bounded Rust `connect` command generates a key and client rate ID with the OS CSPRNG, persists
resumable state only in a native credential store, and performs the exact start/proof/poll sequence.
A separate Windows x86_64 `sync` command now checks an active record before either bounded
fixed-name `PATH` discovery or explicit-path admission of the exact `0.144.5` artifact, holds its
file against write substitution through launch, uses a fresh empty working directory and the
existing bounded supervisor, creates fresh context from the active native record, and sends one
exact signed body to the fixed endpoint without retry or edge-origin headers. Its loopback HTTP
evidence validates only the five device headers and closed acknowledgement. A separate explicit
`check-codex` command performs only the identical bounded exact candidate admission without an
origin, credential-store access, Codex process, account read, persistence, or network; its fixed
point-in-time result explicitly preserves the empty support matrix, and `sync` does not reuse it.
Its opt-in diagnostic preview emits only compile-time connector/candidate versions, the fixed
platform contract, a closed admission class, and that empty support state. It retains a failed exit,
omits local/account data, and gives the connector no file or sharing capability. A separate exact
`forget-local` command derives the same native-store account from a canonical origin and bounded
label, invokes only idempotent credential deletion, and emits one fixed warning that server device
authority was not revoked. It does not load the record, construct a signer, start Codex, or make a
network call. No live database connection, real-account end-to-end result, released artifact, or
deployment is claimed. Candidate release, schema, fixture, synthetic-process, admission, composer,
pairing, signer, and loopback-upload evidence does not populate the support matrix. Phase 0
hosted-publication controls remain blocked on real maintainer identities and GitHub configuration.
No production-ready anonymous edge perimeter, distributed recovery perimeter or cleanup, production
secret-manager/edge key injection, trusted external Ingest TLS/edge route, production deployment,
production Web/Jobs/Ingest database login/TLS integration, released or operational connector,
supported Codex version, real-user ingestion, end-to-end public ranking, or deployed Jobs
scheduler/cadence exists.

## Implemented and locally verified

- Public-safe project, security, contribution, and agent guidance.
- Apache-2.0 source license.
- Local checks for relative Markdown links and duplicate heading anchors.
- Local checks for common credentials, private-key files, personal email addresses, non-reserved
  public IPv4 addresses, local user-home paths, and printable metadata inside binary files.
- Black-box regression cases for safe examples, secret-shaped values, personal email, local paths,
  environment files, and staged-snapshot isolation.
- Black-box documentation cases for valid links, missing files and anchors, duplicate anchors, and
  attempts to escape the repository root.
- A manifest-derived documentation-currentness gate binds EN/RU root onboarding to the exact
  contract schema/policy/operation/path and migration inventories, requires quick start within the
  first 40 lines, caps each root README at 220 lines, and requires an architecture thumbnail. Seven
  mutation cases fail on inventory, length, ordering, or diagram drift.
- Tracked symbolic links are rejected before repository checks can follow them.
- A complete-reachable-history gate that refuses shallow clones; structurally validates one
  non-placeholder Author and Committer identity plus one exact author-matching final DCO sign-off;
  and scans refs, ordinary commit-message text, every historical path/blob, forbidden modes,
  oversize objects, and printable binary metadata. Eleven black-box cases include missing,
  duplicate, mismatched, and placeholder DCO/identity state plus deleted-history and
  unreachable-object scope.
- The 67 pre-policy bootstrap commits now use the owner-confirmed public Git identity for Author,
  Committer, and one exact matching DCO sign-off. The reviewed rewrite preserved every tree, parent,
  author/committer date, subject/body, and the non-commit Codex capture ref; no remote was
  configured during the rewrite.
- Pinned Node, pnpm, and Rust toolchains with committed pnpm and Cargo lockfiles.
- A pnpm workspace with release quarantine, trust and source policy, exact external direct
  dependencies in every bounded workspace, `workspace:*` internal references, private workspace
  manifests, and install-script denial by default.
- Prettier, Markdownlint, CSpell 10.0.1, YAML/configuration policy, and Rust formatting, check,
  test, and Clippy workspace gates.
- An offline external-link gate with 12 reviewed hosts, HTTPS/credential/port/query/address rules,
  no dormant host permissions, and eight black-box cases. A separate online mode pins public DNS
  results, sends no credentials, follows no redirects, and is excluded from deterministic PR CI.
- A deterministic dependency inventory covering 523 locked npm packages, 209 Cargo packages, two
  pinned GitHub Actions, and one pinned local-development container. License expressions, installed
  manifests, every root/workspace importer, dependency scopes, direct notices, and external-artifact
  usage are checked with ten black-box cases.
- Positive and negative workflow-policy tests for action pins, permissions, secrets, shell
  interpolation, timeouts, complete-history checkout, checkout credentials, forbidden triggers, and
  the exact no-upload Windows portable-connector job surface.
- A secretless, read-only GitHub Actions CI definition and bounded weekly Dependabot configuration.
  Pull requests run the bounded Node development gate plus the separate Rust and database jobs.
  Main/manual runs additionally fetch the exact Cargo graph for license metadata, run exhaustive
  Node/repository evidence and the eleven declared service integrations, and enable the separate
  `windows-2025` portable-smoke job. That job scans first, installs pinned minimal Rust, builds the
  locked connector release profile, and runs only the bounded portable copy/removal smoke. Its
  policy permits no artifact upload, package publication, credential operation, signing, or release
  environment. These are checked workflow declarations; no hosted run is claimed from the local
  tree.
- A loopback-only disposable PostgreSQL Compose service plus an opt-in portless `tmpfs` integration
  service, both pinned to the same version and index digest.
- Cross-platform bounded development gate (`pnpm run verify`) plus an explicit exhaustive
  release/publication gate (`pnpm run verify:release`).
- Governance, maintainer, conduct, DCO, support, roadmap, changelog, release, trademark, and
  third-party notice policies.
- Structured bug, feature, documentation, and pull-request forms that warn against sensitive data
  and do not request contact details, raw logs, screenshots, or account identifiers.
- Community-health policy validation and black-box regression cases for missing policies, invalid
  issue forms, automatic assignment, unresolved ownership, modified DCO text, and missing privacy
  warnings.
- A fail-closed publication-readiness checker with regression coverage for GitHub remote,
  MAINTAINERS/CODEOWNERS agreement, protected policy ownership, verified source-only interaction
  restrictions or open-participation conduct reporting, and private vulnerability reporting state.
- A repository-owned public source-only GitHub publication runbook separates local
  history/public-data evidence from real hosted maintainer, CODEOWNERS, interaction restrictions,
  branch-ruleset, reporting, Actions-log, and visibility controls.
- A repository-scoped design threat model with assets, attacker capabilities, trust boundaries,
  realistic/out-of-scope stories, required mitigations, implemented-versus-planned status, and
  severity calibration.
- Twenty-one structured abuse cases covering identity/source/scoring, pairing/device/connector,
  web/privacy/content, edge/database/admin/supply-chain, deletion, and resource exhaustion.
- A privacy classification and field inventory with prohibited data, provider boundaries, user
  controls, logging rules, retention decisions, deletion, restore, and launch review gates.
- Planned system/container and enrollment, login/recovery, pairing, sync, public-read, deletion, and
  trusted-release Mermaid views.
- A fail-closed Codex compatibility policy and empty support matrix; no upstream or connector
  version is claimed supported without pinned schema/fixture/process/platform/release evidence. A
  candidate `0.144.5` manifest records the official release tag, immutable commit and artifact
  metadata, full stable-bundle and client-request digests, three minimal source/checked-in schema
  extracts, nine synthetic JSONL fixtures, generated hostile cases, and three explicit blockers. A
  canonical/digest/path/method/fixture/matrix checker has fourteen black-box regression cases and
  prevents candidates from becoming supported rows.
- A library-only Rust connector protocol and candidate-adapter foundation. It emits one compile-time
  fixed `initialize` request with no capabilities, accepts only one LF-terminated frame up to 16
  KiB, manually rejects duplicate/unknown envelope and result fields, validates and discards the
  four bounded stable initialization strings, and emits `initialized` only after a matching ID `0`
  response. Hostile remote input permanently fails the instance and errors never reflect it. Seven
  integration tests cover exact bytes, state order, framing/UTF-8/size, envelope/result shape,
  duplicates, unknowns, string/path bounds, safe Unicode, and non-reflection. Only after that
  handshake, the candidate exact-version state machine emits fixed `account/read` ID `1` with
  refresh disabled and `account/usage/read` ID `2` with null parameters. It accepts only complete
  ChatGPT mode, validates then discards email/plan/summary fields, and returns at most 31 sorted
  unique real `20xx` dates with integers through the sync-safe maximum. Ten further integration
  tests use every checked-in fixture and generated duplicate/UTF-8/frame/ID/count/date/integer
  cases, prove terminal remote failure, and keep diagnostics to entry count. A one-shot supervisor
  then writes only those fixed messages to a child started with one `app-server` argument and a
  capability-owned working directory/environment. It clears ambient variables, admits only three 16
  KiB stdout frames, permits 8 KiB discard-only stderr and fails on the next byte, applies 10-second
  response and 45-second lifetime limits, detects terminal output after the usage response, and
  returns data only after the child is reaped. Nine unit cases launch only a target-built Rust
  fixture and cover exact composition, environment filtering, timeout, early exit, stdout/stderr
  overload before and after the final response, non-reflection, missing executable, nonzero terminal
  status, and forced cleanup. The opaque launch capability has no public constructor. The private
  Windows x86_64 sync command can construct it only after the active record is validated and either
  bounded fixed-name `PATH` discovery or an explicit canonical path matches the exact candidate
  artifact size and SHA-256 while a no-write-sharing handle remains open. Discovery examines at most
  64 absolute directories and four distinct exact-size files under fixed path budgets. There is no
  macOS/Linux admission, clean-machine real-account result, supported Codex version, installer, or
  released binary. A separate `check-codex` command reuses only that selector, releases the admitted
  handle, and emits the exact candidate version plus an explicit unsupported statement. It accepts
  no origin/label, opens no credential store, starts no child, reads no account, persists nothing,
  and uses no network. One explicit preview mode adds only a fixed local version/admission/support
  summary; unit and target-built process cases prove both success and closed failure classes, exact
  bytes, nonzero failed admission, redaction, cleared-environment execution, no candidate creation,
  and unwritable-output behavior. `sync` still validates the active record and repeats admission
  independently. A candidate pairing signer now consumes inaccessible pending-key/challenge
  capabilities and signs one exact domain-separated transaction/challenge/public-key message. A
  server-only Web kernel independently validates exact approved material and the canonical signature
  under strict Ed25519 semantics. Five Rust and seven Web cases share the same synthetic key/vector,
  reject changed or malformed inputs and zero material, and prove copy-before-await behavior. There
  is now a protected primary/secondary poll-token verifier plus closed local start and activation
  database/application compositions. The signed-in `/connect` path supplies WebAuthn approval, and
  the versioned HTTP routes plus native-store Rust client complete a local pairing path. There is
  still no live database login, deployed edge, cross-platform result, or released connector. A
  separate candidate-only composer consumes the real parser output behind another capability with no
  public constructor. It revalidates source/sync/device IDs, canonical UTC time, and daily bounds;
  manually emits the exact seven-field `UsageSyncV1` body for `/v1/community/usage`; computes the
  SHA-256 digest; and builds the exact unpadded base64url, LF-separated device message. An isolated
  one-use signer consumes that otherwise inaccessible value with a device-bound Ed25519 key
  capability, rejects an exact device mismatch, signs only the fixed message, and returns the same
  body plus five header values. Nine Rust sync cases plus one production-path Ingest case share and
  strictly verify an exact synthetic body, public-key, and signature vector. Prepared/signed private
  byte buffers and the upstream key are zeroed on drop. The one-shot sync command now constructs
  those private capabilities only from an active record, fresh OS-random sync ID/nonce, and
  canonical `20xx` millisecond UTC. It performs one no-proxy, no-redirect fixed-path POST and
  validates a bounded request-ID/sync-ID-matched acknowledgement; five focused cases cover time,
  binding, exact HTTP egress, excess accepted-count rejection, and refusal before connection. The
  pairing command supplies fresh OS entropy, a bounded local clock/retry policy, native key custody,
  and exact pairing transport. The separate sync command supplies only the local candidate context
  and one upload; no schedule, deployed egress, packaging, release, or support claim exists, and the
  compatibility matrix remains empty. A third fixed `propose-car` command starts no Codex process:
  it accepts only explicit recipe enums and a canonical bounded seed, loads the active native device
  key, creates a fresh nonce/time, signs the proposal-specific exact body message, sends one
  no-retry fixed-path POST, and validates only a generic acknowledgement. Four Rust proposal cases
  share the exact body/message/key/signature vector with Web. A self-contained repository Agent
  Skill now reduces an existing styling request to only those exact enums and seed, requires
  explicit shell-safe origin/label values, invokes the fixed command once, and recognizes only its
  exact generic success line. A second self-contained repository skill reads the governing
  instructions and real Git scope, selects only the reviewed focused/root/staged/history
  verification gates, and separates synthetic/local evidence from live or deployment claims without
  gaining mutation, installation, network, publication, push, or deployment authority. One dedicated
  checker derives proposal schema/CLI expectations and the verification script/runtime policy from
  production sources. Twenty-five combined mutation cases prove enum, shell, invocation-allowlist,
  retry, authority, output, front matter, UI metadata, command, Git-scope, runtime, public-output,
  and evidence-claim drift fail closed. No released connector, live endpoint, edge policy, or
  deployment is claimed.
- An ADR lifecycle/template and seventy-three accepted design decisions covering Community trust,
  multi-source aggregation, identity/device authority, restricted recovery, edge/service/database
  isolation, CarRecipe, public repository safety, season finalization, and the public score
  projection/response/adapter, common HTTP problem boundaries, and the locally implemented public
  score operation, bounded maintenance runner, bounded Community sync verification kernel,
  least-privileged Ingest PostgreSQL adapter, protected origin-proof key configuration, persistent
  atomic origin replay, transport-free Community sync application composition, and the bounded local
  Fastify HTTP boundary, plus the fail-closed Codex handshake, candidate account/usage adapter, and
  inaccessible bounded one-shot process supervisor, exact-body sync composer, isolated one-use
  device signing boundary, bounded pairing-possession proof, bounded pairing activation/start
  compositions, bounded pairing cleanup, bounded connector pairing transport/native key custody,
  one-shot candidate Community sync, bounded authentication and invite cleanup, the local
  Railway-shaped Ingest host, bounded primary deletion purge, the session-owned CarRecipe proposal
  boundary, and bounded CarRecipe-proposal cleanup, public active-recipe projection, bounded device
  proposal ingress, bounded local agent proposal orchestration, bounded public race-status
  projection, bounded local credential removal, expired-session and invite retention, bounded
  repository verification orchestration, terminal deletion-job retention, and database audit-event
  retention, pairing approval-provenance retention, revoked-passkey retention cleanup, plus
  revoked-device retention cleanup, bounded pairing-rate-window reset, bounded abandoned-enrollment
  cleanup, bounded candidate executable discovery, the bounded candidate artifact diagnostic, the
  Windows portable connector lifecycle smoke, the redacted Codex diagnostic preview, the local
  Ingest startup latch, and the local public-ranking, pairing-route, new-source-creation,
  CarRecipe-proposal, and enrollment gates.
- Architecture-contract validation and black-box regression cases for missing threat sections,
  duplicate/incomplete abuse cases, privacy-class drift, invalid/orphaned ADRs, unclosed Mermaid
  fences, and accidental compatibility claims.
- Agent-skill validation and 25 black-box regressions across the proposal and verification skills
  for schema/CLI drift, command or authority widening, contradictory invocation input, unsafe shell
  input, retry permission, stale success output, Git-scope/runtime/public-output/evidence drift,
  front-matter widening, and UI metadata.
- Fourteen canonical JSON Schema 2020-12 contracts for bounded Community Usage Sync, connector
  pairing start/poll, and device CarRecipe proposal requests and responses; stable problem details;
  a one-field public score season query; response-only score, race, race-status, and direct-token
  pages; plus the exact nine-field `CarRecipeV1`. Every object is closed; scalar and collection
  values are bounded; the recipe accepts only project-owned enums and a 0-to-65535 seed; reviewed
  date-range/ISO-weekday extensions make the score calendar executable; connector input has an
  executable writable-field allowlist that excludes identity, trust, rank, score, season,
  moderation, credentials, and prohibited data.
- Deterministically generated readonly TypeScript types, embedded validator wrappers, source digest,
  and an OpenAPI 3.1 document with eight explicitly `implemented-local` Community
  score/race/status/token/usage, device CarRecipe proposal, and connector pairing start/poll
  operations. Their exact method-specific query/body, response/problem, admission,
  authentication-reference, `no-store`, `Vary: Accept`, generated request ID, and same-origin CORS
  policies are manifest-driven without claiming deployment. All four inventoried
  authentication/transport policies participate in the generated source digest. A
  manifest/schema/drift checker has 62 black-box cases covering generated operation/status/evidence
  semantics, unsafe/duplicate/drifted operations, unknown fields, missing bounds, client-derived
  score aliases, Community trust/problem/date drift, private response fields,
  unlisted/path-traversing schemas, unsupported keywords, missing date deduplication, and stale
  generated output.
- A dependency-free runtime contract validator with fail-closed reflection handling; strict
  calendar/range/ISO-weekday/UTC timestamp and safe-integer checks; depth, node, key, item, and
  issue budgets; and privacy-safe issue output that never echoes unknown property names or submitted
  values. Thirty-five unit/security cases cover valid/invalid query boundaries, hostile structures,
  response trust/privacy, connector input, and validator resource limits at 100% statement, line,
  and function coverage plus 97.22% branch coverage.
- A pure local Community sync verifier over a closed copied raw request envelope. It admits only
  exact `POST /v1/community/usage` JSON with bounded raw bytes and header pairs, rejects duplicate
  required headers, authenticates a body-bound HMAC-SHA-256 origin proof before parser or device
  work, applies a one-time injected origin-nonce capability, parses strict UTF-8 JSON under explicit
  depth/node/fanout/string/number budgets with decoded duplicate-key rejection, and validates
  `UsageSyncV1`. It binds the device timestamp and idempotency header to the body, accepts only
  minimal source-bound device material, verifies the exact-body Ed25519 request with strict RFC
  8032/FIPS semantics, and returns one frozen database-ready allowlist. One hundred seventeen
  adversarial tests cover policy drift, grammar/encoding/bounds, proxy/accessor/sparse/shared-buffer
  input, mutation after call, origin rotation/time/tamper/replay/dependency order, contract and
  source binding, malformed/unknown device material, backend failure, and the native
  zero-key/zero-signature bypass at 100% statement/branch/function/line coverage. The kernel itself
  has no HTTP listener, public response, log sink, rate limit, socket deadline,
  admission/backpressure, connector, live integration, or deployment.
- A protected origin-proof configuration boundary. It reads exactly one mandatory primary ID/key
  pair and at most one complete secondary rotation pair from four namespaced process values. IDs use
  the versioned `edge_` grammar; keys are canonical unpadded base64url for exactly 32 bytes; and
  both IDs and key material must differ. The config-backed factory accepts only exact nonce, clock,
  and device-lookup dependencies, constructs the verifier internally, exposes no reusable key
  container, overwrites temporary decoded buffers, and emits only generic bounded configuration
  errors. Twenty-eight adversarial config/dependency/proof-path cases remain in the 441-test Ingest
  suite at 100% statement/branch/function/line coverage. Synthetic environment values prove no
  secret-manager binding, deployed signer, real rotation, or deployment.
- A bounded local Ingest PostgreSQL configuration/pool/adapter boundary. It accepts only six
  namespaced fields, permits cleartext solely on explicit loopback development/test, otherwise
  requires certificate-verified TLS, hides its password from enumeration/JSON, and caps one process
  at four clients with 2/6/31/32-second checkout/lock/server/client deadlines. Every checkout probes
  the exact Ingest role, distinct non-privileged login scope, database CONNECT without
  CREATE/TEMPORARY, sole role membership, and safe search path. The adapter exposes no general
  query: it maps an exact origin key ID/digest/expiry to one boolean consume row, a canonical device
  ID to zero/one strict verification row, and a reconstructed, contract-revalidated verifier
  allowlist to the fixed 13-parameter submission procedure. It copies bytes/arrays, generates a
  server UUID, validates coherent accepted/duplicate/quarantined output, destroys failed clients,
  and emits only bounded internal errors. One hundred eighteen
  configuration/pool/mapper/import-isolation cases remain in the current 441-test Ingest suite at
  100% statement/branch/function/line coverage. Focused tests use mock pools; the separate opt-in
  integration exercises the same adapter through a synthetic dedicated loopback login. No deployment
  credential, certificate/TLS result, or production connection is claimed.
- A persistent origin replay database boundary. Revision 0012 stores only the closed key ID,
  domain-separated 32-byte digest, and millisecond expiry behind forced RLS. The Ingest-only
  function atomically inserts or replaces an expired tuple, returns `false` for an unexpired replay,
  and deletes its own row if expiry elapses while blocked. Jobs cleanup independently caps origin
  nonces, device nonces, and snapshots at the requested 1-to-1000 batch. Static scenarios and three
  observed PostgreSQL races prove exact one-time consumption, live-row preservation, cleanup
  serialization, role isolation, and database deadlines. Expiry does not schedule physical purge;
  deployed scheduling, monitoring, backup handling, and capacity remain open.
- A bounded pairing-retention database boundary. Revision 0013 extends the partial expiry index to
  cancelled state and gives only Jobs a separate 1-to-1000 oldest-first deletion under a private
  mutex, five-second lock wait, and 30-second statement deadline. It selects only expired pending,
  approved, or cancelled transactions whose exact key remains pending and unbound, cascades
  pairing-bound approval challenges, deletes the transaction before its key, and rolls back on any
  changed-row mismatch. Live pending and activated rows, bound devices, sources, profiles,
  credentials, and audit events remain. Static scenarios and an observed two-worker race prove
  bounds, idempotency, role isolation, serialization, and live/activated preservation. The combined
  synthetic scheduler integration exercises this capability; no production Jobs login/TLS path,
  deployed cadence, backup proof, capacity result, or broader ceremony cleanup is claimed.
- A bounded authentication-retention database boundary. Revision 0023 gives only Jobs one 1-to-1000
  cleanup under a separate private mutex and independently caps expired challenge and
  restricted-recovery-authority deletion. It removes an authority's source recovery code only when
  that exact row remains used with its verifier already scrubbed; live challenges/authorities,
  unused codes, sessions, passkeys, profiles, and audit evidence remain. Candidate profiles are
  locked in stable order before authority/code rows, matching recovery and deletion transitions.
  Static scenarios, an observed two-worker race, and an observed cleanup-versus-recovery-start race
  prove bounds, role isolation, live-state preservation, worker serialization, and the
  cross-capability lock order. The combined synthetic scheduler integration exercises this
  capability; no production Jobs login/TLS path, deployed cadence, backup proof, capacity result, or
  deployed retention policy is claimed.
- A bounded invite-retention database boundary. Revision 0031 gives only Jobs one 1-to-1000
  oldest-first cleanup under the shared authentication mutex. It selects only expired active or
  revoked invites, locks candidates with `SKIP LOCKED`, repeats state and expiry at deletion, and
  never selects live authority or redeemed enrollment provenance. Static scenarios and an observed
  two-worker race prove bounds, deterministic progress, role isolation, idempotency, shared-mutex
  serialization, and live/redeemed preservation. The combined synthetic scheduler integration
  exercises this capability; no invite issuer UI, production Jobs login/TLS path, backup purge,
  capacity, or deployed retention policy is claimed.
- A bounded expired-session retention database boundary. Revision 0030 gives only Jobs one 1-to-1000
  oldest-first cleanup under the existing private authentication mutex. It selects only expired
  sessions with no retained rotation predecessor and no pairing approval reference, locks one
  candidate with `SKIP LOCKED`, repeats every predicate at deletion, and re-evaluates after each row
  so an expired rotation chain can progress within one batch. Session-bound challenges cascade; live
  sessions and pairing-referenced sessions remain until a separate aged-provenance redaction. Static
  scenarios and an observed two-worker race prove active/revoked/rotated deletion, bounds, role
  isolation, idempotency, rotation-chain progress, shared-mutex serialization, and live/provenance
  preservation. The combined synthetic scheduler integration proves provenance redaction precedes
  this cleanup so a newly unreferenced expired session can be deleted in the same cycle; no
  production Jobs login/TLS path, complete device-history policy, backup purge, capacity, or
  deployment is claimed.
- A bounded pairing approval-provenance retention boundary. Revision 0034 gives only Jobs one
  1-to-1000 oldest-first redaction under the existing authentication and pairing mutexes in their
  profile-purge order. PostgreSQL derives a fixed 180-day cutoff after both locks; only activated
  rows with both exact approval references are candidates, and every state/cutoff/reference
  predicate is repeated at update. The trigger permits only simultaneous session/passkey redaction
  while every profile/source/device and approval/activation binding stays immutable. Static
  scenarios and an observed two-worker race prove exact-boundary/recent preservation, partial and
  pre-activation rejection, role isolation, invalid bounds, both missing-mutex failures, preserved
  pairing/device/passkey rows, and subsequent expired-session cleanup progress. This redaction does
  not itself delete device history; revision 0036 separately handles only an aged minimized pair.
  The combined synthetic scheduler integration proves this redaction runs before dependent session,
  passkey, and device cleanup; no production Jobs login/TLS path, backup purge, monitoring,
  capacity, or deployed retention evidence is claimed.
- A bounded revoked-passkey retention boundary. Revision 0035 gives only Jobs one 1-to-1000
  oldest-first deletion under the same authentication and pairing mutex order. PostgreSQL derives a
  fixed 180-day cutoff after both locks and selects only revoked rows with no
  authenticating-session, verifying-challenge, authorized-challenge, or pairing reference; every
  predicate is repeated at deletion and restrictive foreign keys remain fail-closed. Static
  scenarios and an observed two-worker race prove exact-boundary/recent/active/reference
  preservation, deterministic progress, role isolation, invalid bounds, both missing-mutex failures,
  and idempotency. Recovery evidence first fails atomically at the unchanged 32-row ceiling, deletes
  31 eligible old rows, then completes through the unchanged replacement-passkey contract. The
  combined synthetic scheduler integration exercises this capability after provenance and session
  cleanup; no production Jobs login/TLS path, backup purge, monitoring, capacity, or deployed
  retention evidence is claimed.
- A bounded revoked-device retention boundary. Revision 0036 gives only Jobs one 1-to-1000
  oldest-first paired deletion under the existing Ingest and pairing mutex order. PostgreSQL derives
  one fixed 180-day cutoff after both locks and selects only an activated pairing plus its exact
  revoked device when both timestamps qualify, approval provenance is already null, and no
  authorization challenge, device nonce, or raw usage snapshot references either row. It locks both
  candidates, deletes the pairing before the key, repeats every predicate, and requires exactly one
  row at both steps so any drift rolls back the pair. Static scenarios and an observed two-worker
  race prove exact-boundary/recent/active/reference preservation, deterministic progress, role
  isolation, invalid bounds, both missing-mutex failures, idempotency, and atomic rollback. The
  combined synthetic scheduler integration exercises this capability after provenance, session, and
  passkey cleanup; no production Jobs login/TLS path, backup purge, monitoring, capacity, or
  deployed retention evidence is claimed.
- A bounded anonymous pairing rate-window retention boundary. Revision 0037 gives only Jobs one
  zero-argument reset over the existing fixed 130-row operation/global/bucket matrix. PostgreSQL
  verifies the complete inventory, derives a fixed one-hour cutoff from server time, and locks only
  positive expired rows in operation/global/bucket order before replacing the timestamp/count with
  the exact epoch/zero state. Recent rows and the fixed matrix remain; Web admission retains its
  separate global-before-bucket function. Static scenarios prove the closed row shape, cutoff,
  recent preservation, idempotency, missing-inventory failure, role isolation, continued admission,
  and rollback after later-row failure. Observed worker/worker and reset/admission races prove
  convergence and that a newly admitted count survives reset. This is aggregate shaping for a
  self-asserted ID, not trusted edge identity. The combined synthetic scheduler integration
  exercises this capability; no production Jobs login/TLS path, monitoring, capacity, edge control,
  or deployed retention evidence is claimed.
- A bounded abandoned-enrollment retention boundary. Revision 0038 gives only Jobs one 1-to-1000
  oldest-first deletion after the existing authentication and profile-purge mutexes. A candidate
  must remain `enrolling`, retain its exact redeemed invite, have only expired exact enrollment
  sessions and registration challenges, and have no other recovery, passkey, source, deletion,
  scoring, or recipe state. Every predicate is repeated after the profile lock; an in-flight
  initial-passkey activation already holding that row is skipped without cleanup waiting. Existing
  cascades remove the redeemed invite and expired private enrollment authority, while audit rows
  remain with null profile linkage. Static scenarios, an observed two-worker race, and an
  activation-overlap race prove bounds, role isolation, deterministic progress, comprehensive
  fail-closed drift preservation, and live authority safety. The combined synthetic scheduler
  integration exercises this capability; no invite repair/reuse, deletion job, tombstone,
  notification, production Jobs login/TLS path, monitoring, capacity, backup purge, restore replay,
  or deployed retention evidence is claimed.
- A bounded primary profile deletion database boundary. Revision 0024 gives only Jobs one maximum-10
  due queue/retry purge under stable acquisition of its five fixed maintenance mutexes. It requires
  committed `deletion_pending` state, removes every restrictive profile-bound pairing and only its
  still-authority-free pending key first, marks the exact opaque job terminal, then cascades the
  profile's invite, sessions, passkeys, recovery state, sources, devices, usage, and personal score
  rows in the same transaction. Audit and job profile links are nulled; the opaque terminal job
  remains and no unkeyed tombstone is invented. End-to-end request/purge, batch, retry/future,
  state-drift rollback, role-denial, idempotency, two-worker, and purge-versus-auth-cleanup
  scenarios pass in real isolated PostgreSQL. The combined synthetic scheduler integration exercises
  this capability; no production Jobs login/TLS path, published deletion window, cache/backup purge,
  keyed tombstone, restore replay, monitoring, capacity result, or deployment is claimed.
- A bounded terminal deletion-job retention boundary. Revision 0032 gives only Jobs one 1-to-1000
  oldest-first cleanup under the profile-deletion mutex. PostgreSQL derives a fixed 30-day cutoff
  after locking; only `purged`, profile-free jobs with non-null completion at or before that cutoff
  are candidates, and every predicate is repeated at delete. Static scenarios and an observed
  two-worker race prove recent/non-terminal preservation and exact progress. The combined synthetic
  scheduler integration exercises this capability; no production Jobs login/TLS path, cache/backup
  purge, tombstone/restore replay, monitoring, capacity result, or deployed retention evidence is
  claimed.
- A bounded database audit-event retention boundary. Revision 0033 gives only Jobs one 1-to-1000
  oldest-first cleanup under a separate private mutex. PostgreSQL derives a fixed 180-day cutoff
  after locking; profile-linked and already-redacted rows at or before that cutoff are candidates,
  and the predicate is repeated at delete. Static scenarios and an observed two-worker race prove
  linked/redacted eligibility, recent-event preservation, exact progress, role isolation, invalid
  bounds, missing-mutex failure, and idempotency. The combined synthetic scheduler integration
  exercises this capability; no external append-only audit sink, user-visible audit subset,
  production Jobs login/TLS path, backup purge, monitoring, capacity result, or deployed retention
  evidence is claimed.
- A transport-free Community sync application boundary. Its configured factory creates one bounded
  Ingest database object, injects that same object's atomic origin consume and minimal device lookup
  into the protected-key verifier, binds its submission capability, closes the pool after startup
  failure, and exposes only `execute` plus `close`. Each execution creates one server-owned 128-bit
  request ID before verification, requires the frozen verifier allowlist, waits for database
  settlement, reconstructs coherent accepted/duplicate/quarantined output, and validates either a
  frozen null-prototype `UsageSyncResultV1` or the closed generic `ProblemDetailsV1` subset.
  Origin/device rejection is one unauthorized result; dependency outages are generic retryable 503;
  internal drift and unknown failures are non-reflective 500. Adversarial and composition cases are
  included in the current 441-test Ingest suite. Signed synthetic requests pass through the actual
  production verifier, replay and device capabilities, adapter mapper, and submission order using a
  mock pool. No HTTP object, serialization/header policy, or socket belongs to this application
  layer; the separate opt-in integration composes it through the host and disposable PostgreSQL. No
  log sink, deployment login/certificate, edge path, connector, or deployment is claimed.
- A bounded local Community sync Fastify server factory. Only one reviewed Ingest module may import
  the exact-pinned framework. It registers exact `POST /v1/community/usage` only after a boolean
  host decision; the removed `/v1/community/sync` path returns 404 before application or storage
  work. The sole route has one four-call no-queue admission budget. It copies at most 8192 raw body
  bytes and the original raw-header sequence, disables proxy trust, inbound request IDs, and
  framework logging, and admits four unsettled application calls without a queue. Explicit 16384
  header-byte, 64 raw-header-pair, 32-connection, 16-request-per-socket, and 5/33/34-second request/
  handler/connection policies bound one process. Closed content/`Accept`/route/method handling,
  generic 400/404/405/406/500/503 transport problems, `no-store`, `Vary: Accept`, `nosniff`, no CORS
  grant, CSPRNG request IDs, and final generated-contract validation prevent request or framework
  reflection. Adversarial injection and real-loopback framing/drain cases bring the current Ingest
  suite to 441 tests, plus strict lint, type checking, and production build. The handler limit is
  bound and classified but is not a production capacity result. This factory still owns no listener
  or process lifecycle. The separate local Worker supplies a compatible signer, but no deployed
  direct-origin denial, trusted route, external TLS evidence, deployment database credential,
  monitoring, connector, load evidence, or deployment is claimed.
- A separate local Ingest host workspace that owns only closed listener configuration, one bind,
  startup composition, and process shutdown. Exact `VIBERACING_INGEST_ENABLED=true` is required
  before any other host field or protected application configuration is inspected; missing or any
  alternate value fails with the existing generic silent startup behavior. The frozen validated
  config also carries literal `enabled: true`, while tracked `.env.example` remains false.
  Separately, only exact own enumerable string `VIBERACING_USAGE_SYNC_ENABLED=true` registers the
  sole Usage Sync route before application construction; every other shape leaves it absent. This is
  fail-closed containment, not a migration switch. Development/test then admits cleartext only on
  exact IPv4 or IPv6 loopback; production requires exact `0.0.0.0:$PORT`, the explicit
  `railway-edge` external-TLS declaration, and a canonical 40-to-300-second Railway drain window. It
  composes only the reviewed configured application and Fastify factories, closes every completed
  lower boundary on startup failure, and returns one idempotent close controller. Signal handlers
  are installed before startup; the first SIGINT/SIGTERM starts a 36-second close deadline, while a
  second signal, deadline, or close failure forces unsuccessful exit. Runtime ESM package exports
  and a black-box emitted-entrypoint check prevent a TypeScript-only or reflective startup failure.
  Its 132 tests have 100% statement/branch/function/line coverage with strict lint, type checking,
  and production builds. The `railway-edge` value is an operator assertion, not proof of Railway,
  external TLS, Cloudflare routing, direct-origin denial, protected secrets, a deployment login,
  capacity, or deployment. The latch is startup-only and proves no deployed restart, route denial,
  old-instance drain, operator audit, monitoring, or other capability switch.
- An opt-in full local Ingest HTTP-to-PostgreSQL gate. It builds emitted contracts, Ingest, and host
  code; starts one disposable `postgres-test` container with an ephemeral loopback-only port;
  applies all 43 reviewed migrations; creates a synthetic login with only `viberacing_ingest`; and
  seeds two synthetic source-bound Ed25519 devices. Independently composed signed requests prove a
  provider-attributed Usage Sync write through the mature storage path, removed-path rejection
  before upstream work, an exact duplicate under a fresh origin nonce, persistent origin replay
  denial, revoked-device denial, and the closed success/problem headers. A controlled owner lock
  then holds four valid requests at `consume_origin_nonce`; `pg_stat_activity` observes exactly four
  lock-waiting Ingest calls, a fifth valid request returns generic 503 without a fifth replay call,
  and all four original requests return exact accepted acknowledgements after release. The imported
  host then closes, the built `dist/main.js` entry point starts as a separate silent process, a
  connection-only probe observes its loopback listener without application work, and a separate
  signed request returns exact accepted before the harness forcibly ends only that test child.
  Twelve server request IDs are unique. Owner-only state verification proves nine consumed origin
  nonces, seven device nonces, seven exact accepted snapshots/entries, six current source/date
  values, the exact `codex`/`codex_daily_usage_buckets_v1` attribution and mapped client/agent
  versions, terminal first-device revocation, no revoked-device snapshot, no state for the rejected
  fifth request, and exactly one emitted-process snapshot. The command removes its blocker, imported
  host, emitted child, container, network, and storage and is required by CI. It proves no OS-signal
  delivery, graceful emitted-child settlement, deployment drain, external TLS/edge route, protected
  secret delivery, production credential, real-user input, monitoring, distributed load control,
  representative load/capacity, or deployment.
- A separate opt-in emitted Ingest OS-signal gate. It builds a link-free runtime containing only the
  emitted host, Ingest, contracts, and exact installed production graph; fingerprints it; and mounts
  it read-only under the pinned Linux Node 24.18 image in only the disposable database network
  namespace. The runtime builder explicitly makes and verifies only its public root directory
  readable and traversable by the image's distinct non-root user; the read-only mount still prevents
  container mutation. A separate capability-free client receives one independently signed synthetic
  request over stdin. The harness holds the host at `consume_origin_nonce`, delivers a real
  `SIGTERM`, releases the owner lock before the database deadline, and proves the exact 200
  acknowledgement plus one nonce/snapshot/entry/current-value state, silent code-0 exit, zero
  remaining Ingest sessions, unchanged runtime contents, and complete client/host/runtime/database
  cleanup. It proves one local Linux active-request signal path, not Railway/orchestrator drain,
  external TLS/edge routing, protected secret delivery, a production login, monitoring,
  representative load/capacity, real-user input, or deployment.
- A server-only public HTTP problem boundary that requests exactly 16 cryptographic random bytes,
  returns a frozen opaque request token, owns all eleven status/title/retry mappings including
  explicit 405/406 semantics, validates the complete `ProblemDetailsV1`, and emits only
  `application/problem+json`, `no-store`, and matching `x-request-id` headers. It accepts no inbound
  ID string, CORS setting, cookie, title, status, detail, or cause;
  malformed/accessor-backed/revoked inputs, inherited `toJSON`, and internal failures are
  non-reflective. The local score/race/status routes consume the factory; no log sink retains the
  token.
- Dynamic Node.js `GET /v1/community/scores`, `GET /v1/community/race`, and
  `GET /v1/community/race/status` routes share one boundary with independent fixed response
  validators and database calls. Each resolves only exact `VIBERACING_PUBLIC_RANKING_ENABLED=true`
  once at route-module evaluation. Every alternate or unreadable state returns the closed generic
  no-store 503 after request-ID/method handling but before URL/query/`Accept`, admission
  acquisition, configured-store construction, or database configuration. The tracked example is
  false. Once enabled, each creates one request token at entry, rejects bodies and every wrong path
  or missing/duplicate/unknown/non-canonical query, validates the one-field contract, performs
  bounded JSON `Accept` negotiation, and dispatches every other supported method through a closed
  405 plus `Allow: GET`. Each acquires one of four no-queue leases before lazily constructing its
  store, holds the lease until adapter work and serialization settle, revalidates the final page,
  and emits only `no-store`, `Vary: Accept`, request-ID, and content-type headers without CORS.
  Adapter/configuration availability and admission exhaustion map to 503; projection/invariant or
  unknown failures map to a non-reflective 500. The deadline policy uses the existing two-second
  connect, six-second client-query, and five-second PostgreSQL statement ceilings rather than
  returning early from an outer promise race. The reserved 429 does not claim a client-rate limiter.
  The module-load gate proves no deployed route/cache denial, simultaneous worker reload,
  old-instance drain, operator audit, monitoring, or dynamic switch.
- A fourth dynamic Node.js `GET /v1/community/tokens` route uses the same closed query, admission,
  error, and serialization boundary with an independent `VIBERACING_TOKEN_RANKING_ENABLED=true`
  module-load decision. It returns only `community_tokens_v1` rows with direct safe-integer
  `weeklyTokenTotal`, shared rank, cosmetic recipe, rounded freshness, and optional streak. It
  exposes no provider, source/day breakdown, exact receipt time, or legacy score field.
- An opt-in full local Web HTTP-to-PostgreSQL gate. It builds the emitted contract runtime and Web
  standalone artifact, explicitly bundles Next's otherwise externalized reviewed `pg` driver,
  generates one ephemeral self-signed DNS certificate, starts one TLS-enabled disposable
  `postgres-test` container with an ephemeral loopback-only port, applies all 43 reviewed
  migrations, seeds only synthetic public/private state, and starts two sequential emitted Next
  production processes. The deliberately widened login receives exact generic 503 contracts from all
  four public-ranking GETs while a SHA-256 fingerprint over every private table remains unchanged.
  The narrow login then returns the exact score, race, status, and token pages, including
  active-only visibility, current recipe, rounded freshness, and preference-gated streak omission,
  while `pg_stat_ssl` proves TLS 1.2 or 1.3. Contract validators plus private-marker checks prove a
  public-only response, while the same full-state fingerprint proves non-mutating behavior. The
  disposable database preloads `auto_explain`; database-scoped settings provisioned by the synthetic
  owner apply only to the narrow login and suppress every parameter value. The harness requires
  eight exact plan classes: the four fixed adapter statements and their four nested
  score/race/status/token projections. It bounds plan count/depth/nodes/bytes and root rows,
  requires one execution plus the reviewed ranking/recipe/freshness/streak indexes, and rejects a
  mutation or lock node, a sequential scan over bounded-index relations, any dirty/written or
  temporary block, any private marker, or missing evidence. A bounded owner-held table lock then
  leaves exactly four narrow-login score queries observable in PostgreSQL. A fifth HTTP request must
  return the exact generic 503 under a narrower harness deadline without adding a fifth public-score
  query; rollback releases the original four, which must all return exact 200 contracts. Next,
  blocker, and plan output is bounded, checked for private fixture/credential/path reflection, and
  discarded; all ephemeral key material, three processes, the container, network, and storage are
  removed. Secretless CI declares the command. It proves no deployment certificate/login, external
  TLS/edge path, cache, edge rate policy, representative plan/load/capacity result, monitoring,
  real-user data, hosted pass, or deployment.
- A visible public-race consumer. The dynamic server page derives the current ISO Monday and passes
  only that public label to the client. After hydration, the browser lazily loads its compact
  independent validator and issues one credential-free, `no-store`, same-origin request to the token
  route first, falling back to the legacy status route only when that surface is unavailable. It
  accepts at most 32 dense rows with the closed public field set, constant Community/self-reported
  metadata, required complete-UTC-day freshness, optional preference-gated streak, and at most one
  exact current active `CarRecipeV1`, then replaces only the race and leaderboard. An absent recipe
  receives a fixed repository-owned presentation fallback; an omitted streak remains absent.
  Invalid, oversized, non-JSON, failed, or unavailable responses retain the clearly labeled
  synthetic preview. A Community handle selects a same-page summary containing only weekly score or
  direct weekly token total, rank, active days, source count, rounded freshness, optional streak,
  and an explicit visual-marker car; daily detail, device counts, exact receipt time, and
  identifiers remain absent. The selection uses only one canonical `/?profile=handle#profile` URL
  value. A normal click updates the summary and URL in place while modified clicks retain native
  behavior. Invalid/duplicate values are ignored, a missing current top-32 row stays missing rather
  than selecting the leader, and only a public account renders its own link. The fallback demo
  garage stays synthetic, and no retry, cookie, browser persistence, analytics, or third-party
  destination is added.
- An idempotent cluster-role bootstrap for separate `NOLOGIN`, non-owner Web, Ingest, Jobs, Admin,
  and schema-owner groups. The default database and `public` schema capabilities are revoked;
  database and runtime-role search paths are scoped to `pg_catalog, pg_temp`; the migration
  principal retains explicit connection authority; unexpected group-role memberships fail closed.
- 43 checksum-ledgered, transactional SQL migrations with bounded lock/statement execution and 28
  forced-RLS private tables for profiles, invites, sessions, passkeys, recovery codes and restricted
  authorities, session-bound challenges, opaque sources, pending/active/revoked device keys,
  pairing, bounded audit references, deletion work/tombstones, seven fixed maintenance mutex rows,
  origin and device nonces, bounded raw Community snapshots, monotonic current source/day values,
  immutable score versions and season definitions, derived season entries/daily scores, terminal
  UTC-day/count freshness projections, active CarRecipes and pending proposals, and schema
  revisions. There is intentionally no GitHub token, account email, prompt, repository, credential,
  arbitrary JSON, or free-form diagnostic column.
- Database constraints and triggers enforce unique GitHub bindings, normalized handles, keyed
  verifier lengths, Argon2id recovery-verifier shape, exact device-key/source/pairing binding,
  terminal unlink/deletion states, state-dependent timestamps, and bounded lifecycle values. The
  public-key record itself moves from authority-free pending state to one source/device, then only
  to revoked.
- A Web-only CarRecipe database boundary. Revision 0025 repeats every version/enum/seed constraint
  in two forced-RLS tables, derives `active` or `hidden` profile authority only from the exact
  session proof, permits one pending and one active recipe per profile, and grants only fixed
  propose/read/ approve/reject functions. Approval atomically inserts or replaces the active row and
  deletes the proposal; rejection deletes only that exact proposal. Cross-profile IDs, replays,
  wrong verifier, device, Ingest, Jobs, Admin, direct-table, arbitrary
  color/URL/markup/conversation, and seed/version drift are rejected. Profile purge cascades both
  rows. Expiry is logically enforced for at most 24 hours. Revision 0026 gives only Jobs a separate
  oldest-first, 1-to-1000 physical cleanup serialized by the sixth fixed mutex; it preserves live
  proposals and active recipes. The command is in the default-off local catalog and combined
  synthetic scheduler/PostgreSQL integration, but no deployed retention evidence exists.
- A separate Web-only device CarRecipe proposal database boundary. Revision 0028 exposes only
  minimal active-device key material and one fixed proposal call to the probed Web role. It locks
  and rechecks active/hidden profile, active source, and active device, consumes a seven-minute
  domain-separated nonce digest, and creates or replaces the same pending server-owned 24-hour
  recipe without touching the active row. Replay, stale/future time, key/device mismatch, paused or
  terminal authority, and every non-Web role are denied in isolated PostgreSQL.
- A separate Web-only Community race projection. Revision 0027 calls the unchanged score read,
  resolves only the current `active` profile behind each visible handle, and left-joins its one
  approved recipe into an exact JSON object. Absence remains SQL `NULL`; proposal rows, IDs, state,
  timestamps, daily/raw usage, and arbitrary content are never returned. The function keeps the
  five-second deadline and 100-row database ceiling. Ingest, Jobs, Admin, and `PUBLIC` are denied.
- A third Web-only Community race-status projection. Revision 0029 calls the unchanged race read,
  derives saturated complete-UTC-day freshness from the latest accepted server receipt in the
  requested season, and derives consecutive positive-score streak from materialized daily scores
  through the closed Sunday or current-day/yesterday grace anchor. The streak crosses prior
  materialized seasons but is omitted when the current active profile disables visibility. A future
  season is suppressed even if score state is materialized outside the reviewed scoring lifecycle.
  Exact timestamps, daily rows, preferences, and private identifiers remain absent. A partial
  positive-score index supports the lookup; the function retains the five-second deadline and
  100-row ceiling. Ingest, Jobs, Admin, and `PUBLIC` are denied.
- A private finalized source/day retention boundary. Revision 0039 captures one bounded
  UTC-day/source/value inventory for each profile on terminal finalization and backfills the same
  projection for existing finalized state. The compatible race-status read prefers that rounded
  date, so maximum-1000 Jobs batches can delete oldest exact per-source daily rows only after 30
  days without changing public output. Every row deletion rechecks live plus deleted inventory and
  the saved maximum date under the existing scoring, Ingest-retention, and profile-purge mutexes.
  Open, recent, missing-projection, or drifted state is preserved or fails closed. The combined
  synthetic scheduler integration exercises this capability; there is no correction authority,
  production login/TLS path, monitoring, capacity, backup purge, restore replay, deployment, or
  real-user retention evidence.
- A bounded historical Community season finalization boundary. Revision 0040 exposes one
  zero-argument Jobs-only function that takes the existing Community scoring mutex, derives the
  oldest grace-eligible open or retained-data-backed season, and invokes the existing finalization
  function for at most one season. It returns only a closed 0-or-1 season count and the bounded
  profile count; Web, Ingest, Admin, and `PUBLIC` remain denied. The existing source-date index and
  one new partial open-season index support oldest-first lookup without adding a queue, run ledger,
  caller-selected date, retry counter, or retained field. The default-off scheduler places the step
  first in its hourly catalog, and the disposable PostgreSQL gates prove empty, no-data open,
  data-backed missing, current-week, denial, missing-lock, exact-state, and two-worker serialization
  behavior. Representative backlog size, production credentials/TLS, capacity, monitoring, real-user
  recovery, deployed cadence, and deployment remain unproven.
- A database policy checker with 23 black-box cases for migration drift/path/revision, transaction
  and timeout omissions, unsafe SQL features, `PUBLIC`/direct runtime grants, unsafe
  `SECURITY DEFINER`, role options, passwords, and owner membership. The real PostgreSQL gate runs
  deterministic synthetic fixtures in rollbacks and proves four runtime roles cannot read identity
  or usage tables or create API objects.
- A deterministic pre-restore migration-overlap drill in that isolated real PostgreSQL gate. It
  holds revision 0039's own advisory lock, starts two tagged processes with the unchanged reviewed
  migration, and releases the holder only after both contenders appear in its transitive blocker
  chain. One process must apply the complete transaction; the other must roll back with the expected
  duplicate-object SQLSTATE `42P07`; and exactly one ledger row plus the canonical table must
  remain. This proves local advisory serialization and atomic losing-process rollback, not a
  successful concurrent deployment controller, staging migration orchestration/rollback, replica
  coordination, production credentials, or deployment.
- A separate default-off one-shot migration controller core. It accepts no arguments or catalog
  path, validates the exact manifest/file set and original SQL digests, and admits protected
  database configuration only after exact `VIBERACING_MIGRATIONS_ENABLED=true`. Its fixed one-client
  adapter probes expected login, owner-only membership, cluster flags, direct database grants,
  search path, read-write state, and configured TLS state before taking the session migration lock.
  The runner then rereads an exact ledger prefix under the owner role, applies only the reviewed
  missing suffix, requires the complete ledger, resets role, and unlocks. Unit and built-entrypoint
  evidence covers closed result shapes and failure cleanup. A separate opt-in gate builds and runs
  the emitted entry point with a widened negative login and two narrow logins against one disposable
  hostname-verified TLS PostgreSQL database. It proves the widened process fails generically before
  schema creation, observes both narrow processes behind one external holder of the fixed session
  key, then requires both to succeed and converge on the exact 43-row ledger. The same oracle checks
  all 28 private tables remain owner-owned with forced RLS, runs the identity invariants, and proves
  the controller sessions and lock are gone before deleting every resource. This is actual local
  DDL/driver/TLS/convergence evidence, but not production TLS/login, staging rollout/rollback,
  deployed replica coordination, monitoring, deployment, or recovery.
- A checked staging migration and forward-recovery runbook for that controller. Eighteen ordered
  controls require a pinned artifact, protected owner/target assignment, current isolated restore
  evidence, deployed/candidate service compatibility, narrow verified-TLS authority, one-shot
  enablement, exact ledger/role/resource oracles, containment, and forward-only repair. Seven
  documented commands are bound to the root and migration package scripts plus the exact enablement
  and generic success source; thirteen unsafe or drifted regression variants fail closed. This is a
  static public operator contract, not a successful staging run, production authorization,
  monitoring, stale-backup deletion replay, recovery, or deployment evidence.
- A deterministic current-snapshot restore drill inside that isolated real PostgreSQL gate. It
  retains two bounded custom archives only in the disposable container, replaces only the run's
  database twice, requires the source and both restored canonical data dumps to have the same
  SHA-256 digest and byte length, requires the first and second restored schema generations to be
  byte-stable, and rechecks all 28 forced-RLS tables plus selected Web/Jobs/Admin grants and denials
  after each restore. The 45 post-restore lock-wait races, the early-completion overlap, and the
  full runtime deny matrix then execute on the twice-restored database. Dump buffers are bounded,
  hashed, overwritten, and never emitted. This proves no old-backup deletion replay, external
  storage or encryption, cluster-role recovery, production login/TLS, representative scale, or
  RPO/RTO.
- A checked isolated current-snapshot restore rehearsal runbook for that drill. Twenty ordered
  controls require a pinned synthetic source, isolated target and routing, container-only archives,
  exact ledger/data/schema/RLS/grant oracles, protected redacted evidence, cleanup, and incident
  handoff. Four documented commands are bound to the root scripts, integration limits, two restore
  calls, two post-restore security checks, and portless `tmpfs` Compose service; sixteen unsafe or
  drifted regression variants fail closed. The runbook stops before any pre-deletion or real-user
  archive. This is a static public rehearsal contract, not a staging restore, stale-backup deletion
  replay, external backup system, cluster recovery, production authorization, RPO/RTO, or deployment
  result.
- A checked profile-deletion failure rehearsal runbook for the existing request/purge/retention
  chain. Twenty-six ordered controls bind ten exact root commands, atomic Web request/cookie
  settlement, maximum-ten due-job Jobs-only purge, five-mutex and role boundaries, separate 30-day
  terminal retention, fixed scheduler order, state-drift rollback, preservation scenarios, worker
  races, and both disposable PostgreSQL integrations. Twenty-five unsafe or drifted regression
  variants fail closed. The runbook permits no queue mutation or raw database/Jobs command, treats
  confirmed request lock-down as durable incident state, and does not claim automatic retry,
  monitoring, notification, cache/backup purge, stale-backup replay, production deletion, recovery,
  or deployment.
- A closed procedure-only API boundary: Admin can issue bounded, reasoned invites; Web can
  atomically redeem an invite, create an enrolling profile/session, create and consume exact-session
  challenges, register the initial passkey, rotate/revoke a possessed session, and request immediate
  profile lock-down plus a deletion job. Web can also start a bounded pairing, approve its exact
  immutable key and new/existing opaque-source choice after a consumed pairing step-up, expose
  minimal external signature-verification material, activate one exact source-bound device, and poll
  only bounded status. Web can privately list its own sources/devices, immediately pause an active
  source or revoke an owned device, and reactivate/unlink one exact source only after a fresh,
  consumed, source-bound step-up. Unlink atomically revokes all active source devices, cancels
  approved pairings, and invalidates unused source actions; normal user authority cannot lift
  quarantine. Web additionally has bounded public Community score, compatible race, and compatible
  race-status projections. Ingest has only atomic origin-nonce consumption, minimal active-device
  verification lookup, and bounded Community sync submission; Jobs have only twelve bounded cleanup
  calls, one bounded redaction, one fixed reset, primary profile purge, Community scoring refresh,
  and finalization. Ingest has no identity, passkey, recovery, pairing, admin, or direct-table
  capability. Profile-scoped functions derive identity from an active session ID plus keyed verifier
  and do not accept a caller-selected profile ID.
- The same boundary can create a five-minute profile-free login challenge, expose only minimal
  active-passkey verification material, atomically mint a passkey-bound session after application
  verification, and return only profile ID, handle, and locale after success. Revision 0014 composes
  challenge creation and consumption with that session so options requests retain no database state.
  The boundary can also privately list owned passkeys and add or revoke an exact passkey after a
  fresh target-bound step-up. Stored sign counters never decrease; the last active key cannot be
  removed; revocation closes the key's sessions, unused challenges, and pending pairing authority
  while preserving unrelated keys and already activated devices.
- The Web boundary can rotate an 8-to-16-code recovery batch only after a fresh exact-passkey
  `recovery_change` step-up, read only one opaque selector plus unused PHC for application
  verification, consume and scrub one code into a single recovery-only authority for at most ten
  minutes, and atomically complete exact replacement-passkey registration. Completion revokes old
  browser/passkey authority, cancels approved pairings, clears codes/challenges, and creates the
  normal session only after the replacement key exists. Activated source-bound devices remain
  separate and explicitly revocable; profile deletion revokes active recovery authority.
- PostgreSQL scenarios prove invalid invite rollback, absolute invite/session/challenge lifetimes,
  wrong-verifier denial, cross-profile challenge denial, one-time challenge/action use, old-session
  invalidation after rotation, typed-handle deletion binding, full rollback after failed deletion,
  synchronous browser/passkey/device revoke, source unlink, approved-pairing cancellation, opaque
  job queueing, audit-link redaction on profile purge, new/existing-source pairing, wrong-poll and
  replay denial, post-approval competing-profile rollback, exact activation, immutable pairing
  binding, inventory isolation, lifecycle IDOR/replay denial, quarantine separation, stale challenge
  invalidation, approved-pairing cancellation, recursive device revoke, audit-failure rollback, and
  the public ceilings of 32 lifetime sources and 64 active/unexpired-approved device authorities per
  profile. Passkey scenarios additionally prove exact credential/profile binding, unknown/revoked
  lookup equivalence, one-time login, atomic audit rollback, monotonic usage state, inventory
  isolation, add/revoke replay denial, last-key protection, and the public ceilings of 32 lifetime
  passkeys and 32 active sessions. Recovery scenarios additionally prove bounded batch rotation,
  minimal profile-free lookup, immediate used-PHC scrub, one-code/one-authority use, exact
  challenge/context completion, terminal authority, deletion revoke, activated-device preservation,
  oversized/replay/role denial, atomic rollback, fail-closed behavior at the retained-passkey
  provenance ceiling, and successful retry after eligible aged revoked rows are removed. These
  identity/pairing procedures do not perform OAuth, Argon2id, WebAuthn, or pairing-possession
  Ed25519 cryptographic verification internally. The closed Web pairing adapter now derives the
  keyed poll lookup, obtains only one matching approved tuple, runs the separate strict verifier,
  and calls activation only on success; the SQL procedure independently rechecks the full binding
  atomically. No HTTP route can reach that composition, and the separate later request-signature
  kernel does not approve or activate a pairing.
- Community ingest PostgreSQL scenarios prove exact activated device/source binding, minimal lookup,
  strict identifier/version/date/token/digest and 31-entry bounds, canonical millisecond time,
  server-time freshness, exact duplicate acknowledgement, mutated idempotency and nonce replay
  rejection, whole-snapshot decrease quarantine, quarantined-source retention, paused/revoked/
  deletion-pending rejection, same-source multi-device replacement without summing, owner-level
  monotonic and exact accepted-snapshot/entry provenance triggers, 15-minute nonce expiry markers,
  30-day raw-snapshot expiry markers, and a Jobs-only server-time cleanup procedure with strict
  1-to-1000 batches, idempotent reruns, live-row preservation, entry cascade, and raw-reference
  clearing that preserves current values. Pairing-retention scenarios separately prove bounded
  oldest-first removal of expired pending, approved, and cancelled transactions plus their pending
  keys, approval-challenge cascade, idempotency, live/activated preservation, role denial, and
  private-mutex failure. Ingest also applies the server grace deadline before its
  profile/source/device locks: a late whole snapshot is retained as `season_closed` but updates no
  accepted source/day state. No deployed HTTP Ingest API, deployment Ingest/Jobs credential/TLS
  integration, or deployed scheduler/cadence exists. The local Ingest composition now has synthetic
  mock-pool, injection, loopback framing, and full disposable HTTP-to-PostgreSQL evidence; the local
  one-shot runner described below remains the only Jobs database boundary, and the separate
  scheduler can invoke only that runner.
- Community scoring PostgreSQL scenarios prove immutable `community_v1` formula parameters and
  season binding, ISO Monday-to-Sunday grouping, exact logarithmic rounding, numeric overflow
  protection, one profile cap after distinct-source aggregation, weekly caps, active-day and
  contributing-source counts, shared rank without a raw-token tie breaker, deterministic
  noncompetitive display order, hidden-profile and quarantined-source exclusion, seven daily rows
  per participant, a state-free no-op for open weeks without source data, semantic idempotency,
  generic failure, rollback, a 30-second statement deadline, and Jobs-only authority. The private
  materialization stores no raw token total or source ID. Finalization scenarios additionally prove
  the exact Wednesday 00:00 UTC boundary after a 48-hour grace period, early-finalization rollback,
  bounded no-data closure, terminal idempotency, refresh denial, direct metadata/score mutation
  denial, late-snapshot quarantine, and profile-purge compatibility. Public-read scenarios prove an
  exact ten-field allowlist, active-only filtering, post-hide shared-rank/display re-numbering, a
  100-row result ceiling, open/finalized metadata, a five-second statement deadline, generic input
  failure, Web-only authority, and Ingest/Jobs/Admin denial. The stable score response separately
  proves constant Community/self-reported metadata, the same ten-field allowlist, a top-32 ceiling,
  empty results, bounds, unique display positions, private-field rejection, and generated drift. The
  separate compatible race response repeats those constraints, accepts only an optional exact
  `CarRecipeV1`, and rejects proposal/private/arbitrary fields while proving the score component
  still rejects `carRecipe`. The third compatible status response adds required rounded freshness
  and optional preference-gated streak, rejects exact timestamp/daily/private fields, and proves
  both legacy components reject the new status fields. Server-only Web mappers additionally reject
  malformed or accessor-backed adapter output, unknown ten/eleven/thirteen-column rows, more than 32
  rows before row traversal, contract drift, inconsistent season metadata, non-contiguous display
  positions, duplicate handles, invalid SQL rank/order semantics, malformed nested recipes, and
  invalid status bounds. They return frozen canonical responses or throw one generic non-reflective
  message with a bounded cause code. A server-only `pg` adapter now adds namespaced Web-login
  settings, loopback-only development cleartext, certificate-verified production TLS, a
  four-connection pool, fixed connect/query/statement/lock/idle/lifetime ceilings, and three fixed
  parameterized top-32 queries with explicit date-to-text casts. It verifies the effective Web role,
  distinct non-privileged login with only Web membership, database capability, search path, and
  read-only state before every query; destroys a failed client; releases a healthy client before
  mapping; and returns only stable non-reflective error/signal codes. Config, pool, and store tests
  cover positive and negative boundaries without a live deployment credential. The local routes are
  wired to this adapter and the synthetic standalone integration proves an ephemeral self-signed
  certificate plus disposable login, but no cache, deployment certificate/login, external TLS/edge
  route, audited correction flow, or deployed scheduler/cadence exists.
- A local server-only enrollment application now parses one exact 1 KiB invite form, immediately
  reduces the canonical 256-bit secret to SHA-256, and seals the digest/preferences with independent
  32-byte OAuth state and S256 PKCE material in a ten-minute callback-path AES-256-GCM cookie.
  GitHub authorization requests no extra scope. The callback has an exact host/path/query, a
  ten-second deadline, fixed no-redirect/no-cache/no-browser-credential requests, and returns only a
  positive safe numeric GitHub ID while discarding the access token and every other response field.
  It seals a 15-minute pending session before one fixed atomic `enroll_profile` call on the probed
  read-write Web/Auth pool. Initial passkey options create one five-minute session/context-bound
  database challenge; the verifier requires a discoverable credential, user presence and
  verification, attestation `none`, ES256 or RS256, and exact challenge/origin/RP/type before one
  atomic consume-register-and-session-rotate query. Success creates a fresh 30-day passkey-bound
  session and revokes the pending session. The `/join` and `/join/passkey` pages plus GitHub
  start/callback and initial-passkey options/verification now require exact
  `VIBERACING_ENROLLMENT_ENABLED=true` at module evaluation. Disabled state omits both EN/RU forms
  and returns generic 503 before request/runtime/admission/private work; all four service methods
  repeat the literal check before input/cookie/OAuth/WebAuthn/database work. Existing active-session
  redirects, returning login, restricted recovery, logout, and account security actions remain
  available. This local control does not dynamically clear continuations, terminate in-flight
  requests, repair invites, coordinate workers, or prove deployment. Revision 0038 separately
  permits an explicit Jobs-only bounded cleanup after every retained enrollment authority expires;
  the gate neither invokes nor schedules it. Returning login generates a profile-free discoverable
  challenge with no credential allowlist and keeps it only in a separate encrypted cookie. After
  canonical credential lookup, exact `webauthn.get` challenge/origin/RP/type/signature/UV and backup
  verification, one fixed call creates and consumes the challenge while minting a 30-day
  passkey-provenance session. Failed cookie sealing compensates by revoking that new session. Every
  account render can use the exact possessed session for fixed `read_passkey_inventory`,
  `read_profile_visibility`, and `read_source_inventory` calls. The source mapper accepts at most 95
  projection rows representing at most 32 opaque sources and 64 active devices, preserves a source
  with no active device, rounds activation to a UTC date, and renders only source ordinal/state plus
  device label/platform/version. Source IDs, internal key/profile IDs, public keys, and exact
  lifecycle times stay out of HTML; only the exact opaque device ID enters its hidden revoke form.
  Revision 0016 preserves both private inventory and immediate owned-device revoke while public
  visibility is hidden. Revision 0017 preserves immediate source pause and fresh-passkey
  reactivation under the same hidden profile state; revision 0018 does the same for terminal source
  unlink. Source actions expose only a 15-minute encrypted control token bound to the active
  session. Pause uses one same-origin form. Reactivation accepts only `paused`, binds a required-UV
  assertion to the session/source/RP/origin context, and reaches one atomic consume-and-reactivate
  statement; it cannot lift quarantine or change visibility. A distinct fresh context reaches one
  atomic consume-and-unlink statement for an active, paused, or quarantined source. Unlink revokes
  all active source devices and never publishes a hidden profile. One fixed materialized statement
  invokes `revoke_device`, returns only a boolean, and appends a bounded audit reference. The
  passkey mapper accepts 1-to-32 ordered closed rows, requires one current active authenticator,
  rounds creation to a UTC date, and keeps credential IDs, keys, sign counters, exact activity
  timestamps, and profile IDs out of HTML; only a revocable target's opaque passkey ID enters the
  authenticated control. A same-origin bounded form maps only `public`/`hidden` to the fixed
  `set_profile_visibility` capability. Hiding immediately removes the profile from public score
  reads without pausing source sync, publishing restores visibility, and repeated state is a no-op.
  Addition validates and seals the bounded NFC label before prompting, generates independent
  five-minute existing-key assertion and new-key registration challenges, and binds both to the
  session/profile/RP/origin context. Exact verification of both responses reaches one materialized
  consume-and-add statement; failed consume never invokes add, while insert/audit failure rolls back
  consume. The existing database retained-record cap closes concurrent additions. Revocation accepts
  one owned non-current active target, seals a five-minute session/target/RP/origin-bound
  continuation before the fixed challenge call, requires a fresh exact user-verified assertion, and
  uses one atomic consume-and-revoke query. Current, last, foreign, malformed, expired, and replayed
  attempts fail generically; activated devices remain separately revocable. Recovery-code rotation
  likewise requires the exact active session and a fresh required-UV assertion bound to its
  session/profile/RP/origin context. The server generates ten independent selector/secret codes and
  sequentially derives their Argon2id PHCs with deployment-selected bounded work factors and a
  distinct protected 32-byte pepper. One materialized statement consumes the challenge and replaces
  every old code and active recovery authority. Only a successful commit returns the plaintext batch
  in a no-store response; the client holds it only in component memory and shows it once. The
  tracked pepper, work-factor, and response-floor settings remain non-working placeholders. The
  separate `/recover` flow accepts one exact selector/secret plus a bounded replacement label,
  retrieves only the matching unused PHC, and performs one bounded Argon2id derivation for known,
  unknown, wrong, or malformed attempts under the recovery-only pepper. An admitted options request
  has a 512-byte body, four-call local no-queue admission, generic failure, and a configured minimum
  response floor. Success seals a purpose-separated five-minute authority continuation only after
  the database consumes and scrubs the code. The verify route accepts a bounded registration
  response, verifies exact WebAuthn RP/origin/challenge/context and required UV, then invokes one
  atomic replacement-passkey/session call. Revision 0020 returns only profile ID, handle, and locale
  after that commit so Web/Auth can seal the normal session; cookie-sealing failure revokes that new
  session. The code input is cleared after the options response and is never logged, cached, or
  persisted in the browser. Profile deletion accepts only the session's exact typed handle before
  the prompt, seals a five-minute continuation, and binds a fresh required-UV assertion to the exact
  session/profile/handle/RP/origin context. One materialized statement consumes that challenge and
  invokes the existing atomic hide/revoke/unlink/enqueue procedure with server-generated job/audit
  IDs and a fresh opaque 32-byte purge reference. Success clears all browser auth cookies; failure
  remains generic and retains them. The Web boundary itself runs no background work; revision 0024
  plus the separate local Jobs command now provide bounded primary purge, and the default-off local
  scheduler catalog and combined synthetic PostgreSQL integration include it. Deployed scheduling,
  cache/backup purge, keyed tombstone policy, and restore replay remain unimplemented. Inventory
  dependency failure renders a generic unavailable state without removing logout. Every POST body is
  stream-bounded, compressed bodies and duplicate cookies fail closed, and admission is held from
  the first body read through dependency settlement; overload cancels the body without a queue.
  Cookies are HttpOnly/SameSite=Lax/secure-on-HTTPS with narrow paths, callback URLs are excluded
  from Next development request logs, and responses are generic, `no-store`, and `no-referrer`.
  EN/RU home-session navigation, join, passkey, returning-login, passkey-inventory, active-account,
  profile-visibility, source inventory/pause/reactivation/unlink, active-device revoke, passkey
  add/revoke, recovery-code rotation, recovery sign-in, deletion, and logout UI is present. Each
  route has four-call local admission. The CSP permits GitHub only as the exact OAuth `form-action`;
  no remote script/connect/asset/frame capability is added. The two exact-pinned SimpleWebAuthn
  packages are confined by effective lint policy to one server verifier and one browser component;
  licenses, full 23-record lock addition, production asset budget, and online advisory state were
  reviewed. Tests cover configuration, cookie purpose/tamper/ambiguity, invite grammar/minimization,
  state, PKCE, token minimization, fixed SQL and role probes, continuation-before-write ordering,
  replay and dependency failure shapes, profile-free/database-state-free login options, atomic login
  settlement, closed account inventory, exact-session idempotent visibility change,
  independent-challenge atomic add, session/target-bound revoke, current/foreign/replay denial,
  exact-handle/session-bound deletion, recovery generator/configuration, fresh-step-up atomic batch
  replacement and one-time client display, exact-code/dummy-work verification, restricted-authority
  replacement registration, generic/timing HTTP behavior, atomic consume/delete settlement, bounded
  empty-source/device mapping, hidden-profile inventory/pause/reactivation/unlink/revoke, encrypted
  session-bound source targeting, cross-session and replay denial, cross-origin/duplicate-form
  denial, origin/body/admission/logout policy, actual browser-adapter calls, local-session home
  navigation, EN/RU, and accessibility. A `localhost` Next dev-server smoke also proves the join
  page, exact no-scope GitHub redirect and callback-only cookie, state-bound cancellation,
  cross-origin rejection, missing-session denial, cookie-clearing logout, and callback-query
  suppression in development logs. Recovery component and axe cases use synthetic browser adapter
  responses only. The same local identity boundary now exposes `/connect` plus two exact same-origin
  JSON steps for pairing approval. A passkey-registered session submits one canonical code, revision
  0021 counts the admitted attempt on the session across application instances under
  deployment-private bounds, and the browser receives only bounded device metadata plus a full
  SHA-256 public-key fingerprint. The same session-derived bounded inventory supplies only active
  source ordinals, active device labels, and encrypted session-bound source controls, so the form
  can explicitly select a new or existing owned source while raw source IDs remain server-only.
  WebAuthn begins only after a second explicit approval action; its challenge binds the session,
  pairing, exact source choice and ID, RP, and origin, and one fixed statement rechecks and consumes
  it while approving atomically. The code is cleared from the form after lookup, the raw public key
  never reaches the client, and raw pairing/source IDs exist only inside encrypted source-control or
  HttpOnly approval continuations rather than client-readable plaintext or logs. This is
  HTTP/runtime evidence only, not visual browser, OAuth-provider, authenticator, or database E2E.
  Both approval routes now enforce literal-true pairing enablement before constructing that runtime,
  reading origin/body/cookies, acquiring admission, starting WebAuthn, or accessing pairing state.
  The `/connect` shell and its separate session inventory may remain visible while actions fail
  generically. There is no invite issuer UI, anonymous pairing-start or recovery edge attempt
  policy, deployed expired-state cleanup cadence or notification, live OAuth/authenticator/database
  integration, monitoring, or deployment evidence.
- A private current-week account score slice now reuses the exact possessed session and one combined
  Web/Auth pool checkout for visibility plus revision 0019's derived-score read. The server-only
  mapper accepts one empty sentinel or exactly seven consecutive 0–1000 daily scores with coherent
  weekly/season metadata, rejects raw or inconsistent fields, and renders no score while hidden.
  EN/RU component tests cover score, hidden, and unavailable states. There is no client fetch,
  browser storage, working database credential, or live-user evidence.
- A second server-only Web pairing adapter reuses the same environment-owned narrow Web/Auth login
  through a separate four-connection read-write pool. The start application accepts only a closed
  canonical public-key/label/version/OS/architecture request, generates fresh pairing and
  pending-key UUIDs, a 32-byte poll token/challenge, a 12-symbol 60-bit code, and a nine-minute
  expiry, derives separate primary poll/code HMAC digests, and invokes only the fixed start
  procedure. The human-code primary/optional-secondary keys must also differ from every poll key.
  Malformed admitted input performs fixed-shape local material/HMAC work without a database write.
  Every checkout verifies the exact Web role, distinct narrow login, sole membership, database
  capability, search path, and read-write state. One fixed activation query returns at most one
  approved/unexpired pairing ID/challenge/public key; for every structurally valid lookup outcome,
  the high-level adapter runs the strict ADR 0026 proof and alone invokes the exact activation
  procedure with a server-generated `dev_` ID, audit UUID, and common `req_` ID. Each transport-free
  application admits four unsettled attempts, holds each through a 250-millisecond floor, and
  returns only its frozen success shape or generic failure plus a request ID. Pairing coverage
  includes material/code bounds, HMAC vectors/rotation and key separation, hostile
  configuration/input/result shapes, fixed start/lookup/activation queries, driver confinement, role
  drift, strict proof selection, IDs, admission/timing, generic failure, clearing, release, and
  close. The same Web workspace now adds exact start/poll body/header routes, one aggregate service,
  domain-separated anonymous client digests, mandatory deployment-private global/bucket/window
  limits, and retry-safe activation result reads that require a fresh valid possession proof before
  returning the existing binding. All four pairing route modules resolve exact
  `VIBERACING_PAIRING_ENABLED=true` once at load; every alternate or unreadable state returns the
  existing generic no-store 503 after body cancellation but before request parsing, runtime/service
  construction, admission acquisition, protected configuration, or database work. Connector non-POST
  methods retain 405 and the tracked example remains false. Revision 0022 retains only 130 fixed
  aggregate counter rows and never the client ID or digest. This module gate is not dynamic,
  deployed, or the source-creation decision. Independently, the `/connect` page and both approval
  modules require exact `VIBERACING_SOURCE_CREATION_ENABLED=true` before permitting a new opaque
  source; the tracked example is false. Disabled UI preserves active existing-source choices, while
  the service rejects false, missing, truthy-string, and numeric decisions both before new-source
  challenge work and before WebAuthn/database completion. Exact source choice is sealed into the
  five-minute approval cookie and bound by the v2 context digest, so a restarted disabled
  verification module rejects an in-flight new-source challenge. This local gate is also not dynamic
  or deployed. These boundaries still do not prove a live login/TLS connection, edge capacity,
  deployed cleanup cadence, monitoring, or deployment.
- A Rust connector binary exposes a bounded `connect` command that accepts only a canonical HTTPS
  origin or explicit loopback HTTP development origin and a bounded label. It disables proxies and
  redirects, uses platform TLS verification, bounds request/response/time, generates an Ed25519 key
  and 16-byte anonymous client ID through the OS CSPRNG, and stores one fixed versioned
  prepared/pending/active record only in the native credential store. It persists before displaying
  authority, resumes pending polling, signs the exact ADR 0026 message, clears pending material
  after activation/expiry, and never prints key, token, challenge, source, or device IDs. The
  separate local-only `forget-local` command deletes the exact origin/label native entry without
  loading or decoding it, treats an absent entry as the same success, and states that server revoke
  remains separate. Rust tests cover command/origin/record/response, start-to-active behavior,
  delete-only invocation, identifier-free output, missing/extra/duplicate arguments, native result
  mapping, default candidate discovery, explicit-path fallback, hostile filename/directory cases,
  every discovery resource bound, and the closed credential-free `check-codex` parser/output/error
  boundary under format/check/Clippy. Its opt-in diagnostic preview has exact passed/not-admitted/
  unsupported-platform bytes, preserves failed admission, and is also exercised through the
  target-built CLI with an empty environment and missing synthetic path. Tests use an injected store
  and synthetic files; they do not touch a real OS credential entry or installed Codex binary. A
  separate Windows x86_64 black-box smoke builds the locked release profile, exclusively copies the
  `0.0.0` connector under a random bounded temporary root, compares SHA-256 before and after its
  exact help and missing-candidate invocations under a cleared environment, proves the fixed
  inventory, and removes the copy. The separate candidate sync path is documented above; there is no
  hosted Windows result, cross-platform runtime result, real HTTP/Web/database pairing result,
  installer, upgrade, key rotation, automated server-revoke composition, package, signed release, or
  support claim.
- A private TypeScript Jobs workspace now accepts exactly either a fixed 1000-row authentication/
  abandoned-enrollment/audit-event/invite/CarRecipe-proposal/ingest/finalized-source-day/pairing/session/
  terminal-deletion-job/aged-revoked-passkey/aged-revoked-device cleanup command, a fixed 1000-row
  pairing approval-provenance redaction, a zero-argument maximum-130 pairing-rate-window reset, a
  separate fixed 10-profile primary purge, one no-argument oldest-known-season backlog finalization,
  or one canonical Monday refresh/finalization command. It revalidates closed plain job data, reads
  only redacted `VIBERACING_JOBS_DATABASE_*` configuration, permits cleartext only for explicit
  development/test loopback, and otherwise requires certificate-verifying TLS with a DNS hostname.
  Its pool maximum is one; client connect/statement/query deadlines are 2/31/32 seconds, outside the
  database functions' 30-second deadline. Every checkout probes the exact `viberacing_jobs`
  effective role, a distinct non-privileged login with only that membership, CONNECT without
  CREATE/TEMPORARY, and `pg_catalog,pg_temp` search path. It then selects one of eighteen fixed
  prepared function calls, requires one exact allowlisted result row, holds the client through
  settlement, destroys it after failure, and closes the pool on every acquired CLI path. Success and
  failure output are stable sentences without command/date/count/config/SQL/exception reflection.
  Two hundred seventy-three focused tests cover config, TLS, pool/signal behavior, hostile
  command/object/array/result inputs, exact SQL parameters, role mismatch, settlement/release/close,
  CLI output, and failure translation at 100% statement/branch/function/line coverage. A lint-policy
  regression also prevents every production module except the fixed pool adapter from importing
  `pg`. A TypeScript production build passes. A separate opt-in Docker integration applies every
  checksum-validated migration to one disposable PostgreSQL container, creates a synthetic narrow
  Jobs login and a negative-control login with one extra group membership, runs all eighteen emitted
  CLI commands as separate processes, proves the widened login returns only the generic failure
  before mutation, and verifies generic success plus exact cleanup, purge, refresh, latest-season
  finalization, and oldest-known historical-season finalization state before removing the container,
  network, and storage. No external audit sink, production Jobs login/TLS path, deployed
  scheduler/cadence, monitoring backend, automatic retry policy, capacity result, correction,
  cache/backup/tombstone purge, restore replay, or deployment is claimed.
- A separate private Jobs-scheduler workspace accepts no arguments or schedule configuration and
  starts only after exact `VIBERACING_JOBS_SCHEDULER_ENABLED=true`. It resolves that latch before
  constructing the Jobs runner or reading database configuration. One closed UTC catalog refreshes
  the current Monday season at most once per uninterrupted five-minute slot, submits finalization
  only for the latest grace-eligible season at most once per UTC day, advances at most one oldest
  known data-backed historical season per UTC-hour slot, and then invokes all fifteen cleanup,
  redaction, reset, and purge objects in that same hourly slot. It marks slots in memory before
  invocation, validates a frozen dense maximum-18 collection, runs through one runner sequentially,
  ignores overlapping ticks, continues later fixed objects after a failure, and emits only
  `cycle_failed` once for that cycle. SIGINT/SIGTERM prevents a later object, waits for the current
  bounded Jobs call and runner close under 35 seconds, and fails on a second signal, deadline, or
  cleanup error. Ninety-four tests cover the UTC bounds, default-off and retention dependency
  ordering, hostile shapes/dependencies, runtime-import policy, non-overlap, failure containment,
  and process lifecycle at 100% statement/branch/function/line coverage. Strict lint, TypeScript,
  build, and built-entrypoint gates pass locally. An opt-in synthetic integration builds the
  production scheduler core and Jobs runner, injects one fixed UTC clock/timer, executes the exact
  ordered eighteen-job catalog against disposable PostgreSQL, fingerprints every private table
  around a widened-login denial, and verifies exact narrow-login stored state. A separate timer
  integration advances the fixed clock by one hour, invokes the production interval handler twice
  during the active real-runner cycle, proves the exact recurring catalog plus overlap and same-slot
  suppression, and verifies the rearmed terminal reset. A third lifecycle integration injects its
  first handler during the penultimate real database job, requires active-call settlement, proves no
  later scheduler job, and observes exact graceful cleanup and exit code 0 before invoking the
  omitted reset separately for the shared state oracle. A fourth integration starts the built entry
  point with exact configuration and the real host clock from a link-free read-only runtime under
  pinned Linux Node. It temporarily removes only the Jobs role's backlog-function execution grant,
  then requires one generic cycle signal, no backlog mutation, later terminal-job settlement, and a
  code-0 `SIGTERM` exit with session release. The harness restores and rechecks the exact grant,
  rearms the marker, holds the scoring mutex, and starts the same runtime again. It observes the
  first finalization lock-wait, delivers `SIGKILL`, requires exit 137 plus session release, and
  proves the backlog and marker remain unchanged. After releasing the holder, a restart finalizes
  the backlog before a silent code-0 signal exit. A disposable post-insert barrier then holds a
  second backlog after its first daily projection insert; another `SIGKILL` must release the session
  and roll back every new season/projection row. The barrier is removed and its absence verified
  before a clean-schema restart finalizes that backlog exactly once. A final rearm/restart requires
  another silent repeated cycle, no scheduler sessions after any of the six starts, unchanged
  runtime contents, and the same exact state. A fifth starts the same emitted process with its
  unchanged native clock and timer from the same bounded runtime shape, holds the scoring mutex
  after startup, observes refresh in a later real five-minute slot, delivers a real `SIGTERM`,
  releases the holder, and requires active-refresh settlement, a newer timestamp, silent code-0
  exit, session release, and unchanged runtime contents. A sixth constructs the same bounded runtime
  shape from only the built scheduler, built Jobs runner, and exact 14-package installed production
  graph and joins only the disposable database network namespace. It holds the emitted first
  finalization call, observes the exact lock wait, delivers a real `SIGTERM`, releases the holder
  before the database deadline, and proves active-call settlement without refresh or a later job,
  silent code-0 exit, session release, unchanged runtime contents, and the shared final state after
  the seventeen omitted commands run separately. The fourth check proves local failure/crash
  containment, later-job continuation, successful clean-schema retries, a later repeated restart,
  four graceful post-startup `SIGTERM` settlements, two abrupt active-call `SIGKILL` exits, and one
  controlled uncommitted post-insert transaction rollback; the fifth proves one local host-timer
  recurring refresh plus active-call OS-signal settlement. These checks do not prove
  committed/external-effect or every-capability recovery, automatic privilege repair, a deployed
  signal route, controller/orchestrator grace policy, managed restart, representative or deployed
  backlog recovery, a stable production clock, a replica lease, durable/deployed cadence, production
  login/TLS, monitoring, capacity, or real-user retention. Secretless CI declares all six scheduler
  commands, but no hosted pass is claimed from this local tree.
- Forty-six deterministic lock-wait races tag every session and observe every contender in the
  holder's transitive PostgreSQL blocker chain before releasing it. The one pre-restore migration
  overlap holds revision 0039's advisory lock around two exact migration processes, then requires
  one complete application and one duplicate-object rollback. The 45 post-restore races hold a
  relevant invite, challenge, session, source, device, pairing, or profile row, or a season advisory
  lock. Protective races additionally prove the first contender is blocked before the competitor
  starts. One separate early-completion overlap holds an in-flight initial-passkey activation and
  proves cleanup finishes through `SKIP LOCKED` before that holder is released. PostgreSQL proves
  exactly one winner for a shared invite, initial-passkey registration challenge, active-session
  rotation, pairing, concurrent creation at the 32-source ceiling, concurrent approval at the
  64-live-authority ceiling, passkey-login challenge, and recovery code. Protective races prove
  profile deletion dominates concurrent session rotation, source pause dominates concurrent pairing
  approval, source unlink dominates concurrent device activation, passkey revoke dominates
  concurrent login, recovery-code rotation dominates concurrent old-code start, and recovery
  completion dominates concurrent old-passkey login. Ingest races prove concurrent exact retries
  create one snapshot, two devices for one source/date converge on the monotonic maximum rather than
  sum, source pause precedes a later submission, and device revoke precedes a later submission.
  Opposing-order multi-season payloads both block first on the same lower season and complete
  without an advisory-lock cycle. An ordered origin-replay race proves two contenders for one locked
  expired tuple produce exactly one fresh consume and one replay rejection. A second origin race
  holds the row past a two-second proof expiry, returns `false`, and removes the tuple written after
  that wait. A cleanup race proves one Jobs call retains its transaction lock while a second call
  waits, after which both bounded ingest batches complete without removing live state. A separate
  pairing-cleanup race proves two Jobs callers serialize, delete each expired transaction/key pair
  once, and preserve live pending state. Authentication cleanup has a separate two-worker
  serialization race plus a cross-capability race proving cleanup waits on the same profile-first
  order as recovery start, removes only the old expired authority/code, and preserves the new live
  authority. A separate invite-cleanup race proves two bounded callers serialize on that same
  private auth mutex, delete each expired one-row batch once, and preserve live invite authority. A
  separate session-cleanup race proves two bounded callers serialize on that same private auth
  mutex, delete each expired one-row batch once, and preserve live authority. A separate
  abandoned-enrollment cleanup race proves two workers serialize across the authentication and
  profile-purge mutexes. An activation-overlap race proves cleanup skips the locked enrolling
  profile without waiting, after which initial-passkey activation commits and preserves its redeemed
  invite, passkey, and normal session. A separate pairing-provenance race proves two bounded
  redaction callers serialize across the authentication and pairing mutexes, clear each aged
  approval reference once, and preserve the recent reference plus every activated device binding.
  Primary deletion has a two-worker race plus a cross-capability race proving purge locks its fixed
  five maintenance mutexes in stable order before cascading a profile and before authentication
  cleanup can proceed. A separate CarRecipe-proposal cleanup race proves two bounded workers
  serialize, delete each expired proposal once, and preserve live proposal and active-recipe state.
  A scoring race proves two Jobs refreshes serialize on a private mutex and converge on one semantic
  open-season state. A finalization versus late Ingest race proves the shared
  `season → profile → source → device` lock order is deadlock-free, the final projection is
  terminal, and the late payload remains quarantined. No losing enrollment or rotation artifact
  survives, and no protective race leaves browser, recovery, or pending device authority attached to
  a deleted profile, revoked credential, old code, or protected source. The recovery races also
  prove terminal timestamps are captured after lock acquisition, and missing expected challenge,
  credential, authority, session, code, or pairing rows fail closed rather than passing through SQL
  `NULL` semantics.
- A strict Next.js 16 and React 19 web workspace with a synthetic EN/RU race, accessible
  leaderboard, demo profile, three repository-owned CSS/canvas themes, reduced-motion controls, and
  a deterministic 16-by-8 pixel-car renderer.
- A client payload that contains bounded daily scores and public presentation fields, never raw
  token buckets, account identifiers, source identifiers, URLs, email addresses, or local paths.
- A closed-enum CarRecipe boundary with fixed sprites and palettes; arbitrary HTML, CSS, SVG, URLs,
  colors, text, and uploads are not accepted.
- A local account CarRecipe flow. Three exact same-origin form routes share four-call no-queue
  admission; the server revalidates `CarRecipeV1`, hashes and clears session proof material, creates
  proposal identity/expiry, and exposes only a purpose-separated encrypted control bound to that
  session. The raw proposal/profile IDs never enter HTML. Active and pending recipes are rendered as
  semantic code-native pixels in all three themes with deterministic snapshots. The schema runtime
  stays server-side. The separate public race response exposes only the current approved exact
  recipe of an active profile; proposal state stays private. A separate exact-body signed device
  route can create or replace only the pending recipe and cannot inspect or decide it. The local
  account page, browser create/approve routes, and device proposal route now separately require
  exact `VIBERACING_CAR_PROPOSALS_ENABLED=true` at module evaluation. Disabled mutation cancels an
  available body and returns generic no-store 503 before parsing, runtime/service construction,
  admission, signature/contract proof, or database work; browser service create/approve repeats the
  literal check before recipe/control/session work. Active/private preview and exact session-bound
  reject remain available. The tracked example is false, and this is not dynamic/deployed worker
  control. The local Agent Skill can reduce style intent to that fixed command but gains no read,
  decision, or activation authority. A separate read-only verification skill selects only checked-in
  local gates, reports their exact scope, and cannot mutate the tree or claim live/deployment
  evidence. No live database credential, edge policy, monitoring, capacity result, released
  connector, or deployment is claimed.
- Per-response nonce CSP, browser-isolation and capability headers, no remote image patterns,
  globally disabled Next.js image optimization, production HSTS, disabled framework branding, and an
  explicit Turbopack repository root that prevents parent-workspace inference.
- Device-local persistence limited to locale, theme, and motion preferences. The synthetic preview
  has no accounts, analytics, trackers, remote fonts, or runtime secrets. Its only environment
  setting is a strictly parsed, server-only public origin for absolute social metadata; hosted
  deployment without a real HTTPS DNS value remains forbidden. The separate enrollment slice stores
  account state only in encrypted HttpOnly cookies and reads its exact server-only configuration
  lazily; the default preview still needs none of it.
- Nine hundred unit, component, interaction, security-header, localization, scoring,
  HTTP-route/admission, database-adapter configuration/pool/store, and accessibility tests. The
  coverage gate currently reports 87.45% statements, 86.26% branches, 95.48% functions, and 87.58%
  lines over product components and libraries; framework entrypoints are verified by the production
  build instead of artificial unit coverage.
- A bounded root development pipeline with contract generation/drift, migration/config/public
  boundaries, workspace lint/types/unit tests, and Rust. Coverage, production compilation,
  checker-regression, documentation/history, and publication evidence are isolated in the explicit
  release gate instead of running on every pull request.
- A manifest-driven production artifact gate with nine black-box cases and enforced limits for
  initial raw/gzip bytes, application/CSS gzip bytes, asset count, source maps, fonts, path safety,
  and standalone output. The current initial route is 186,218 gzip bytes across eight assets;
  application JavaScript remains within its separate 10,500-byte budget at 10,246 gzip bytes and CSS
  remains within 5,000 bytes at 4,533 gzip bytes.
- A pinned multi-stage Web production image and root Railway configuration for the default-off
  synthetic preview. The runtime contains only the emitted standalone server and required static
  assets, runs as the unprivileged image user, and exposes the platform-assigned port. A local
  standalone smoke requires the home HTML, referenced CSS/JavaScript, production CSP/HSTS,
  configured public origin, and generic default-off ranking response. This is packaging evidence
  only: no database, OAuth, Ingest, Jobs, edge direct-origin control, real user, or deployed result
  is claimed.
- Three additional pinned multi-stage production images package only the emitted Ingest host,
  default-off Jobs scheduler, or one-shot migration runner and their exact production dependency
  graphs. Their separate Railway configurations fix the reviewed Dockerfile, replica, restart,
  overlap, and drain decisions. Local builds run as the unprivileged image user; disabled executions
  fail closed, and the migration image resolves the exact 43-file catalog. This is packaging
  evidence, not a compatible hosted PostgreSQL service, role provisioning, secret delivery,
  scheduler cadence, migration execution, monitoring, or deployment.
- A dependency-free Cloudflare Worker now admits only exact Community sync, preserves the bounded
  device-signed body, rejects caller-supplied origin authority, and adds one fresh canonical
  HMAC-SHA-256 proof before one no-retry HTTPS origin call. Eighteen Node Fetch/Web Crypto tests
  cover proof, route/header/body, key rotation, failure, response, and dependency bounds. A
  production-build compatibility test requires the generated proof and a synthetic Ed25519 device
  signature to pass `createCommunitySyncVerifier`. Exact-version Wrangler dry-run evidence proves
  only local bundling; no Cloudflare route, account, secret, Railway origin, external TLS,
  direct-origin negative result, provider logging state, WAF, capacity, or deployment is claimed.
- A separate stable-release workflow now accepts only a published non-prerelease stable tag or an
  explicit stable tag dispatched from `main`, proves main ancestry, completes secretless release and
  synthetic PostgreSQL gates, and only then enters the protected `production` Environment. It uses
  pinned Railway/Cloudflare/Wrangler inputs and fixes migration-latch cleanup plus Migration, Web,
  Ingest, Jobs, and Edge order. Eighty configuration-checker cases cover its exact contract, unsafe
  mutations, and the required Next route-type generation before Web TypeScript. Generated
  `next-env.d.ts` and `.next` declarations remain ignored so clean-checkout typechecking cannot
  depend on a maintainer's prior build. This is a local checked declaration: no GitHub Environment,
  protected credential, Railway project, Cloudflare route, hosted run, migration, or deployment is
  proven.
- A lock-integrity-bound metadata cache for platform-specific npm packages, twelve license-checker
  regression cases, and two expiring reviewed overrides: one resolves Next.js to patched
  `postcss@8.5.19`, and one removes unused `sharp`/libvips code while Next.js image optimization
  remains disabled. The official registry audit reports zero known vulnerabilities after resolution.
- A project-generated social preview with accessibility text, checksum/source record, explicit AI
  disclosure, and byte-preserving removal of service C2PA metadata. The public-file gate now parses
  PNG structure and CRCs and rejects unreviewed ancillary chunks; twelve focused policy assertions
  and a malformed-PNG black-box case cover the boundary.
- Eighteen page-only production-rendered Phase 1 viewport baselines covering three viewports, both
  locales, and all three themes with motion disabled. The isolated no-dependency CDP capture rejects
  non-loopback page resources and reviewed header/hero overflow before writing; it found and blocked
  a clipped 320-pixel join link until the responsive navigation wrapped. An offline integrity gate
  enforces the exact matrix, dimensions, byte limits, SHA-256 manifest, and public PNG policy, and
  fifteen CLI guardrail cases, ten request-policy assertions, four exact-environment assertions, six
  pixel-result assertions, five keyboard-policy assertions, six accessibility-tree-policy
  assertions, five forced-colors-policy assertions, fourteen web-vitals-policy assertions, and
  eleven checker mutations prove the entry points fail closed. A separate no-write local gate
  requires the manifest's exact browser product/platform, re-renders all states, decodes both PNGs
  inside that isolated browser, and rejects one changed pixel channel. The current Chrome
  150.0.7871.129 `win32-x64` pair passed all 18 semantic comparisons without changing the manifest.
  That exact no-write run also dispatched real CDP keyboard events over the closed 16-target order,
  proved skip-link focus transfer and Space-driven pause restoration, validated named landmarks,
  links, buttons, comboboxes, the simulator textbox, race image, and trust-captioned table from
  Chromium's full accessibility tree, then repeated the focus order under forced colors while
  checking reviewed borders, horizontal bounds, and the semantic canvas alternative. It finally
  disabled Chromium's network cache and collected three samples per mode on the exact 1280 by 720
  English Classic Grand Prix state using one trusted CDP pointer interaction per sample.
  Animation-on maxima were 168.0 milliseconds LCP, 0.000 CLS, and 16.0 milliseconds for the
  controlled interaction; reduced-motion maxima were 116.0 milliseconds, 0.000, and 40.0
  milliseconds. Closed local regression ceilings are 2,500 milliseconds, 0.1, and 200 milliseconds.
  They are not beta SLOs. The executable itself is operator-reviewed rather than
  provenance/digest-pinned or provisioned in CI. This is not native screen-reader, operating-system
  High Contrast, cross-browser, cross-platform, field Core Web Vitals, representative network/CPU,
  or staging evidence.

The local Compose smoke test pulled the pinned index, reached `healthy`, exposed only
`127.0.0.1:54329`, returned the expected synthetic database and user from a read-only query, and
then removed its test container, network, and volume. The separate database integration project also
reached `healthy`, validated and applied revisions 0001 through 0041 from the checksum manifest,
proved revision 0041 backfilled and froze the exact attribution on a source inserted after revision
0040, passed one pre-restore serialized migration-overlap race with one successful application and
one expected `42P07` rollback, 28-table state/ownership/RLS assertions, forty-five observed
post-restore lock-wait races, one observed early-completion activation overlap, twelve
relation-denial checks, sixty-seven cross-capability denials, and the identity, passkey, recovery,
pairing, source/device lifecycle, Community ingest, origin replay, ingest-retention,
pairing-retention, authentication-retention, invite-retention, session-retention,
abandoned-enrollment retention, primary-profile deletion, terminal deletion-job retention,
audit-event retention, pairing approval-provenance, revoked-passkey retention, revoked-device
retention, pairing-rate-window reset, finalized-source-day retention, CarRecipe proposal/approval
and retention, scoring, finalization, and public score/race/status scenarios, then removed its
portless container, network, and ephemeral storage.

The separate Jobs integration also reached `healthy`, revalidated and applied revisions 0001 through
0041, created only synthetic non-owner logins, rejected the one login with an extra group membership
before its requested reset changed state, and ran all eighteen built Jobs commands through the
narrow login. It observed only the constant success/failure sentences and verified the exact
authentication/abandoned-enrollment/audit-event/invite/CarRecipe-proposal/ingest/pairing/session/
terminal-deletion-job/finalized-source-day/aged-revoked-passkey/aged-revoked-device cleanup, pairing
approval-provenance redaction and subsequent session deletion, pairing-rate-window reset,
profile-purge, current-season refresh, closed-season finalization, and oldest-known historical
season finalization state before removing the loopback-published container, network, and storage. A
second run built the production scheduler core and Jobs runner, injected one fixed UTC clock/timer,
attempted the exact ordered eighteen-job catalog through a deliberately widened login, proved every
private-table fingerprint stayed unchanged, then ran the catalog through the narrow login and
verified the same exact stored-state oracle. A third run advanced the fixed clock by one hour,
invoked the production interval handler twice during the active real-runner cycle, observed the
exact recurring catalog once, proved the same slot produced no jobs, and verified the rearmed
terminal reset. A fourth run composed the production process lifecycle under the fixed clock,
started the penultimate real-runner call before injecting the first signal handler, proved
active-call settlement and no later scheduler job, observed exact graceful cleanup plus exit code 0,
then invoked only the omitted reset before the shared state oracle. A fifth run started the built
scheduler entry point under the real host clock from a link-free read-only runtime under pinned
Linux Node after temporarily revoking only the Jobs role's backlog-function grant. It observed one
generic cycle signal, an unchanged backlog, and later terminal-job settlement before a code-0 OS
`SIGTERM` exit with session release. The harness restored and rechecked the grant, rearmed the
marker, held the scoring mutex, and started the same runtime again. It observed the first
finalization lock-wait, received `SIGKILL`, exited 137, released its session, and left the backlog
plus marker unchanged. After the holder was released, a restart finalized the backlog before a
silent code-0 signal exit. The harness then held a second backlog with a disposable post-insert
barrier, observed its advisory wait after the first daily projection insert, delivered another
`SIGKILL`, and proved the uncommitted season, entry, and daily rows rolled back after session
release. It removed the trigger/function and verified no schema residue before a clean-schema
restart finalized that backlog exactly once. A final rearm/restart proved another silent repeated
cycle, session cleanup after all six starts, unchanged runtime contents, and the same exact state. A
sixth run started the unchanged emitted process from the same bounded runtime shape, observed the
startup refresh, held the scoring mutex until a native minute-timer callback reached refresh in a
later real five-minute slot, delivered a real OS `SIGTERM`, released the mutex, and proved
active-refresh settlement, a newer refresh timestamp, silent code-0 exit, session release, and
unchanged runtime contents. A seventh run used the same bounded runtime shape, held the emitted
first finalization call, delivered a real OS `SIGTERM`, and proved graceful active-call settlement,
no refresh or later job, silent code-0 exit, session release, and unchanged runtime contents before
the seventeen omitted commands completed the shared exact-state oracle. This is local synthetic
application evidence including failure/crash containment, later-job continuation, clean-schema
retry, a later repeated restart, one host-timer recurring refresh, four graceful OS-signal
integration paths, two abrupt active-call `SIGKILL` paths, and one controlled uncommitted
post-insert transaction rollback. It is not recovery from committed/external effects or every Jobs
capability, automatic privilege repair, a deployed signal route, controller/orchestrator grace
policy, managed restart, production credential/TLS result, capacity result, real-user purge,
monitoring backend, durable cadence, or deployment.

These checks are defense in depth. They do not prove that a file is safe, fully decode every binary
format, fully parse/render Mermaid, perform legal analysis, or replace manual staged-diff review and
GitHub secret scanning. Deterministic verification validates external-link policy but does not make
network requests. The hardened online link mode is currently blocked here because this environment
resolves public hosts through a non-public proxy address; it correctly failed closed. The CI
definition is locally parsed and policy-tested but has not run on GitHub because no remote
repository is configured yet.

Local responsive, computed-contrast, interaction, browser-console, development-header,
production-header, exact stored viewport, keyboard, accessibility-tree, forced-colors, and
animation-on/reduced-motion lab-performance observations are recorded in the
[Phase 1 browser matrix](testing/PHASE1_BROWSER_MATRIX.md), including the light-theme contrast and
compact-navigation defects found and corrected during review. The report names its local-only
limitations.

## Phase 0 still pending

- A confirmed public maintainer identity, conduct-reporting channel, CODEOWNERS entry, and remote
  GitHub security/branch settings; private details will not be inferred from the workstation.
- Hosted CI evidence and a successful hardened online-link run from a public-DNS runner.

## Phase 1 still pending

- Provenance/digest-pinned browser-artifact provisioning for root or hosted re-render checks. The
  explicit local gate now requires the manifest product/platform and performs the semantic pixel
  diff, but it accepts an operator-supplied executable and root verification does not launch it.
- Native screen-reader, operating-system High Contrast, and cross-browser release evidence. The
  exact local Chrome CDP keyboard/accessibility-tree/forced-colors gate does not claim these
  results.
- Field Core Web Vitals at the real-user 75th percentile and staging performance measurements under
  representative network/CPU conditions. The exact local gate now covers only three
  cold-browser-cache lab samples per animation state and one controlled interaction per sample.

## Not implemented yet

Invite issuance UI, trusted anonymous login/pairing/recovery edge limits, recovery notification,
deployed Ingest edge routing/external TLS and direct-origin denial, live secret-manager/edge key
injection, the Ingest deployment PostgreSQL credential/TLS connection, distributed rate/backpressure
controls and load evidence, deployed operation of the local Ingest startup latch and public-ranking
and pairing module gates plus the new-source, CarRecipe-proposal, and enrollment module/service
gates, deployed execution and monitoring of retention cleanup for authentication,
abandoned-enrollment, audit-event, invitation, CarRecipe-proposal, ingest, finalized-source-day,
pairing, session, terminal-deletion-job, aged revoked-passkey state, and aged minimized
revoked-device state plus pairing approval-provenance redaction, pairing-rate-window reset, and
primary deletion, cleanup for remaining expiring state, deployed scheduler signal routing and
orchestrator grace policy, deployed operation of the local Jobs scheduler, a production login/TLS
path, audited corrections, deployed public-score delivery, successful isolated staging migration
orchestration/rollback, cache/backup/tombstone purge and restore replay, connector macOS/Linux
executable admission, clean-machine live Codex/privacy evidence, supported operational account/usage
integration, deployed signed-upload egress, credential rotation and automated server-revoke
composition, hosted Windows portable-smoke evidence, installer and real install/upgrade/uninstall
lifecycle, automated diagnostic export/support transport, packaging, release signing, deployment,
and public beta operations remain proposed. The local Ingest key reader, kernel, adapter,
application composer, Fastify server, and separate host now prove bounded protected configuration,
raw-envelope/JSON/HTTP framing, origin-proof, contract, strict Ed25519 device, least-privileged
pool, fixed-query, orchestration, no-queue/deadline policy, exact listener modes, bounded
startup/shutdown, result/problem serialization, and one full synthetic loopback persistence plus
controlled no-queue-contention path plus one positive silent built-entry-point request. A separate
local Linux gate now proves one OS-signalled active request settles with exact HTTP/database state
and silent cleanup, but not Railway/orchestrator drain or those deployed edge, secret, TLS,
representative load/capacity, or operational boundaries. Bounded database score and compatible
active-recipe race projections, versioned response-only schemas, fail-closed server mappers, bounded
PostgreSQL adapters, and local HTTP routes now exist, including URL/media parsing,
admission/deadline policy, store translation, and final serialization. A third compatible local
status projection/contract/route now supplies complete-UTC-day freshness and preference-gated streak
without changing either older response. Cache/invalidation, deployed device-proposal ingress,
authenticated profile detail, client-rate controls, representative/deployed query-plan and
production-capacity evidence, monitoring backend, deployment login, certificate, edge policy, and
live adapter integration do not. The visible web scoring and ranking experience now consumes a
validated current-week status response from the local route when its separately provisioned database
login works, but local defaults and every unavailable/error path remain clearly synthetic. Its
separate score simulator is explicitly hypothetical and never consumes that response or any account
value. A disposable synthetic Web login now has full local HTTP-to-PostgreSQL evidence; no
reusable/deployment database or OAuth login, deployed data, cache, or end-to-end real-user ranking
evidence exists.

## Evidence commands

Run from the repository root:

```text
pnpm run verify
pnpm run verify:release
pnpm run verify:web:deployment
pnpm run check:agent-skills
pnpm run check:documentation-currentness
pnpm run check:contracts
pnpm run check:database
pnpm run check:migration-runbook
pnpm run test:migration-runbook-check
pnpm run check:restore-runbook
pnpm run test:restore-runbook-check
pnpm run check:containment-runbook
pnpm run test:containment-runbook-check
pnpm run check:deletion-failure-runbook
pnpm run test:deletion-failure-runbook-check
pnpm run test:database:integration
pnpm run test:migrate:postgres-integration
pnpm run test:web-query-plan-evidence
pnpm run test:web:postgres-integration
pnpm run test:ingest:coverage
pnpm run build:ingest
pnpm run test:ingest:postgres-integration
pnpm run test:ingest:signal-postgres-integration
pnpm run test:jobs:coverage
pnpm run build:jobs
pnpm run test:jobs-scheduler:coverage
pnpm run build:jobs-scheduler
pnpm run check:jobs-scheduler-entrypoint
pnpm run test:jobs:postgres-integration
pnpm run test:jobs-scheduler:postgres-integration
pnpm run test:jobs-scheduler:timer-postgres-integration
pnpm run test:jobs-scheduler:lifecycle-postgres-integration
pnpm run test:jobs-scheduler:process-postgres-integration
pnpm run test:jobs-scheduler:wall-clock-postgres-integration
pnpm run test:jobs-scheduler:signal-postgres-integration
cargo test --workspace --all-targets --all-features --locked
pnpm run check:web-build
pnpm run check:public:staged
git diff --cached --check
```

The first command is the normal development gate. `verify:release` and the explicit coverage,
production-build, checker-regression, and Docker commands are release or boundary-specific evidence;
they are not required for every local edit.

`pnpm run check:publication` is intentionally failing in this unpublished tree. It becomes a
required passing source-only gate only after the public maintainer identity, CODEOWNERS, GitHub
remote, private vulnerability reporting, and hosted interaction restrictions are real and verified.
Open participation additionally requires a tested private conduct channel.

The staged check reads blobs from the Git index, not potentially different working-tree copies.
Review `git diff --cached` manually before every commit.
