# Vibe Racing repository guidance

## Start here

Read these files before changing the project:

1. `README.md` for product scope and the trust disclaimer.
2. `docs/PROJECT_PLAN.md` for the selected architecture and delivery gates.
3. `docs/architecture/SECURITY_INVARIANTS.md` for non-negotiable behavior.
4. `docs/IMPLEMENTATION_STATUS.md` for claims backed by current evidence.
5. `docs/security/THREAT_MODEL.md` and `docs/security/ABUSE_CASES.md` for attacker stories and
   severity.
6. `docs/security/PRIVACY_DATA_MAP.md` before collecting, logging, caching, exporting, or retaining
   data.
7. `docs/decisions/README.md` for accepted architecture decisions and the ADR process.
8. `docs/security/DEPENDENCY_POLICY.md` before changing dependencies or CI.
9. `SECURITY.md` and `CONTRIBUTING.md` before handling reports or public contributions.
10. `GOVERNANCE.md` and `MAINTAINERS.md` before changing roles, ownership, release, or publication
    state.
11. `docs/operations/MIGRATION_RUNBOOK.md` before preparing or executing a staging migration.
12. `docs/operations/CURRENT_SNAPSHOT_RESTORE_RUNBOOK.md` before changing or rehearsing backup and
    restore behavior.
13. `docs/operations/CAPABILITY_CONTAINMENT_RUNBOOK.md` before changing capability gates or planning
    incident containment and recovery.
14. `docs/operations/PROFILE_DELETION_FAILURE_RUNBOOK.md` before changing, diagnosing, or retrying
    profile deletion.

