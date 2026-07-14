# Vibe Racing repository guidance

## Start here

Read these files before changing the project:

1. `README.md` for product scope and the trust disclaimer.
2. `docs/PROJECT_PLAN.md` for the selected architecture and delivery gates.
3. `docs/architecture/SECURITY_INVARIANTS.md` for non-negotiable behavior.
4. `docs/IMPLEMENTATION_STATUS.md` for claims backed by current evidence.
5. `docs/security/DEPENDENCY_POLICY.md` before changing dependencies or CI.
6. `SECURITY.md` and `CONTRIBUTING.md` before handling reports or public contributions.

The repository is currently building its public foundation. Do not claim that a command, service,
connector, deployment, or security control exists until its implementation and verification are
present in the working tree.

## Repository map

- `docs/` contains public canonical plans, status, architecture, and policy.
- `.github/` contains read-only pull-request CI and dependency-update configuration.
- `scripts/` contains repository verification and black-box policy tests.
- `package.json`, `pnpm-workspace.yaml`, and `Cargo.toml` define the pinned empty monorepo
  workspaces.
- `compose.yaml` provides disposable loopback-only PostgreSQL for local development.
- Application, package, contract, and connector workspaces are not present yet; follow
  `docs/PROJECT_PLAN.md` when they are introduced.

## Verified commands

- `pnpm run verify` runs public-data, checker regression, formatting, Markdown, configuration,
  workflow-policy, and Rust workspace gates.
- `pnpm run verify:node` runs the same deterministic gates except Rust; CI runs Rust separately.
- `pnpm run check:public:staged` scans the exact staged blobs before a commit.
- `git diff --cached --check` checks staged whitespace and conflict markers.
- `docker compose config --quiet` validates local database configuration without starting it.

These commands cover only Phase 0 evidence described in `docs/IMPLEMENTATION_STATUS.md`; they are
not application tests. Install dependencies with `pnpm install --frozen-lockfile --ignore-scripts`.

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

`.gitignore` is defense in depth, not proof that a commit is safe. Before any commit or publication,
inspect the complete staged diff and run `pnpm run check:public:staged`.

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
