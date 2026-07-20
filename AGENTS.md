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

The repository currently contains a public foundation, a synthetic web prototype, versioned sync,
Community score query/response, compatible race and race-status responses, and CarRecipe contracts,
locally implemented OpenAPI GET and POST operations, bounded server-only PostgreSQL
score/race/status adapters/mappers, a closed public problem-response factory and request/admission
route, and procedure-only identity, passkey, restricted-recovery, pairing, source/device lifecycle,
Community usage-ingest, Jobs-only ingest/pairing/auth/invite/session/abandoned-enrollment/
CarRecipe-proposal/finalized-source-day, terminal-deletion-job, audit-event, revoked-passkey, and
revoked-device retention plus pairing approval-provenance redaction and fixed pairing-rate-window
reset, primary profile deletion, session-owned CarRecipe proposal/approval, and open-season
Community scoring plus terminal finalization and bounded public score-projection database slices. A
local one-shot Jobs runner now invokes only those seventeen reviewed maintenance functions through a
probed least-privileged login contract. An opt-in synthetic integration runs all seventeen emitted
CLI commands against one disposable least-privileged PostgreSQL login and proves a widened-login
denial plus exact stored state. A separate default-off local Jobs scheduler now derives only the
latest grace-eligible Community season and current UTC week, invokes the closed catalog sequentially
without overlap, retains slot state only in memory, and bounds first-signal shutdown. A second
opt-in synthetic integration composes that production scheduler core under a fixed injected UTC
clock/timer with the real Jobs runner and one disposable PostgreSQL database; it proves the exact
ordered catalog, full private-table non-mutation for a widened login, and exact narrow-login stored
state. A third advances that fixed clock by one hour, invokes the production interval handler twice
while the real-runner cycle is active, proves exact recurring-catalog execution plus overlap and
same-slot suppression, and verifies the rearmed terminal reset. A fourth composes the production
process lifecycle under the fixed clock, injects its first signal during the penultimate database
job, proves that active call settles and the later scheduler job does not start, and exits through
the graceful cleanup path; the harness invokes the omitted reset only afterward before the shared
exact-state oracle. A fifth starts the built scheduler entry point under the real host clock, waits
for the terminal catalog marker, forcibly ends only its otherwise persistent test child, and then
verifies the same exact state. The timer result does not prove host-timer delivery, the lifecycle
result does not prove OS-signal delivery, and the emitted result does not prove controller
settlement before forced termination. None proves a wall-clock recurring process callback, deployed
replica, durable cadence, production login/TLS result, monitoring, or capacity evidence. A local
Ingest kernel bounds the raw sync envelope and parser, verifies an injected replay-consumed origin
proof, validates the sync contract, and strictly verifies the source-bound device request. A
protected local reader supplies one mandatory and one optional rotation proof key from exact
namespaced configuration without returning a reusable key container. A separate bounded Ingest
PostgreSQL adapter wraps only reviewed origin replay, device lookup, and submission procedures
through a probed least-privileged login contract. A forced-RLS origin replay tuple and separate Jobs
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
behavior before removing the container. The three public score/race/status routes now share a second
exact default-off module-load gate before query/header parsing, admission acquisition, or storage
work. Their visible current-week browser consumer retains rounded freshness, optional
preference-gated streak, and an explicit validated synthetic fallback while the tracked gate is
false. Connector pairing start/poll and signed-in approval options/verification now use a third
exact default-off capability gate, independently resolved at module load before request parsing,
runtime/service construction, admission acquisition, protected configuration, or database work. A
fourth exact default-off decision now independently prevents new-source approval initiation and
completion unless the `/connect` page and both browser approval modules resolved exact enablement;
active existing-source pairing remains available, and the source choice is sealed and digest-bound
to the passkey challenge. A fifth exact default-off decision now closes browser proposal creation,
browser approval, and device proposal ingress before request or state work; account UI preserves
active/private previews and exact rejection. A sixth exact default-off decision now closes the
invite/OAuth/initial-passkey enrollment pages, HTTP routes, and service methods while returning
login and recovery remain available. None of these local gates is a deployed dynamic kill switch.
The public home also has a local-only EN/RU score simulator that persists or transmits no
hypothetical input; the stable score and legacy race response contracts remain unchanged. These
local boundaries include one opt-in synthetic path through all three real Next development GETs and
a disposable narrow Web login, with widened-login denial, exact public contracts, and full private-
table non-mutation. They still have no deployment proof key or secret-manager binding, externally
verified TLS/edge route, deployment database credential, capacity evidence, deployment, or real-data
result. A separate local enrollment slice now implements exact invite parsing, GitHub OAuth state
plus PKCE with no extra scope, purpose-separated encrypted cookies, atomic profile enrollment,
required initial WebAuthn registration plus pending-session rotation, returning
discoverable-credential passkey login, a session-scoped minimal passkey inventory, an account page,
same-origin public-profile hide/show, a session-derived active-device inventory, immediate source
pause, passkey-protected paused-source reactivation, immediate owned-device revoke,
passkey-protected terminal source unlink, backup-passkey addition, revocation of an owned
non-current passkey, fresh-passkey recovery-code rotation with one-time plaintext display, an
exact-handle fresh-passkey profile-deletion request, one-time recovery-code replacement-passkey
sign-in, and logout through the same probed read-write Web/Auth pool. Login options retain their
profile-free challenge only in a purpose-separated cookie; valid proof atomically creates and
consumes its database challenge while minting the session. Recovery performs bounded Argon2id
verification under a protected pepper, creates only a five-minute restricted authority, verifies the
replacement WebAuthn ceremony, and returns a normal session only after atomic completion. It has an
exact-session CarRecipe editor that validates one closed version 1 object, stores at most one
24-hour private proposal, previews active/pending recipes in all three themes, and activates or
rejects only through an encrypted session-bound control. A separate bounded device-authenticated
route and fixed connector command can only create or replace that pending exact recipe for an active
source-bound device; they cannot read, approve, reject, or activate it. A separate compatible race
projection exposes only an active profile's current approved recipe; proposal state stays private. A
separate bounded Jobs-only capability physically removes expired proposals locally, and the
default-off scheduler plus the combined synthetic PostgreSQL integration exercise it, but no
deployed cadence, production login, monitoring, or deployment is proven. The enrollment slice has
only injected/synthetic evidence and no invite issuer UI, working OAuth or database credential,
distributed recovery attempt controls, deployed cleanup/deletion cadence or notification,
cache/backup/tombstone purge, restore replay, edge abuse controls, or deployment. Bounded expired
authentication/invite/CarRecipe-proposal/session, finalized source/day, aged revoked-passkey, and
aged minimized revoked-device/pairing cleanup plus primary profile deletion exist locally. Finalized
source/day cleanup retains a smaller UTC-day/count projection and waits 30 days after terminal
finalization. Activated pairing approval references can be redacted locally after 180 days, and an
unreferenced revoked-device binding can be removed only after both its activation and revocation
have crossed the 180-day boundary. These capabilities are catalogued in the default-off local
scheduler and exercised together in the combined synthetic PostgreSQL integration, but have no
deployed retention evidence. A library-only Rust connector foundation now implements a bounded
stable App Server JSONL handshake and a candidate-only `0.144.5` account/usage parser with checked
schema/fixture evidence. A one-shot supervisor composes that sequence with fixed local pipes,
arguments, deadlines, output budgets, ambient-environment clearing, and reap-before-success
behavior, but its reviewed-launch capability has no public constructor. An exact-body composer now
consumes that minimized usage behind a second inaccessible reviewed context and fixes the versioned
JSON/digest/LF message. An isolated one-use signer consumes that otherwise inaccessible material
with a device-bound key capability that also has no public constructor, returning only the same body
and five exact signed header values. A separate inaccessible pending-key/challenge signer and pure
server-only Web verifier now agree on one exact synthetic pairing-possession proof. A transport-free
Web/Auth start application creates nine-minute pending transactions from closed device metadata with
fresh server IDs, poll tokens, challenges, 60-bit human codes, and separate protected poll/code
verifiers through the fixed read-write Web pool. A second activation application performs protected
poll lookup, runs the strict proof, and alone invokes exact activation with server-owned IDs behind
fixed admission and timing. A local signed-in `/connect` flow now counts pending-code attempts on
the exact session, renders bounded device metadata plus a full public-key fingerprint, offers a new
source or an active owned source through an encrypted session-bound control, and requires a separate
fresh passkey assertion before atomic new/existing-source approval. A closed local start/poll HTTP
boundary now shares four-call admission, applies a fixed-storage global-and-64-bucket PostgreSQL
rate policy, and serializes only the versioned contracts; it and both signed-in approval routes
remain unavailable unless their modules resolve exact `VIBERACING_PAIRING_ENABLED=true`. A bounded
Rust `connect` command generates one Ed25519 key through the OS CSPRNG, stores its versioned state
only in the native credential store, resumes polling, and persists the activated binding without
printing bearer or key material. A separate exact `forget-local` command deletes only the canonical
origin/label native entry without loading it or contacting the service, and states that it did not
revoke server device authority. A separate explicit `check-codex` command reuses only the bounded
exact Windows candidate admission without an origin, credential-store access, Codex process, account
read, persistence, or network, and reports that no version is supported. Its opt-in diagnostic
preview emits only a closed local v1 summary of compile-time version, fixed platform contract,
admission class, and empty support state; it retains failure status, omits local values, and neither
saves nor sends output. A separate Windows x86_64 development `sync` command can construct the
private launch/context/key capabilities only after active-record review and either bounded
fixed-name `PATH` discovery or explicit-path admission of the exact `0.144.5` artifact. It then
sends one fixed signed request and validates one closed acknowledgement without retry or edge-origin
headers. A separate fixed `propose-car` command starts no Codex process, accepts only exact enum
flags and a bounded seed, signs one fresh proposal-domain request with the same active native key,
sends once without retry, and validates only a generic acknowledgement. A checked local Agent Skill
now reduces a styling request to those exact fields, requires explicit shell-safe origin/label
values, invokes only that command once, and receives no read, approval, or activation authority. A
separate Windows release-profile smoke copies the repository-built `0.0.0` connector into a bounded
temporary directory, checks only exact help and missing-candidate behavior with a cleared
environment, verifies digest/inventory stability, and removes the copy. Secretless no-upload CI
declares the same `windows-2025` job, but no hosted pass is claimed from the local tree. There is
still no supported version, macOS/Linux admission, clean-machine real-account result, real package
install/upgrade/uninstall lifecycle, credential rotation or automatic server-revoke composition,
packaging, release, live pairing result, deployment Ingest credential/TLS result, edge deployment,
or capacity evidence. Do not claim that deployed browser/session HTTP authentication,
production-ready recovery or remaining unimplemented critical-action verification, real-user
ingestion, an operational connector, a deployed Jobs scheduler or deployed public-race read, season
correction, deployed cleanup cadence or broader cleanup, deployment, or a hosted security control
exists until its implementation and verification are present in the working tree.