The repository currently contains a public foundation, a synthetic web prototype, versioned sync,
Community score query/response, compatible race and race-status responses, and CarRecipe contracts,
locally implemented OpenAPI GET and POST operations, bounded server-only PostgreSQL
score/race/status adapters/mappers, a closed public problem-response factory and request/admission
route, and procedure-only identity, passkey, restricted-recovery, pairing, source/device lifecycle,
Community usage-ingest, Jobs-only ingest/pairing/auth/invite/session/abandoned-enrollment/
CarRecipe-proposal/finalized-source-day, terminal-deletion-job, audit-event, revoked-passkey, and
revoked-device retention plus pairing approval-provenance redaction and fixed pairing-rate-window
reset, primary profile deletion, session-owned CarRecipe proposal/approval, and open-season
Community scoring plus explicit latest and no-argument oldest-known historical terminal finalization
and bounded public score-projection database slices. A local one-shot Jobs runner now invokes only
those eighteen reviewed maintenance functions through a probed least-privileged login contract. An
opt-in synthetic integration runs all eighteen emitted CLI commands against one disposable
least-privileged PostgreSQL login and proves a widened-login denial plus exact stored state. A
separate default-off local Jobs scheduler now derives only the latest grace-eligible Community
season, one oldest data-backed historical season per hour, and the current UTC week, invokes the
closed catalog sequentially without overlap, retains slot state only in memory, and bounds
first-signal shutdown. A second opt-in synthetic integration composes that production scheduler core
under a fixed injected UTC clock/timer with the real Jobs runner and one disposable PostgreSQL
database; it proves the exact ordered catalog, full private-table non-mutation for a widened login,
and exact narrow-login stored state. A third advances that fixed clock by one hour, invokes the
production interval handler twice while the real-runner cycle is active, proves exact
recurring-catalog execution plus overlap and same-slot suppression, and verifies the rearmed
terminal reset. A fourth composes the production process lifecycle under the fixed clock, injects
its first signal during the penultimate database job, proves that active call settles and the later
scheduler job does not start, and exits through the graceful cleanup path; the harness invokes the
omitted reset only afterward before the shared exact-state oracle. A fifth packages only the built
scheduler, built Jobs runner, and exact installed production dependency graph into a link-free
read-only runtime under a pinned Linux Node image. Before the first real-clock start, the harness
revokes only the Jobs role's backlog-function execution grant in disposable PostgreSQL. The process
emits one generic cycle-failure line while the terminal marker proves later jobs still settled, then
accepts a real `SIGTERM`, exits with code 0, and releases its session without creating the backlog
season. The harness restores and rechecks that exact grant, rearms only the two marker rows, holds
the scoring mutex, and starts the same runtime again. It observes the first finalization call
waiting in PostgreSQL, delivers `SIGKILL`, requires exit code 137 plus session release, and proves
the backlog and terminal marker remain unchanged. After releasing the holder, a restart finalizes
the backlog before a silent code-0 signal exit. The harness then rearms the marker, installs one
disposable `AFTER INSERT` barrier for a second backlog, and starts the same runtime again. It
observes that exact backlog call waiting only after a daily projection insert, delivers `SIGKILL`,
requires exit 137 plus session release, and proves the season, entry, and daily rows rolled back
while the source/day input and terminal marker remain. It removes the test-only trigger/function,
verifies no schema residue, and a clean-schema restart finalizes that backlog exactly once. A final
rearm/restart proves one more silent repeated cycle before requiring no scheduler sessions, the
unchanged runtime fingerprint, and exact state across all six starts. A sixth uses the same bounded
runtime shape. Under the unchanged native clock and minute interval it waits for startup, holds the
scoring mutex until a later real five-minute slot reaches the production refresh call, delivers a
real `SIGTERM`, releases the holder, and requires that refresh to commit with a newer timestamp
before silent code-0 exit, session release, and an unchanged runtime fingerprint. A seventh uses the
same bounded Linux runtime shape, holds the first finalization call in PostgreSQL, delivers a real
`SIGTERM`, then proves that call settles, no later job starts, the emitted process exits silently
with code 0, its session closes, and the runtime fingerprint is unchanged. The injected-timer result
still does not prove a host-timer callback. All three emitted gates are local synthetic
failure/crash/retry, restart, native-timer, and OS-signal evidence only. The process gate proves one
controlled uncommitted post-insert PostgreSQL transaction rollback; none proves recovery from
committed or external side effects, every Jobs capability, automatic privilege repair, a deployed
replica or signal path, controller/orchestrator grace, managed restart, durable cadence, production
login/TLS result, monitoring, or capacity evidence. A local default-off one-shot migration runner
now loads only the exact repository manifest/file inventory, revalidates every source digest, probes
one distinct owner-member login, holds the fixed session advisory lock, rereads an exact ledger
prefix, and applies only remaining reviewed SQL bodies before requiring the complete ledger. A
separate opt-in synthetic integration runs a widened-login emitted process and two narrow-login
emitted processes against one disposable certificate-verified PostgreSQL database. It proves
widened-login denial before schema creation, observes both narrow controllers behind one external
holder, requires both to converge successfully after release, and verifies the exact 40-row ledger,
all 28 forced-RLS private tables, identity invariants, TLS, and connection/lock cleanup. It has no
production credential/TLS, deployed replica, staging orchestration/rollback, monitoring, deployment,
or recovery result. A checked staging migration and forward-recovery runbook now binds eighteen
ordered operator controls and seven exact commands to that runner; thirteen unsafe or drifted
variants fail closed. It contains no protected values and proves no staging execution, production
authorization, monitoring, stale-backup deletion replay, recovery, or deployment. A local Ingest
kernel bounds the raw sync envelope and parser, verifies an injected replay-consumed origin proof,
validates the sync contract, and strictly verifies the source-bound device request. A protected
local reader supplies one mandatory and one optional rotation proof key from exact namespaced
configuration without returning a reusable key container. A separate bounded Ingest PostgreSQL
adapter wraps only reviewed origin replay, device lookup, and submission procedures through a probed
least-privileged login contract. A forced-RLS origin replay tuple and separate Jobs
ingest/pairing/auth/invite/session/abandoned-enrollment/CarRecipe-proposal/finalized-source-day,
terminal-deletion-job, audit-event, revoked-passkey, and revoked-device cleanup plus pairing
approval-provenance redaction capabilities have isolated PostgreSQL evidence. A transport-free
Ingest application boundary now composes those exact capabilities, generates one server request ID,
and returns only a validated sync acknowledgement or generic problem decision. A confined Fastify
server factory now preserves raw body/header evidence, applies no-queue/deadline policy, and
serializes only revalidated sync contracts. A separate local Ingest host now binds that exact
composition under closed loopback or Railway-edge configuration only after an exact default-off
startup enable latch, cleans up every partial startup, and handles SIGINT/SIGTERM under a fixed
deadline without reflective output. The latch fails before protected application configuration or
resource creation but is not a deployed dynamic kill switch. An opt-in synthetic loopback
integration now builds that host, creates a disposable least-privileged Ingest login in one
ephemeral PostgreSQL container, sends independently signed HTTP requests, and proves accepted,
duplicate, persistent origin-replay, revoked-device, response-contract, and exact persistence
behavior. It also holds four independently signed requests at the first replay-store call, rejects a
fifth with generic 503 without a fifth replay call, then releases and proves all four accepted
before closing the imported host. The same gate then starts the built entry point as a separate
silent process, observes its loopback listener without application work, proves one more exact
accepted request, and forcibly ends only that test child before removing the container. This does
not prove its own graceful emitted-child settlement. A separate gate constructs a link-free exact
production runtime under the pinned Linux Node image, blocks one independently signed request at the
origin-replay call, delivers a real `SIGTERM`, releases the lock before the database deadline, and
proves the exact acknowledgement and stored state, silent code-0 host exit, session release, and
immutable runtime contents. It does not prove deployed signal routing, Railway/orchestrator drain,
external TLS, protected secret delivery, representative capacity, or deployment. The three public
score/race/status routes now share a second exact default-off module-load gate before query/header
parsing, admission acquisition, or storage work. Their visible current-week browser consumer retains
rounded freshness, optional preference-gated streak, and an explicit validated synthetic fallback
while the tracked gate is false. Connector pairing start/poll and signed-in approval
options/verification now use a third exact default-off capability gate, independently resolved at
module load before request parsing, runtime/service construction, admission acquisition, protected
configuration, or database work. A fourth exact default-off decision now independently prevents
new-source approval initiation and completion unless the `/connect` page and both browser approval
modules resolved exact enablement; active existing-source pairing remains available, and the source
choice is sealed and digest-bound to the passkey challenge. A fifth exact default-off decision now
closes browser proposal creation, browser approval, and device proposal ingress before request or
state work; account UI preserves active/private previews and exact rejection. A sixth exact
default-off decision now closes the invite/OAuth/initial-passkey enrollment pages, HTTP routes, and
service methods while returning login and recovery remain available. None of these local gates is a
deployed dynamic kill switch. A checked capability-containment and recovery rehearsal runbook now
binds those five Web decisions plus Ingest, Jobs-scheduler, and migration startup decisions to 24
ordered controls, eight exact commands, process-replacement semantics, preserved security/deletion
paths, and recovery of one capability at a time. Twenty-two unsafe or drifted variants fail closed.
It proves no private reporting channel, deployed controller, dynamic switch, monitoring,
containment, or recovery. The public home also has a local-only EN/RU score simulator that persists
or transmits no hypothetical input; the stable score and legacy race response contracts remain
unchanged. These local boundaries include one opt-in synthetic path through two emitted standalone
Next production processes and a disposable narrow Web login over ephemeral self-signed
certificate-verified PostgreSQL transport, with widened-login denial, exact public contracts,
`pg_stat_ssl` evidence, full private-table non-mutation, and six parameter-redacted bounded
`auto_explain` plan oracles covering the three adapter calls and three nested projections through
their reviewed indexes without mutation, temporary I/O, or retained logs. The same path holds four
score reads behind a controlled database lock, rejects a fifth request without adding a fifth
public-score query, and settles the original four after release. They still have no deployment proof
key or secret-manager binding, deployment certificate/login, externally verified TLS/edge route,
representative plan/load/capacity evidence, deployment, or real-data result. A separate local
enrollment slice now implements exact invite parsing, GitHub OAuth state plus PKCE with no extra
scope, purpose-separated encrypted cookies, atomic profile enrollment, required initial WebAuthn
registration plus pending-session rotation, returning discoverable-credential passkey login, a
session-scoped minimal passkey inventory, an account page, same-origin public-profile hide/show, a
session-derived active-device inventory, immediate source pause, passkey-protected paused-source
reactivation, immediate owned-device revoke, passkey-protected terminal source unlink,
backup-passkey addition, revocation of an owned non-current passkey, fresh-passkey recovery-code
rotation with one-time plaintext display, an exact-handle fresh-passkey profile-deletion request,
one-time recovery-code replacement-passkey sign-in, and logout through the same probed read-write
Web/Auth pool. Login options retain their profile-free challenge only in a purpose-separated cookie;
valid proof atomically creates and consumes its database challenge while minting the session.
Recovery performs bounded Argon2id verification under a protected pepper, creates only a five-minute
restricted authority, verifies the replacement WebAuthn ceremony, and returns a normal session only
after atomic completion. It has an exact-session CarRecipe editor that validates one closed version
1 object, stores at most one 24-hour private proposal, previews active/pending recipes in all three
themes, and activates or rejects only through an encrypted session-bound control. A separate bounded
device-authenticated route and fixed connector command can only create or replace that pending exact
recipe for an active source-bound device; they cannot read, approve, reject, or activate it. A
separate compatible race projection exposes only an active profile's current approved recipe;
proposal state stays private. A separate bounded Jobs-only capability physically removes expired
proposals locally, and the default-off scheduler plus the combined synthetic PostgreSQL integration
exercise it, but no deployed cadence, production login, monitoring, or deployment is proven. The
enrollment slice has only injected/synthetic evidence and no invite issuer UI, working OAuth or
database credential, distributed recovery attempt controls, deployed cleanup/deletion cadence or
notification, cache/backup/tombstone purge, restore replay, edge abuse controls, or deployment.
Bounded expired authentication/invite/CarRecipe-proposal/session, finalized source/day, aged
revoked-passkey, and aged minimized revoked-device/pairing cleanup plus primary profile deletion
exist locally. Finalized source/day cleanup retains a smaller UTC-day/count projection and waits 30
days after terminal finalization. Activated pairing approval references can be redacted locally
after 180 days, and an unreferenced revoked-device binding can be removed only after both its
activation and revocation have crossed the 180-day boundary. These capabilities are catalogued in
the default-off local scheduler and exercised together in the combined synthetic PostgreSQL
integration, but have no deployed retention evidence. A library-only Rust connector foundation now
implements a bounded stable App Server JSONL handshake and a candidate-only `0.144.5` account/usage
parser with checked schema/fixture evidence. A one-shot supervisor composes that sequence with fixed
local pipes, arguments, deadlines, output budgets, ambient-environment clearing, and
reap-before-success behavior, but its reviewed-launch capability has no public constructor. An
exact-body composer now consumes that minimized usage behind a second inaccessible reviewed context
and fixes the versioned JSON/digest/LF message. An isolated one-use signer consumes that otherwise
inaccessible material with a device-bound key capability that also has no public constructor,
returning only the same body and five exact signed header values. A separate inaccessible
pending-key/challenge signer and pure server-only Web verifier now agree on one exact synthetic
pairing-possession proof. A transport-free Web/Auth start application creates nine-minute pending
transactions from closed device metadata with fresh server IDs, poll tokens, challenges, 60-bit
human codes, and separate protected poll/code verifiers through the fixed read-write Web pool. A
second activation application performs protected poll lookup, runs the strict proof, and alone
invokes exact activation with server-owned IDs behind fixed admission and timing. A local signed-in
`/connect` flow now counts pending-code attempts on the exact session, renders bounded device
metadata plus a full public-key fingerprint, offers a new source or an active owned source through
an encrypted session-bound control, and requires a separate fresh passkey assertion before atomic
new/existing-source approval. A closed local start/poll HTTP boundary now shares four-call
admission, applies a fixed-storage global-and-64-bucket PostgreSQL rate policy, and serializes only
the versioned contracts; it and both signed-in approval routes remain unavailable unless their
modules resolve exact `VIBERACING_PAIRING_ENABLED=true`. A bounded Rust `connect` command generates
one Ed25519 key through the OS CSPRNG, stores its versioned state only in the native credential
store, resumes polling, and persists the activated binding without printing bearer or key material.
A separate exact `forget-local` command deletes only the canonical origin/label native entry without
loading it or contacting the service, and states that it did not revoke server device authority. A
separate explicit `check-codex` command reuses only the bounded exact Windows candidate admission
without an origin, credential-store access, Codex process, account read, persistence, or network,
and reports that no version is supported. Its opt-in diagnostic preview emits only a closed local v1
summary of compile-time version, fixed platform contract, admission class, and empty support state;
it retains failure status, omits local values, and neither saves nor sends output. A separate
Windows x86_64 development `sync` command can construct the private launch/context/key capabilities
only after active-record review and either bounded fixed-name `PATH` discovery or explicit-path
admission of the exact `0.144.5` artifact. It then sends one fixed signed request and validates one
closed acknowledgement without retry or edge-origin headers. A separate fixed `propose-car` command
starts no Codex process, accepts only exact enum flags and a bounded seed, signs one fresh
proposal-domain request with the same active native key, sends once without retry, and validates
only a generic acknowledgement. A checked local Agent Skill now reduces a styling request to those
exact fields, requires explicit shell-safe origin/label values, invokes only that command once, and
receives no read, approval, or activation authority. A separate Windows release-profile smoke copies
the repository-built `0.0.0` connector into a bounded temporary directory, checks only exact help
and missing-candidate behavior with a cleared environment, verifies digest/inventory stability, and
removes the copy. Secretless no-upload CI declares the same `windows-2025` job, but no hosted pass
is claimed from the local tree. There is still no supported version, macOS/Linux admission,
clean-machine real-account result, real package install/upgrade/uninstall lifecycle, credential
rotation or automatic server-revoke composition, packaging, release, live pairing result, deployment
Ingest credential/TLS result, edge deployment, or capacity evidence. Do not claim that deployed
browser/session HTTP authentication, production-ready recovery or remaining unimplemented
critical-action verification, real-user ingestion, an operational connector, a deployed Jobs
scheduler or deployed public-race read, season correction, deployed cleanup cadence or broader
cleanup, deployment, or a hosted security control exists until its implementation and verification
are present in the working tree.

