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
Community usage-ingest, Jobs-only ingest/pairing/auth/CarRecipe- proposal retention, primary profile
deletion, session-owned CarRecipe proposal/approval, and open-season Community scoring plus terminal
finalization and bounded public score-projection database slices. A local one-shot Jobs runner now
invokes only those seven reviewed maintenance functions through a probed least-privileged login
contract. A local Ingest kernel bounds the raw sync envelope and parser, verifies an injected
replay-consumed origin proof, validates the sync contract, and strictly verifies the source-bound
device request. A protected local reader supplies one mandatory and one optional rotation proof key
from exact namespaced configuration without returning a reusable key container. A separate bounded
Ingest PostgreSQL adapter wraps only reviewed origin replay, device lookup, and submission
procedures through a probed least-privileged login contract. A forced-RLS origin replay tuple and
separate Jobs ingest/pairing/auth/CarRecipe-proposal cleanup capabilities have isolated PostgreSQL
evidence. A transport-free Ingest application boundary now composes those exact capabilities,
generates one server request ID, and returns only a validated sync acknowledgement or generic
problem decision. A confined Fastify server factory now preserves raw body/header evidence, applies
no-queue/deadline policy, and serializes only revalidated sync contracts. A separate local Ingest
host now binds that exact composition under closed loopback or Railway-edge configuration, cleans up
every partial startup, and handles SIGINT/SIGTERM under a fixed deadline without reflective output.
An opt-in synthetic loopback integration now builds that host, creates a disposable least-privileged
Ingest login in one ephemeral PostgreSQL container, sends independently signed HTTP requests, and
proves accepted, duplicate, persistent origin-replay, revoked-device, response-contract, and exact
persistence behavior before removing the container. The public race-status route now has a visible
current-week browser consumer with rounded freshness, optional preference-gated streak, and an
explicit validated synthetic fallback; the stable score and legacy race routes remain unchanged.
These local boundaries still have no deployment proof key or secret-manager binding, externally
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
separate bounded Jobs-only capability physically removes expired proposals locally, but has no
schedule, live login, monitoring, or deployment. The enrollment slice has only injected/synthetic
evidence and no invite issuer UI, working OAuth or database credential, distributed recovery attempt
controls, cleanup/deletion scheduling or notification, cache/backup/tombstone purge, restore replay,
edge abuse controls, or deployment. Bounded expired authentication/CarRecipe-proposal cleanup and
primary profile deletion exist locally, but have no schedule or deployed retention evidence. A
library-only Rust connector foundation now implements a bounded stable App Server JSONL handshake
and a candidate-only `0.144.5` account/usage parser with checked schema/fixture evidence. A one-shot
supervisor composes that sequence with fixed local pipes, arguments, deadlines, output budgets,
ambient-environment clearing, and reap-before-success behavior, but its reviewed-launch capability
has no public constructor. An exact-body composer now consumes that minimized usage behind a second
inaccessible reviewed context and fixes the versioned JSON/digest/LF message. An isolated one-use
signer consumes that otherwise inaccessible material with a device-bound key capability that also
has no public constructor, returning only the same body and five exact signed header values. A
separate inaccessible pending-key/challenge signer and pure server-only Web verifier now agree on
one exact synthetic pairing-possession proof. A transport-free Web/Auth start application creates
nine-minute pending transactions from closed device metadata with fresh server IDs, poll tokens,
challenges, 60-bit human codes, and separate protected poll/code verifiers through the fixed
read-write Web pool. A second activation application performs protected poll lookup, runs the strict
proof, and alone invokes exact activation with server-owned IDs behind fixed admission and timing. A
local signed-in `/connect` flow now counts pending-code attempts on the exact session, renders
bounded device metadata plus a full public-key fingerprint, offers a new source or an active owned
source through an encrypted session-bound control, and requires a separate fresh passkey assertion
before atomic new/existing-source approval. A closed local start/poll HTTP boundary now shares
four-call admission, applies a fixed-storage global-and-64-bucket PostgreSQL rate policy, and
serializes only the versioned contracts. A bounded Rust `connect` command generates one Ed25519 key
through the OS CSPRNG, stores its versioned state only in the native credential store, resumes
polling, and persists the activated binding without printing bearer or key material. A separate
exact `forget-local` command deletes only the canonical origin/label native entry without loading it
or contacting the service, and states that it did not revoke server device authority. A separate
Windows x86_64 development `sync` command can construct the private launch/context/key capabilities
only after explicit exact `0.144.5` artifact and active-record admission, then sends one fixed
signed request and validates one closed acknowledgement without retry or edge-origin headers. A
separate fixed `propose-car` command starts no Codex process, accepts only exact enum flags and a
bounded seed, signs one fresh proposal-domain request with the same active native key, sends once
without retry, and validates only a generic acknowledgement. A checked local Agent Skill now reduces
a styling request to those exact fields, requires explicit shell-safe origin/label values, invokes
only that command once, and receives no read, approval, or activation authority. There is still no
automatic executable discovery, supported version, macOS/Linux admission, clean-machine real-account
result, credential rotation or automatic server-revoke composition, packaging, release, live pairing
result, deployment Ingest credential/TLS result, edge deployment, or capacity evidence. Do not claim
that deployed browser/session HTTP authentication, production-ready recovery or remaining
unimplemented critical-action verification, real-user ingestion, an operational connector, a Jobs
scheduler or deployed public-race read, season correction, scheduled or broader cleanup, deployment,
or a hosted security control exists until its implementation and verification are present in the
working tree.

