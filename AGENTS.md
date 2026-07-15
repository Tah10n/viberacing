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

The repository currently contains a public foundation, a synthetic web prototype, versioned sync and
Community score-response contracts, a server-only score-projection mapper, and procedure-only
identity, passkey, restricted-recovery, pairing, source/device lifecycle, Community usage-ingest,
Jobs-only ingest-retention, and open-season Community scoring plus terminal finalization and bounded
public score-projection database slices. Do not claim that HTTP authentication,
OAuth/Argon2id/WebAuthn/Ed25519 application verification, real-user ingestion, a connector, a
scoring service or HTTP public-race read, season correction, a finalization scheduler, scheduled or
broader cleanup, deployment, or a hosted security control exists until its implementation and
verification are present in the working tree.

## Repository map

- `docs/` contains public canonical plans, status, threat/privacy/abuse models, architecture,
  compatibility, ADRs, and policy.
- `.github/` contains read-only pull-request CI, dependency-update configuration, and structured
  public-safe contribution forms.
- `scripts/` contains repository verification and black-box policy tests.
- `config/` contains reviewed external-host and dependency-license policy; do not widen either
  allowlist as a workaround for a failing check.
- `apps/web/` contains the synthetic Next.js frontend and nested agent guidance. Read
  `apps/web/AGENTS.md` before editing it.
- `contracts/v1/` contains canonical public JSON Schemas; `contracts/generated/` contains
  drift-checked derivatives.
- `packages/contracts/` contains generated TypeScript types plus the bounded runtime validator and
  nested security guidance. Read `packages/contracts/AGENTS.md` before editing it.
- `database/` contains the SQL migration ledger, non-login role bootstrap, identity/source/device
  persistence, and real PostgreSQL invariant tests. Read `database/AGENTS.md` before editing it.
- `package.json`, `pnpm-workspace.yaml`, and `Cargo.toml` define the pinned monorepo workspaces.
- `compose.yaml` provides disposable loopback-only PostgreSQL for local development.
- Ingest, jobs, authentication application code, and connector workspaces are not present yet;
  follow `docs/PROJECT_PLAN.md` when they are introduced.

## Verified commands

- `pnpm run verify` runs public-data/history, checker regression, documentation/link, spelling,
  license inventory, formatting, Markdown, configuration, workflow-policy, frontend lint/type/
  coverage/production-build, and Rust workspace gates.
- `pnpm run verify:node` runs the same deterministic gates except Rust; CI runs Rust separately.
- `pnpm run check:public:staged` scans the exact staged blobs before a commit.
- `pnpm run check:community` validates governance and community-health files and forms.
- `pnpm run check:architecture` validates required security/architecture contracts, structured abuse
  cases, ADR metadata/indexes, compatibility fail-closed state, privacy classes, and Mermaid fence
  structure.
- `pnpm run check:contracts` validates bounded JSON Schema structure, the connector writable-field
  allowlist, generated TypeScript/OpenAPI drift, and version-manifest integrity.
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
- `pnpm run check:publication` is expected to fail until real hosted maintainers, CODEOWNERS, and
  private reporting controls are configured.
- `pnpm run check:database` verifies immutable migration paths/checksums and static capability
  policy. `pnpm run test:database:integration` separately uses an isolated, portless, ephemeral
  PostgreSQL Compose project to apply the reviewed manifest in order and exercise state constraints,
  session-bound identity, source/device lifecycle, Community ingest, ingest-retention, and
  scoring/finalization/public-score procedures, observed identity/pairing/lifecycle/ingest/cleanup/
  scoring/finalization lock-wait races, rollback, and every current runtime deny matrix.
- `git diff --cached --check` checks staged whitespace and conflict markers.
- `docker compose config --quiet` validates local database configuration without starting it.

These commands cover only evidence described in `docs/IMPLEMENTATION_STATUS.md`. The web tests use
synthetic data and do not prove authentication, real-user ingestion, connector, deployment, or
production behavior; the database integration proves only its isolated SQL boundary. Install
dependencies with `pnpm install --frozen-lockfile --ignore-scripts`.

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