A separate transport-free Admin invitation kernel now requires one exact injected
Access/admin/fresh-passkey decision, an acknowledged external authorization audit event, a second
non-regressing clock check, the single probed Admin database capability, and an acknowledged
committed audit event before returning one fixed seven-day beta invite. A local prerequisite now
validates only the exact `Cf-Access-Jwt-Assertion` against a protected current/previous RS256 JWKS
snapshot, exact issuer/single audience, human application token, one-hour maximum lifetime, and
individual opaque-member map before returning a redacted actor identity. It does not consume a
passkey or create the complete authorization decision. There is still no complete authorization or
audit adapter, host, listener, page, CLI, operational issuer, real Access policy/token/key refresh,
or deployment evidence. One opt-in synthetic integration composes the built invitation kernel and
injected ports with a disposable hostname-verified TLS PostgreSQL database, proves extra-membership
denial, and verifies one exact invite/database-audit result through the narrow login.

A second checked local Agent Skill now selects only repository-owned read-only verification from the
real Git scope, distinguishes focused, root, staged, history, synthetic, and live evidence, and has
no edit, staging, commit, installation, network, publication, push, or deployment authority.

A separate checked profile-deletion failure rehearsal runbook binds the atomic Web request,
Jobs-only maximum-ten purge, separate 30-day terminal retention, scheduler catalog, and existing
rollback/role/race evidence to 26 controls and ten commands. Twenty-five unsafe or drifted variants
fail closed. It preserves confirmed request lock-down, permits only one reviewed deployment-owned
retry, and proves no automatic retry, monitoring, notification, cache/backup purge, stale-backup
replay, real-user deletion, recovery, or deployment.

