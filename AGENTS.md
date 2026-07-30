# Vibe Racing repository guidance

## Start here

Before changing the repository, read:

1. `README.md` for product scope and the trust disclaimer.
2. `docs/PROJECT_PLAN.md` for the accepted architecture and delivery gates.
3. `docs/architecture/SECURITY_INVARIANTS.md` for non-negotiable behavior.
4. `docs/IMPLEMENTATION_STATUS.md` for current evidence and explicit gaps.
5. `docs/security/THREAT_MODEL.md` and `docs/security/ABUSE_CASES.md`.
6. `docs/security/PRIVACY_DATA_MAP.md` before collecting, logging, retaining, exporting, or
   publishing data.
7. `docs/decisions/README.md` and applicable ADRs.
8. `docs/security/DEPENDENCY_POLICY.md` before dependency or CI changes.
9. `SECURITY.md`, `CONTRIBUTING.md`, `GOVERNANCE.md`, and `MAINTAINERS.md` before publication,
   contribution, ownership, or release work.
10. The applicable operations runbook before migration, restore, containment, or deletion work.
11. The nearest nested `AGENTS.md` before editing a scoped workspace.

## Current state

Vibe Racing is an unreleased local pre-alpha. The former Codex/source/score baseline has been
replaced with the clean AgentAccount and `provider_reported_tokens_v1` target in ADR 0076.

The current tree has:

- one immutable numeric GitHub identity per profile;
- multiple logical AgentAccounts per profile/provider;
- installation identity and independently revocable account-scoped device keys;
- bounded batch discovery, create/attach/skip review, one-passkey atomic approval, and polling;
- exact cumulative account/day usage through sole `POST /v1/usage`;
- replay-first, idempotent, atomic PostgreSQL accounting;
- direct exact UTC-week sums, shared rank, immutable snapshots, and snapshot-only public reads;
- three public snapshot routes and three contract-only connector routes;
- a provider-neutral unreleased connector and one exact Codex `0.144.5` candidate reader;
- seven checksum-ledgered clean-bootstrap migrations and 35 forced-RLS private tables;
- one thirteen-capability Jobs runner and default-off scheduler;
- local migration, deletion, containment, backup/restore, and release-candidate evidence; and
- a database-free EN/RU synthetic Web experience.

All six providers are recognized and none is supported. Codex remains recognized and its default
database revision disabled because clean-machine real-account, one composed same-artifact
connect/approval/credential/first-sync/snapshot result, package lifecycle, protected artifacts,
signing, and release evidence are absent.

Do not claim a deployed service, provider support, released connector, real-user ingestion,
production credential/TLS, hosted cadence, monitoring, representative capacity, backup/recovery, or
security control unless exact current evidence is recorded in `docs/IMPLEMENTATION_STATUS.md`.

## Product and trust rules

- Community totals are device-signed self-reports, not provider attestations.
- Tokenizers differ. Rank is not normalized cost, compute, effort, quality, or value.
- Rank must never grant money, prizes, access, authorization, or another valuable privilege.
- `provider_reported_tokens_v1` is the only competitive metric.
- Rank depends only on exact weekly total. Equal totals share rank; display position is separate.
- Community and future Verified evidence remain separate snapshots and ranks.
- Public Web reads immutable snapshots only; never aggregate raw usage on a request.
- A refresh failure preserves the last-good pointer; finalized snapshots are immutable.

## Privacy boundary

The protocol and reader boundary must not expose or log:

- prompts, conversations, code, tool output, repository names/content, or local paths;
- email, login, display name as identity, access/OAuth tokens, API keys, or credentials;
- raw provider records, model, price, plan, component details, or arbitrary metadata;
- internal AgentAccount/device/installation/profile IDs in public projections; or
- exact receipt timestamps or protected configuration.

Readers may emit only closed provider/version data, opaque bounded candidate evidence, safe private
labels, UTC dates, and canonical cumulative decimal totals. Mixed-content local storage is untrusted
input. Unknown schema, ambiguity, partial parse, unsafe links/paths, oversized input, duplicate
keys, or prohibited fields fail closed.

## Identity and AgentAccount invariants

- Key profiles only by positive immutable GitHub numeric ID. Handle/email are mutable metadata.
- There is no anonymous profile, ownership lease, or anonymous-to-GitHub promotion.
- OAuth state/PKCE, WebAuthn challenges, sessions, recovery, and critical-action step-up remain
  purpose-separated, single-use, bounded, and action/target bound.
- Initial enrollment completes a primary passkey before a normal session exists.
- Restricted recovery returns a normal session only after replacement-passkey completion.
- AgentAccount is the counted domain. Device or installation multiplicity never adds another count.
- Provider, accounting revision, scope, trust tier, and account key are immutable server-owned
  attributes.
- Private labels do not establish identity or deduplication.
- One fresh passkey assertion settles the exact ordered pairing batch atomically.
- A device key acts only for its bound AgentAccount and cannot administer profile/security state.
- Profile deletion immediately hides the profile and revokes browser/connector authority before
  physical purge.

## Numeric, date, replay, and idempotency rules

- Token totals cross JSON as canonical non-negative decimal strings.
- Never convert competitive totals through JavaScript `Number`; validate to string/`bigint` and let
  PostgreSQL parse `numeric(30,0)`.