A second checked local Agent Skill now selects only repository-owned read-only verification from the
real Git scope, distinguishes focused, root, staged, history, synthetic, and live evidence, and has
no edit, staging, commit, installation, network, publication, push, or deployment authority.

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
  contract/Ingest/Jobs/Jobs-scheduler/frontend lint/type/coverage/production-build, and Rust
  formatting/check/test/Clippy gates.
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
- `pnpm run test:web:postgres-integration` starts one disposable PostgreSQL container and two
  sequential real Next development processes on loopback. It proves all three public-ranking GETs
  fail generically through an extra-membership login without private-table mutation, then validates
  their exact score/race/status contracts through a narrow `viberacing_web` login and confirms the
  successful reads remain non-mutating. It proves no production Next runtime, deployment login/TLS,
  cache, edge policy, monitoring, load/capacity, real-user data, or deployment.
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
- `pnpm run test:jobs:postgres-integration` uses one disposable PostgreSQL container with a
  synthetic narrow Jobs login. It runs all seventeen emitted CLI commands, proves an
  extra-membership login fails before mutation, validates generic process output and exact stored
  state, and removes the container, network, and storage. It proves no external audit sink, combined
  scheduler execution, production credential/TLS path, monitoring, capacity, real-user retention, or
  deployment.
- `pnpm run test:jobs-scheduler:postgres-integration` builds the production scheduler core and Jobs
  runner, injects one fixed UTC clock/timer, and runs the exact ordered seventeen-job catalog
  against one disposable PostgreSQL database. It fingerprints every private table to prove a
  deliberately widened login cannot mutate state, then verifies exact stored effects through the
  narrow login. It does not run the emitted scheduler process or prove deployed cadence, production
  credential/TLS, monitoring, capacity, real-user retention, or deployment.
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
  with the real host clock and exact enable/configuration environment, waits for the terminal
  catalog marker in disposable PostgreSQL without process output, forcibly ends only the otherwise
  persistent test child, and then verifies exact stored state. It does not prove controller
  settlement before that forced termination, a wall-clock recurring process callback, graceful
  process-signal settlement against PostgreSQL, durable/deployed cadence, production
  credentials/TLS, monitoring, capacity, real-user retention, or deployment.
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
  plus exact persistence, and removes its container, network, and storage. It proves no external
  TLS, protected secret delivery, edge route, production credential, real-user data, or capacity.