## Repository map

- `.agents/skills/viberacing-propose-car/` contains the checked local conversational reducer for the
  fixed proposal-only connector command. It is not an installer or released connector workflow.
- `.agents/skills/viberacing-verify/` contains the checked read-only repository verification
  workflow. It cannot edit, stage, commit, install, access live services, publish, push, or deploy.
- `docs/` contains public canonical plans, status, threat/privacy/abuse models, architecture,
  compatibility, ADRs, and policy.
- `.github/` contains read-only pull-request CI, dependency-update configuration, and structured
  public-safe contribution forms.
- `scripts/` contains repository verification and black-box policy tests.
- `config/` contains reviewed external-host and dependency-license policy; do not widen either
  allowlist as a workaround for a failing check.
- `apps/admin/` contains the transport-free bounded Access/member verifier, beta-invitation
  application, required injected complete-authorization/audit ports, and single-capability Admin
  PostgreSQL adapter. It is not an Admin UI, API, CLI, host, fresh-passkey verifier, or working
  issuer. Read `apps/admin/AGENTS.md` before editing it.
- `apps/web/` contains the synthetic Next.js frontend, default-off local public score/race/status
  routes and adapters, default-off bounded invite/OAuth/initial-passkey enrollment,
  returning-passkey login, private account controls, and passkey-protected recovery-code rotation
  and replacement-passkey sign-in, plus the pure pairing-possession verifier, default-off local
  pairing start/poll and approval routes, the independent default-off new-source approval control,
  their applications, and the independent default-off CarRecipe proposal mutation control plus
  nested agent guidance. Read `apps/web/AGENTS.md` before editing it.
- `apps/jobs/` contains the bounded local one-shot maintenance runner and nested least-privilege
  guidance. Read `apps/jobs/AGENTS.md` before editing it.
- `apps/jobs-scheduler/` contains the separate default-off fixed UTC catalog, sequential invocation,
  and bounded process lifecycle. Read `apps/jobs-scheduler/AGENTS.md` before editing it.
- `apps/migrate/` contains the separate default-off one-shot reviewed migration controller, exact
  catalog loader, narrow owner-member login probe, and fixed session-lock/ledger state machine. Read
  `apps/migrate/AGENTS.md` before editing it.
- `apps/ingest/` contains the bounded Community sync request-verification kernel, fixed PostgreSQL
  adapter, transport-free application composition, confined HTTP server factory, and nested security
  guidance. Read `apps/ingest/AGENTS.md` before editing it.
- `apps/ingest-host/` contains the separate closed listener configuration, startup composition, and
  bounded process lifecycle. Read `apps/ingest-host/AGENTS.md` before editing it.
- `contracts/v1/` contains canonical public JSON Schemas and authentication policies;
  `contracts/generated/` contains drift-checked derivatives.
- `compat/codex/` contains candidate/supported exact-version App Server evidence. Candidate
  manifests must remain outside the public support matrix.
- `packages/contracts/` contains generated TypeScript types plus the bounded runtime validator and
  nested security guidance. Read `packages/contracts/AGENTS.md` before editing it.
- `database/` contains the SQL migration ledger, non-login role bootstrap, identity/source/device
  persistence, and real PostgreSQL invariant tests. Read `database/AGENTS.md` before editing it.
- `crates/connector/` contains the bounded App Server JSONL handshake, candidate exact-version
  account/usage parser, inaccessible one-shot child supervisor, synthetic process fixture,
  exact-body sync composer, isolated pairing/sync signers, the native-store `connect` command, the
  local-only `forget-local` command, credential-free candidate-only `check-codex` diagnostic and
  redacted preview, exact-candidate one-shot `sync` command, fixed proposal-only `propose-car`
  command, and nested connector security guidance. Read `crates/connector/AGENTS.md` before editing
  it.
- `package.json`, `pnpm-workspace.yaml`, and `Cargo.toml` define the pinned monorepo workspaces.
- `compose.yaml` provides disposable loopback-only PostgreSQL for local development.
- Trusted Ingest edge routing/external TLS deployment, the distributed recovery perimeter and
  cleanup, and released or scheduled connector layers are not present yet; follow
  `docs/PROJECT_PLAN.md` when they are introduced.

## Verified commands

- `pnpm run verify` runs public-data/history, checker regression, documentation/link, spelling,
  license inventory, formatting, Markdown, configuration, workflow-policy,
  Admin/contract/Ingest/Jobs/Jobs-scheduler/migration-runner/frontend
  lint/type/coverage/production-build, and Rust formatting/check/test/Clippy gates.
- `pnpm run verify:node` runs the same deterministic gates except Rust; CI runs Rust separately.
- `pnpm run check:agent-skills` derives the proposal skill's enum inventory, CLI flags, generic
  output, and both skills' metadata from canonical sources, then binds the verification skill to the
  root scripts and pinned pnpm policy. `pnpm run test:agent-skills-check` proves 25 unsafe/drifted
  variants fail closed.