## Repository map

- `.agents/skills/viberacing-propose-car/` contains the checked local conversational reducer for the
  fixed proposal-only connector command. It is not an installer or released connector workflow.
- `docs/` contains public canonical plans, status, threat/privacy/abuse models, architecture,
  compatibility, ADRs, and policy.
- `.github/` contains read-only pull-request CI, dependency-update configuration, and structured
  public-safe contribution forms.
- `scripts/` contains repository verification and black-box policy tests.
- `config/` contains reviewed external-host and dependency-license policy; do not widen either
  allowlist as a workaround for a failing check.
- `apps/web/` contains the synthetic Next.js frontend, local public score/race/status routes and
  adapters, bounded invite/OAuth/initial-passkey enrollment, returning-passkey login, private
  account controls, and passkey-protected recovery-code rotation and replacement-passkey sign-in,
  plus the pure pairing- possession verifier, local pairing start/poll routes and applications, and
  nested agent guidance. Read `apps/web/AGENTS.md` before editing it.
- `apps/jobs/` contains the bounded local one-shot Community maintenance runner and nested
  least-privilege guidance. Read `apps/jobs/AGENTS.md` before editing it.
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
  local-only `forget-local` command, exact-candidate one-shot `sync` command, fixed proposal-only
  `propose-car` command, and nested connector security guidance. Read `crates/connector/AGENTS.md`
  before editing it.
- `package.json`, `pnpm-workspace.yaml`, and `Cargo.toml` define the pinned monorepo workspaces.
- `compose.yaml` provides disposable loopback-only PostgreSQL for local development.
- Trusted Ingest edge routing/external TLS deployment, the distributed recovery perimeter and
  cleanup, and released or scheduled connector layers are not present yet; follow
  `docs/PROJECT_PLAN.md` when they are introduced.

## Verified commands

- `pnpm run verify` runs public-data/history, checker regression, documentation/link, spelling,
  license inventory, formatting, Markdown, configuration, workflow-policy,
  contract/Ingest/Jobs/frontend lint/type/coverage/production-build, and Rust formatting/check/test/
  Clippy gates.
- `pnpm run verify:node` runs the same deterministic gates except Rust; CI runs Rust separately.
- `pnpm run check:agent-skills` derives the local proposal skill's enum inventory, CLI flags,
  generic output, and metadata from canonical sources. `pnpm run test:agent-skills-check` proves
  twelve unsafe/drifted variants fail closed.
- `pnpm run check:public:staged` scans the exact staged blobs before a commit.
- `pnpm run check:community` validates governance and community-health files and forms.
- `pnpm run check:architecture` validates required security/architecture contracts, structured abuse
  cases, ADR metadata/indexes, compatibility fail-closed state, privacy classes, and Mermaid fence
  structure.
- `pnpm run check:codex-compatibility` validates canonical exact-version manifests, extract/fixture
  digests, fixed stable methods, safe paths, evidence inventory, and candidate/matrix separation.
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
- `pnpm run lint:jobs`, `pnpm run typecheck:jobs`, `pnpm run test:jobs:coverage`, and
  `pnpm run build:jobs` verify the local one-shot Jobs boundary. They use injected fakes and do not
  prove a live Jobs login, scheduler, production TLS, monitoring, capacity, or deployment.
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
  ingest/pairing/auth/CarRecipe-proposal retention, and scoring/finalization/public-score
  procedures, observed identity/pairing/lifecycle/ingest/cleanup/ scoring/finalization lock-wait
  races, rollback, and every current runtime deny matrix.
- `git diff --cached --check` checks staged whitespace and conflict markers.
- `docker compose config --quiet` validates local database configuration without starting it.

These commands cover only evidence described in `docs/IMPLEMENTATION_STATUS.md`. The Web, Ingest,
and Jobs tests use synthetic/injected data and do not prove authentication, real-user ingestion,
connector, scheduler, live edge or deployment integration, or production behavior. The general
database integration proves only its isolated SQL boundary; the separate Ingest integration proves
one synthetic loopback HTTP-to-PostgreSQL path only. Rust process tests execute only a target-built
synthetic child, not a discovered or installed Codex binary. Install dependencies with
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