- `pnpm run check:publication` is expected to fail until real hosted maintainers, CODEOWNERS, and
  private reporting controls are configured.
- `pnpm run check:database` verifies immutable migration paths/checksums and static capability
  policy. `pnpm run test:database:integration` separately uses an isolated, portless, ephemeral
  PostgreSQL Compose project to apply the reviewed manifest in order and exercise state constraints,
  session-bound identity, source/device lifecycle, Community ingest,
  ingest/pairing/auth/abandoned-enrollment/CarRecipe-proposal/finalized-source-day retention, and
  scoring/finalization/public-score procedures, observed
  identity/pairing/lifecycle/ingest/cleanup/scoring/finalization lock-wait races, rollback, and
  every current runtime deny matrix.
- `git diff --cached --check` checks staged whitespace and conflict markers.
- `docker compose config --quiet` validates local database configuration without starting it.

These commands cover only evidence described in `docs/IMPLEMENTATION_STATUS.md`. The Web, Ingest,
Jobs, and Jobs-scheduler tests use synthetic/injected data and do not prove authentication,
real-user ingestion, connector, live edge, deployed scheduler cadence, or production behavior. The
general database integration proves only its isolated SQL boundary; the separate Web and Ingest
integrations prove synthetic loopback HTTP-to-PostgreSQL paths, the Jobs CLI integration proves one
synthetic CLI-to-PostgreSQL path, and the scheduler integrations separately prove fixed-clock
startup, injected repeated-timer, injected-lifecycle, and emitted terminal-marker paths. Rust
process tests execute only a target-built synthetic child, not a discovered or installed Codex
binary. Install dependencies with `pnpm install --frozen-lockfile --ignore-scripts`.

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