- `pnpm run check:public:staged` scans the exact staged blobs before a commit.
- `pnpm run check:community` validates governance and community-health files and forms.
- `pnpm run check:architecture` validates required security/architecture contracts, structured abuse
  cases, ADR metadata/indexes, compatibility fail-closed state, privacy classes, and Mermaid fence
  structure.
- `pnpm run lint:admin`, `pnpm run typecheck:admin`, `pnpm run test:admin:coverage`, and
  `pnpm run build:admin` verify the transport-free exact Access/JWKS/member boundary, RS256
  assertion/claim checks and redacted identity, invitation authorization/audit ordering, one-time
  credential construction, ambiguous-failure suppression, protected database configuration, pre-role
  login/TLS denial probe, fixed role assumption and single-capability query, reset-before-reuse,
  client cleanup, and dependency confinement. They use synthetic Access keys and injected
  complete-authorization/audit/pool fixtures and prove no Admin host, real Access policy/token/key
  refresh, passkey, external audit backend, production login/TLS, or deployment.
- `pnpm run test:admin:postgres-integration` builds the production Admin workspace, applies the
  reviewed migration ledger to one disposable hostname-verified TLS PostgreSQL container, rejects a
  deliberately widened login before private-state mutation, and proves the narrow login writes one
  exact active invite plus its database audit row without non-target mutation before role reset and
  connection cleanup. Complete authorization and external audit remain injected; this proves no
  host, production credential/certificate, real Access policy/token/key refresh, passkey, external
  sink, capacity, monitoring, or deployment.
- `pnpm run check:codex-compatibility` validates canonical exact-version manifests, extract/fixture
  digests, fixed stable methods, safe paths, evidence inventory, and candidate/matrix separation.
- `pnpm run test:connector:windows-portable` builds the locked Windows x86_64 release profile,
  copies it under one bounded temporary root, checks only the exact CLI surface and
  missing-candidate failure, revalidates its digest/inventory, and removes the copy. It is not an
  installer, package, hosted result, signature, provenance, release, or support claim.
- `pnpm run check:contracts` validates bounded JSON Schema structure, authentication-policy
  inventory, the connector writable-field allowlist, generated TypeScript/OpenAPI drift, and
  version-manifest integrity.
- `pnpm run check:history` scans every reachable ref, commit message, historical path, text blob,
  and printable binary metadata; it refuses shallow history.
- `pnpm run check:external-links` enforces HTTPS and the reviewed host policy without network
  access. `pnpm run check:external-links:online` additionally pins public DNS results and refuses
  redirects; it is a trusted/manual or hosted scheduled check, not a pull-request network gate.
- `pnpm run check:spelling` checks English documentation and repository text offline. Technical
  words require deliberate review before entering `cspell.json`.
- `pnpm run check:licenses` compares lockfiles, installed manifests, direct notices, external
  artifacts, and the committed dependency inventory. After reviewing a dependency/license change,
  regenerate with `node scripts/check-licenses.mjs --write`, inspect the entire JSON diff, and rerun
  the check; never regenerate merely to silence a failure.
- `pnpm run dev:web` starts the synthetic site on loopback. `pnpm run lint:web`,
  `pnpm run typecheck:web`, `pnpm run test:web:coverage`, and `pnpm run build:web` are focused web
  gates. `pnpm run check:web-build` enforces the production asset/privacy budget after a build;
  focused gates do not replace root verification.
- `pnpm run test:web-query-plan-evidence` runs the deterministic parser/oracle fixtures without
  Docker. It proves missing, malformed, leaking, mutating, sequential, unindexed, or over-budget
  variants fail closed; root `verify` includes it.
- `pnpm run test:web:postgres-integration` builds the Web standalone output, creates ephemeral
  self-signed test-only TLS material, and starts one TLS-enabled disposable PostgreSQL container
  plus two sequential emitted Next production processes on loopback. The reviewed `pg` driver is
  bundled into the standalone server instead of depending on an external package link. The gate
  proves all three public-ranking GETs fail generically through an extra-membership login without
  private-table mutation, then validates their exact score/race/status contracts through a narrow
  `viberacing_web` login, observes TLS 1.2 or 1.3 in `pg_stat_ssl`, and confirms the successful
  reads remain non-mutating. The same test-only narrow login receives database-scoped,
  superuser-provisioned `auto_explain` settings with parameter logging disabled. A bounded parser
  requires the three adapter and three nested projection plans, their reviewed indexes, at most 32
  output rows, one execution, no mutation/locking node, no dirty/written or temporary block, and no
  sequential scan of the bounded-index relations; plan logs are private-marker scanned, discarded,
  and removed with the container. It then observes four lock-waiting score queries, requires a fifth
  request to fail generically without adding a fifth public-score query, releases the controlled
  lock, and validates all four original responses. It proves no deployment certificate/login,
  external TLS/edge path, cache, edge policy, monitoring, representative plan/load/capacity,
  real-user data, or deployment.
- `pnpm run check:phase1-visual-baselines` verifies the exact 18-image synthetic viewport matrix,
  dimensions, digests, byte limits, and public PNG policy without launching a browser.
  `pnpm run verify:phase1-visual-baselines -- --origin <loopback-http-origin> --browser <absolute-path-to-reviewed-chromium>`
  is an explicit no-write re-render gate: it requires the manifest's exact browser product and
  platform and zero changed decoded pixels, then audits the closed keyboard order, skip-target
  focus, named accessibility tree, forced-colors presentation, and three cold-browser-cache
  LCP/CLS/controlled-interaction samples in both animation-on and reduced-motion states. It does not
  authenticate or provision that executable and is not native screen-reader, cross-browser, field
  Core Web Vitals, or staging SLO evidence.
  `pnpm run capture:phase1-visual-baselines -- --origin <loopback-http-origin> --browser <absolute-path-to-reviewed-chromium> --write`
  is an explicit local regeneration command that uses a temporary profile and page-only output; it
  is not a root or pull-request browser gate, and every regenerated diff still requires manual
  review.