- PostgreSQL clock owns UTC date, future rejection, backfill, season, and finalization policy.
- `observedAt`, locale, timezone, file time, or client clock cannot widen eligibility.
- Origin HMAC verification is non-mutating; durable origin replay is consumed before device lookup
  and idempotency.
- Signature, replay, idempotency conflict, date, decimal, binding, or state failure must leave zero
  partial observation/account-day/event/dirty-season state.
- Multiple devices replace cumulative contributions for one AgentAccount/day without double counting
  the domain.

## Capability and role confinement

Tracked exact false defaults independently close public snapshots, enrollment, optional invite
policy, pairing, CarRecipe proposal mutation, Edge usage, Ingest startup, and Jobs scheduler
startup. Migration has a separate exact one-shot decision.

- Resolve each decision before request parsing, admission, protected configuration, or resources.
- Accept only the exact own string property `true`; all other states fail closed.
- Treat decisions as process/module replacement controls, not dynamic production kill switches.
- Preserve returning login, recovery, deletion lock-down, and other required security paths when
  closing adjacent capabilities.

`viberacing_private` is owner-only. All private tables force RLS. Runtime roles have no table or
sequence grants and only fixed reviewed `SECURITY DEFINER` procedures. Deployment logins are
distinct, `NOINHERIT`, non-owner, and members of exactly one capability group. Production database
transport requires hostname-verified TLS.

## Repository map

- `.agents/skills/viberacing-propose-car/` is proposal-only and cannot approve/activate/read.
- `.agents/skills/viberacing-verify/` is read-only, local, deterministic verification.
- `.github/` contains read-only CI, protected release/deployment declarations, dependency updates,
  and public-safe forms.
- `apps/admin/` contains a transport-free invitation kernel and prerequisite verifier, not a host.
- `apps/web/` contains the synthetic UI, public snapshot reads, auth/account, pairing, and CarRecipe
  slices. Read its `AGENTS.md`.
- `apps/edge/` contains the dependency-free exact `/v1/usage` signer/rate boundary.
- `apps/ingest/` contains verification/application/database/HTTP factories. Read its `AGENTS.md`.
- `apps/ingest-host/` contains listener configuration and process lifecycle. Read its `AGENTS.md`.
- `apps/jobs/` contains the fixed one-shot maintenance runner. Read its `AGENTS.md`.
- `apps/jobs-scheduler/` contains the default-off fixed cadence/process. Read its `AGENTS.md`.
- `apps/migrate/` contains the default-off exact-manifest migration controller. Read its
  `AGENTS.md`.
- `contracts/v1/` is canonical; `contracts/generated/` is drift-checked output.
- `packages/contracts/` contains generated types and runtime validation. Read its `AGENTS.md`.
- `database/` contains the seven-revision bootstrap, roles, and real PostgreSQL tests. Read its
  `AGENTS.md`.
- `crates/connector/` contains the provider-neutral reader/CLI/credential boundary. Read its
  `AGENTS.md`.
- `compat/codex/` contains candidate-only exact-version evidence, never the supported matrix.
- `deploy/` contains pinned image/config declarations, no credentials or deployment evidence.
- `scripts/` contains deterministic checkers and opt-in synthetic integrations.

## Change workflow

1. Inspect the real branch, dirty tree, untracked files, and applicable instructions.
2. State the intended evidence boundary and smallest logical slice.
3. Update canonical sources first; regenerate derivatives rather than hand-editing them.
4. Add positive, negative, boundary, race/failure, no-partial-state, and cleanup evidence.
5. Run focused gates before root gates.
6. Review the complete diff for stale compatibility, secrets, personal data, false support, and
   false deployment claims.
7. Stage only the intended files, run `check:public:staged` and `git diff --cached --check`, then
   use a DCO sign-off.

Do not widen external-host, dependency, role, route, algorithm, or capability allowlists merely to
make a checker pass. Do not add a legacy alias for an unreleased surface. After first shared
database use, repair is a new forward migration; never rewrite a published ledger.

## Verification

Normal deterministic development:

```text
pnpm install --frozen-lockfile --ignore-scripts
pnpm run verify
```

Broad release preparation:

```text
pnpm run verify:release
pnpm run check:public:staged
pnpm run check:history
pnpm run check:publication
```

Focused workspace, Docker-backed PostgreSQL, platform, image, and runbook commands are listed in
`docs/getting-started/LOCAL_DEVELOPMENT.md`. Use the narrowest relevant set, but a broad
cross-cutting or release change must pass the full matrix.

Docker-backed gates are opt-in local synthetic evidence. Live provider, OAuth, hosted database,
Cloudflare, Railway, GitHub release, or production checks require explicit authorization and a
documented protected-data/logging/cleanup scope.

## Documentation

Update contracts, ADRs, security/privacy maps, runbooks, workspace README files, compatibility
matrix, and `docs/IMPLEMENTATION_STATUS.md` whenever their actual surface or evidence changes.
Historical ADR context may name removed shapes, but current guidance and status must not present
them as active.

Keep public text honest about:

- recognized versus supported providers;
- contract-only versus implemented-local routes;
- synthetic/local versus hosted/production evidence;
- current-snapshot restore versus stale-backup deletion replay;
- process gates versus dynamic incident controls; and
- declared workflows/images versus successful hosted runs.