- `pnpm run lint:jobs`, `pnpm run typecheck:jobs`, `pnpm run test:jobs:coverage`, and
  `pnpm run build:jobs` verify the local one-shot Jobs boundary, including bounded session,
  abandoned-enrollment, terminal deletion-job, audit-event, aged revoked-passkey, and aged
  revoked-device cleanup plus pairing approval-provenance redaction and fixed pairing-rate-window
  reset. They use injected fakes and do not by themselves prove a database login, external audit
  sink, recurring invocation, production TLS, monitoring, capacity, or deployment.
- `pnpm run lint:jobs-scheduler`, `pnpm run typecheck:jobs-scheduler`,
  `pnpm run test:jobs-scheduler:coverage`, `pnpm run build:jobs`, `pnpm run build:jobs-scheduler`,
  and `pnpm run check:jobs-scheduler-entrypoint` verify the separate exact-default-off scheduler,
  closed UTC catalog, no-overlap cycle, failure containment, and bounded signal lifecycle. They use
  a fake runner/clock/timer and by themselves establish no database execution, deployed replica or
  cadence, production login/TLS, monitoring, capacity, or real-user retention.
- `pnpm run lint:migrate`, `pnpm run typecheck:migrate`, `pnpm run test:migrate:coverage`,
  `pnpm run build:migrate`, and `pnpm run check:migrate-entrypoint` verify the separate
  exact-default-off one-shot controller, canonical manifest/digest loader, narrow owner-member
  login/result probe, fixed session lock, exact ledger convergence, failure cleanup, generic output,
  and built disabled startup. They use injected pools and do not establish PostgreSQL execution,
  concurrent-controller behavior, production login/TLS, staging orchestration/rollback, replica
  coordination, deployment, or recovery.
- `pnpm run check:migration-runbook` binds the checked staging operator document to eighteen ordered
  controls, seven exact root/package commands, the runner's exact enablement decision, generic
  success output, and forward-only policy. `pnpm run test:migration-runbook-check` proves thirteen
  missing, unsafe, or drifted variants fail closed. These are static public-document checks, not
  protected staging execution, production authorization, monitoring, recovery, or deployment.
- `pnpm run check:restore-runbook` binds the isolated current-snapshot rehearsal document to twenty
  ordered controls, four exact root commands, the disposable `postgres-test`/`tmpfs` boundary, and
  the existing two-restore archive/digest/RLS/ACL/race oracle. `pnpm run test:restore-runbook-check`
  proves sixteen missing, unsafe, or drifted variants fail closed. These are public
  local-prerequisite checks, not external backup, stale-backup deletion replay, real-user restore,
  RPO/RTO, staging, production, recovery, or deployment evidence.
- `pnpm run check:containment-runbook` binds the capability-containment rehearsal document to 24
  ordered controls, eight exact root commands, eight exact-default-off source decisions, 20 Web
  module-load bindings, seven tracked false defaults, absent tracked migration enablement,
  process-latch semantics, and preserved security/deletion paths.
  `pnpm run test:containment-runbook-check` proves 22 unsafe or drifted variants fail closed. These
  are static local-prerequisite checks, not a private report, deployed control plane, dynamic kill
  switch, monitoring, containment, recovery, or deployment.
- `pnpm run check:deletion-failure-runbook` binds the profile-deletion failure rehearsal document to
  26 ordered controls, ten exact root commands, atomic Web request/cookie settlement, the Jobs-only
  maximum-ten due-job purge, five private mutexes, exact runtime-role denial, separate 30-day
  terminal retention, scheduler order, rollback/preservation SQL evidence, and both disposable
  PostgreSQL integrations. `pnpm run test:deletion-failure-runbook-check` proves 25 unsafe or
  drifted variants fail closed. These are static local-prerequisite checks, not raw/shared database
  execution, automatic retry, monitoring, notification, cache/backup purge, stale-backup replay,
  real-user deletion, recovery, or deployment.
- `pnpm run test:migrate:postgres-integration` builds the emitted migration entry point, creates one
  disposable certificate-verified PostgreSQL database plus synthetic narrow and widened logins,
  proves widened-login denial before schema mutation, observes two narrow controllers behind one
  external advisory-lock holder, and requires both to converge on the exact 40-row ledger and 28
  forced-RLS private tables before checking identity invariants and resource cleanup. It proves no
  production credential/TLS, deployed replica, staging rollout/rollback, monitoring, deployment, or
  recovery.
- `pnpm run test:jobs:postgres-integration` uses one disposable PostgreSQL container with a
  synthetic narrow Jobs login. It runs all eighteen emitted CLI commands, proves an extra-membership
  login fails before mutation, validates generic process output and exact stored state, and removes
  the container, network, and storage. It proves no external audit sink, combined scheduler
  execution, production credential/TLS path, monitoring, capacity, real-user retention, or
  deployment.
- `pnpm run test:jobs-scheduler:postgres-integration` builds the production scheduler core and Jobs
  runner, injects one fixed UTC clock/timer, and runs the exact ordered eighteen-job catalog against
  one disposable PostgreSQL database. It fingerprints every private table to prove a deliberately
  widened login cannot mutate state, then verifies exact stored effects through the narrow login. It
  does not run the emitted scheduler process or prove deployed cadence, production credential/TLS,
  monitoring, capacity, real-user retention, or deployment.
- `pnpm run test:jobs-scheduler:timer-postgres-integration` retains that fixed-clock composition,
  advances it by one UTC hour, invokes the production interval handler twice while the real-runner
  cycle is active, proves the exact recurring catalog plus overlap and same-slot suppression, and
  verifies the rearmed terminal reset. It does not prove host-timer delivery, an emitted recurring
  callback, durable cadence, or deployment.
- `pnpm run test:jobs-scheduler:lifecycle-postgres-integration` composes the production process
  lifecycle with the fixed-clock scheduler and real Jobs runner. It injects the first handler during
  the penultimate database job, requires that call to settle, proves the later scheduler job never
  starts, and requires exact interval/deadline/handler/runner cleanup plus exit code 0. The harness
  invokes only the omitted reset afterward before the shared exact-state oracle. It does not prove
  OS-signal delivery, an emitted-process graceful exit, recurring cadence, or deployment.
- `pnpm run test:jobs-scheduler:process-postgres-integration` starts the built scheduler entry point
  from a link-free read-only production-only graph under pinned Linux Node with the real clock and
  exact enable/configuration environment. The harness temporarily removes only the Jobs role's exact
  backlog-function execution grant. The first process emits one generic cycle-failure line, leaves
  that backlog unchanged, reaches the later terminal marker, and exits with code 0 after an OS
  `SIGTERM`. The harness restores and verifies the grant, rearms the marker, holds the scoring
  mutex, and starts the same runtime again. It observes the first finalization lock-wait, delivers
  `SIGKILL`, requires exit 137 and session release, and proves the backlog plus terminal marker are
  unchanged. After the holder is released, a restart finalizes the backlog and exits silently. The
  harness then uses a disposable post-insert barrier to stop a second backlog after its first daily
  projection insert, delivers a second `SIGKILL`, and proves complete transaction rollback after
  session release. It removes and verifies absence of the test-only schema objects before a
  clean-schema restart finalizes that backlog exactly once. A final rearm/restart proves one more
  silent repeated cycle. All six starts leave no scheduler sessions, and the runtime fingerprint
  remains unchanged. This proves local failure/crash containment, restart retry, and one controlled
  uncommitted PostgreSQL partial-write rollback, not recovery from committed/external effects or
  every Jobs capability, automatic grant repair, a wall-clock recurring callback,
  deployed-controller restart or orchestrator grace policy, durable/deployed cadence, production
  credentials/TLS, monitoring, capacity, real-user retention, or deployment.
- `pnpm run test:jobs-scheduler:wall-clock-postgres-integration` starts the same built entry point
  from a link-free read-only production-only graph under pinned Linux Node. Under unchanged native
  `Date.now()` and `setInterval(60_000)` it waits for the startup catalog, holds the scoring mutex,
  observes the production refresh call in a later real five-minute slot, delivers an OS `SIGTERM`,
  releases the mutex, and requires the active refresh to commit before silent code-0 exit, session
  release, and runtime-fingerprint revalidation. It proves one local recurring host-timer call and
  graceful signal settlement, not a deployed controller or orchestrator grace policy, durable or
  deployed cadence, production clock stability, replica coordination, monitoring, capacity,
  real-user retention, or deployment.
- `pnpm run test:jobs-scheduler:signal-postgres-integration` packages only the built scheduler,
  built Jobs runner, and exact installed production dependency graph into a link-free read-only
  runtime under the pinned Linux Node image. It holds the first finalization call, delivers an OS
  `SIGTERM`, releases the lock before the database deadline, and proves active-call settlement, no
  refresh or later job, silent exit code 0, session release, immutable runtime contents, and exact
  final state after the seventeen omitted commands run separately. It proves no deployed signal
  route, orchestrator grace policy, production login/TLS, recurring callback, monitoring, capacity,
  real-user retention, or deployment.
- `pnpm run lint:ingest`, `pnpm run typecheck:ingest`, `pnpm run test:ingest:coverage`, and
  `pnpm run build:ingest` verify the local sync kernel, adapter, application, and HTTP factory. They
  are focused synthetic-key/mock-pool/loopback checks and do not by themselves prove edge delivery,
  PostgreSQL integration, a connector, distributed rate/backpressure, capacity, or deployment.
- `pnpm run lint:ingest-host`, `pnpm run typecheck:ingest-host`,
  `pnpm run test:ingest-host:coverage`, `pnpm run build:contracts`, `pnpm run build:ingest`,
  `pnpm run build:ingest-host`, and `pnpm run check:ingest-host-entrypoint` verify the separate
  local listener/process shell. They do not prove Railway, external TLS, direct-origin denial, live
  credentials, monitoring, capacity, or deployment.
- `pnpm run test:ingest:postgres-integration` uses one disposable PostgreSQL container with an
  ephemeral loopback-only port and a synthetic dedicated Ingest login. It builds the emitted host,
  sends independently signed HTTP requests, verifies accepted/duplicate/replay/revocation results
  plus exact persistence, and holds four valid requests at the first replay-store call so a fifth
  returns generic 503 without a fifth database call; the four settle successfully after release. It
  then closes the imported host, starts the built entry point as a silent child, observes its
  loopback listener, proves one more exact accepted request, forcibly ends only that child, and
  removes its container, network, and storage. It proves no graceful settlement for that forcibly
  ended child, external TLS, protected secret delivery, edge route, distributed control, production
  credential, real-user data, representative load, or capacity.
- `pnpm run test:ingest:signal-postgres-integration` builds a link-free runtime containing only the
  emitted Ingest-host/Ingest/contracts workspaces and their exact installed production graph, mounts
  it read-only in the pinned Linux Node image, and joins only the disposable database network
  namespace. A separate capability-free client container receives one independently signed synthetic
  request through stdin. The gate holds that call at persistent origin replay, delivers a real
  `SIGTERM`, releases it, and proves exact HTTP/persistence settlement, silent code-0 exit,
  database-session release, immutable runtime contents, and complete cleanup. It does not prove a
  deployed signal route, Railway/orchestrator drain, external TLS, protected secret delivery,
  production credentials, representative load/capacity, real-user input, or deployment.
- `pnpm run check:publication` is expected to fail until real hosted maintainers, CODEOWNERS, and
  private reporting controls are configured.
- `pnpm run check:database` verifies immutable migration paths/checksums and static capability
  policy. `pnpm run test:database:integration` separately uses an isolated, portless, ephemeral
  PostgreSQL Compose project to apply the reviewed manifest in order. Before revision 0039 it holds
  that migration's advisory lock until two exact migration processes are observed waiting, then
  requires one successful application, one closed `42P07` rollback, one ledger row, and the
  canonical table. It then creates bounded container-only current-snapshot archive generations,
  twice restores the database, requires SHA-256/length-identical canonical data plus a byte-stable
  second-generation schema, rechecks all 28 forced-RLS tables and selected role grants, and then
  exercises state constraints, session-bound identity, source/device lifecycle, Community ingest,
  ingest/pairing/auth/abandoned-enrollment/CarRecipe-proposal/finalized-source-day retention, and
  scoring/finalization/public-score procedures, observed
  identity/pairing/lifecycle/ingest/cleanup/scoring/finalization lock-wait races, rollback, and
  every current runtime deny matrix. It does not prove a successful concurrent deployment controller
  or staging migration orchestration/rollback, and it does not exercise an old backup,
  deletion-marker replay, external backup storage or encryption, cluster-role recovery, production
  credentials, or RPO/RTO.
- Read `docs/operations/CURRENT_SNAPSHOT_RESTORE_RUNBOOK.md` before changing or invoking the restore
  drill. It permits only the repository-owned disposable synthetic gate and explicitly stops before
  any shared, real-user, stale-backup, staging, or production restore.
- Read `docs/operations/CAPABILITY_CONTAINMENT_RUNBOOK.md` before changing any exact-default-off
  decision. Local environment values do not stop or replace running processes and prove no deployed
  containment.
- Read `docs/operations/PROFILE_DELETION_FAILURE_RUNBOOK.md` before changing or diagnosing the
  request/purge/terminal-retention chain. It permits no raw Jobs or database command against shared
  data and does not authorize queue mutation or automatic retry.
- `git diff --cached --check` checks staged whitespace and conflict markers.
- `docker compose config --quiet` validates local database configuration without starting it.

These commands cover only evidence described in `docs/IMPLEMENTATION_STATUS.md`. The Web, Ingest,
Jobs, Jobs-scheduler, and migration-runner tests use synthetic/injected data and do not prove
authentication, real-user ingestion, connector, live edge, deployed scheduler cadence, or production
behavior. The general database integration proves only its isolated SQL/current-snapshot boundary;
the separate Web and Ingest integrations prove synthetic loopback HTTP-to-PostgreSQL paths, the Jobs
CLI integration proves one synthetic CLI-to-PostgreSQL path, and the scheduler integrations
separately prove fixed-clock startup, injected repeated-timer, injected-lifecycle, and emitted
terminal-marker paths. Rust process tests execute only a target-built synthetic child, not a
discovered or installed Codex binary. Install dependencies with
`pnpm install --frozen-lockfile --ignore-scripts`.

## Public repository boundary

Treat every tracked file, commit, issue, workflow log, fixture, screenshot, and release artifact as
public.

Never commit or paste:

- credentials, tokens, cookies, private keys, recovery codes, or real invite codes;
- production environment values or internal anti-abuse thresholds;
- personal email addresses, account identifiers, IP addresses, or usage data;
- local absolute paths, terminal history, Codex sessions, prompts, or private logs;
- production database copies or fixtures derived from real users;
- screenshots that contain browser profiles, notifications, account details, or other identifying
  information.

The sole email exception is an owner- or contributor-confirmed public GitHub-verified or
GitHub-provided `noreply` identity in Git Author/Committer headers and its exact matching DCO
`Signed-off-by` trailer. Never copy that address into a tracked file or ordinary commit-message
text, and never infer it from the workstation.

Use synthetic fixtures with reserved example domains and obviously fake IDs. Configuration examples
must contain placeholders only. If a value might be sensitive, stop and ask before adding it.

`.gitignore` is defense in depth, not proof that a commit is safe. Before any commit, inspect the
complete staged diff and run `pnpm run check:public:staged`. Before publication, also run
`pnpm run check:history` from a non-shallow clone.

Do not create CODEOWNERS, maintainer profiles, conduct contacts, or support contacts from local Git
identity, filesystem names, browser sessions, or private account context. Leave publication blocked
until the user supplies and verifies the intended public project identities.

## Security rules

- Community usage is unverified client input. Never describe it as OpenAI verified.
- Verified league code paths remain disabled until a server-verifiable source is documented and
  reviewed.
- Never add prizes, money, authorization, or valuable privileges based on Community scores.
- The connector may use only the explicitly supported stable Codex App Server methods over local
  stdio.
- Do not read or transmit prompts, conversations, repositories, Codex tokens, API keys, or account
  email.
- Device credentials are source-bound and least-privileged. A device cannot administer or delete a
  profile.
- Never add arbitrary file, HTML, CSS, SVG, script, or remote-URL ingestion for car customization.
- Keep raw activity buckets out of client DTOs. Browser persistence is limited to non-personal
  locale, theme, and motion preferences until a reviewed data-map change says otherwise.
- Keep the frontend free of trackers, remote fonts/assets, arbitrary origins, and parent-workspace
  build inference. A new network destination or CSP capability requires threat-model and policy
  review.
- Untrusted pull-request code must never run with release, deployment, signing, or production
  credentials.
- Do not weaken a security invariant to make a test pass. Update the design and obtain explicit
  review when an invariant must change.

## Engineering conventions

- Keep public protocol contracts language-neutral, versioned, and validated at runtime.
- Prefer explicit state machines and database constraints over comments that merely describe valid
  transitions.
- Keep the web/auth service, usage-ingest service, jobs, and native connector separated at their
  trust boundaries.
- TypeScript must use strict mode. Rust connector code should forbid unsafe code unless a reviewed,
  documented exception is unavoidable.
- No production dependency is added without license, maintenance, security, and necessity review.
- Generated files must identify their source and generation command. CI must reject generated drift.
- User-visible behavior changes require documentation and EN/RU localization updates.

## Documentation rules

- English engineering documentation is canonical. Russian user-facing documentation links to its
  canonical source and must not silently diverge.
- Keep the root `AGENTS.md` concise. Add nested `AGENTS.md` files only when a subtree has genuinely
  different commands or security constraints.
- Put durable design decisions in ADRs, not only in pull-request discussion.
- Name affected threat-boundary and abuse-case IDs when changing a security-sensitive flow.
- Map every collected, logged, cached, exported, or retained field to the privacy data map.
- Update the architecture, compatibility matrix, public API reference, threat model, and operational
  runbooks when their corresponding behavior changes.
- Examples must be safe to copy and must not rely on unpublished local state.

## Completion standard

A change is not complete until:

- relevant formatting, lint, type, unit, integration, security, and documentation checks pass;
- negative authorization and abuse cases are covered where applicable;
- the staged diff contains no secrets, personal data, local paths, or generated noise;
- public contracts and documentation match the implementation;
- the handoff names any unverified behavior or residual risk honestly.

The current executable checks are intentionally narrow. Continue to verify meaning, terminology,
binary metadata, and public-data safety manually, and do not invent application or deployment
results.
