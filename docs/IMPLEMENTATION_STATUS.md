# Implementation status

Last updated: 2026-07-30.

This file is the evidence ledger for the current working tree. “Implemented” below means local
repository code plus the named deterministic or disposable-database evidence. It never means
deployed, production-ready, provider-verified, capacity-proven, or used with real personal data.

## Product status

Vibe Racing is an unreleased local pre-alpha:

- no production or staging service is known to exist;
- no connector package or supported provider/platform/version has been released;
- no production database, credential, secret, route, user, or usage record is claimed;
- Community totals are self-reported provider counters, not provider attestations;
- rank grants no reward, money, access, authorization, or valuable privilege; and
- tokenizers differ, so totals are not normalized cost, compute, effort, or quality.

The former unreleased Codex/source/score baseline has been replaced by the clean AgentAccount and
`provider_reported_tokens_v1` target in
[ADR 0076](decisions/0076-clean-agent-account-provider-reported-token-ranking.md). There is no
backward-compatibility population.

## Current evidence summary

| Surface                                                        | Local state                                       | Primary evidence                                                            |
| -------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------- |
| Synthetic public web experience                                | Implemented                                       | `test:web:coverage`, `build:web`, visual baselines                          |
| Public snapshot HTTP routes                                    | Implemented, default-off                          | `test:web:coverage`, `test:web:postgres-integration`, `test:web:standalone` |
| Identity, passkeys, recovery, private account                  | Implemented, default-off where noted              | `test:web:coverage`, `test:web:postgres-integration`                        |
| Batch connector pairing applications                           | Implemented, default-off                          | Web/Rust tests and disposable PostgreSQL integrations                       |
| Provider-neutral connector core and CLI                        | Implemented, unreleased                           | Rust tests, Clippy, local Windows portable/candidate gates                  |
| Codex `0.144.5` reader                                         | Exact candidate only; provider remains recognized | compatibility checker, Rust fixtures/privacy tests                          |
| `POST /v1/usage` contract, Edge, Ingest, database              | Implemented, independently default-off            | contract/Edge/Ingest tests and PostgreSQL integrations                      |
| Exact weekly accounting and snapshots                          | Implemented                                       | database integration including 10,001 synthetic profiles                    |
| Migration controller                                           | Implemented, default-off                          | migrate coverage and disposable PostgreSQL integration                      |
| Thirteen-capability Jobs runner and scheduler                  | Implemented, scheduler default-off                | coverage plus Jobs/scheduler PostgreSQL process gates                       |
| Current-snapshot backup and restore rehearsal                  | Implemented locally                               | database integration and restore-runbook checker                            |
| Profile deletion and terminal retention rehearsal              | Implemented locally                               | database integration and deletion-runbook checker                           |
| Admin invitation kernel                                        | Transport-free only                               | Admin coverage and disposable PostgreSQL integration                        |
| Edge/Web/Ingest/Jobs/Migration images and release declarations | Source/config only                                | image builds, config checks, no hosted result                               |
| Public GitHub source publication                               | Public source-only; participation closed          | publication checker, hosted policy readback, baseline CI                    |

## Canonical inventories

- 18 public JSON Schemas.
- 4 public authentication/transport policies.
- 7 OpenAPI operations over 7 paths.
- 7 checksum-ledgered, transactional SQL migrations.
- 36 owner-owned private tables with forced row-level security.
- 6 recognized provider identifiers and 0 supported providers.
- 13 fixed Jobs capabilities.
- 9 independent process/module capability decisions, of which 8 tracked environment defaults are
  explicitly false and migration enablement is supplied only to the one-shot runner.

The manifests, rather than this prose, are the machine-readable source of truth:
`contracts/v1/manifest.json`, `database/migrations/manifest.json`, and the generated OpenAPI file.

## Contracts and public reads

The final unreleased V1 protocol exposes:

- `POST /v1/usage`;
- `GET /v1/leaderboards/current`;
- `GET /v1/leaderboards/{seasonStart}`;
- `GET /v1/profiles/{handle}`; and
- three contract-only connector pairing/proposal operations.

The former score, race, race-status, direct-token-ranking, and source-oriented Community routes are
absent. Unknown routes and methods return bounded generic problems without performing protected
work.

Public leaderboard/profile routes resolve `VIBERACING_PUBLIC_SNAPSHOTS_ENABLED=true` exactly at
module load. Otherwise their modules remain closed before request parsing, admission, protected
configuration, or database construction. The database procedures read immutable published snapshots
only; requests never aggregate raw usage.

`LeaderboardSnapshotV1` publishes:

- explicit `provider_reported_tokens_v1` and `community` labels;
- UTC Monday-to-Sunday season and state;
- exact decimal-string totals;
- shared competitive rank and separate deterministic display position;
- rounded freshness;
- optional bounded provider percentages; and
- an optional active public CarRecipe.

Equal totals share rank across pages. Provider percentages add to 100 and do not change rank. Hidden
and deletion-pending profiles are absent. A failed refresh preserves the last-good pointer, and a
finalized snapshot is immutable.

## Identity, enrollment, and private account

One positive immutable GitHub numeric user ID maps to at most one profile. Handles and email are not
identity keys. There is no anonymous identity or anonymous-to-GitHub promotion path.

The local Web slice includes:

- optional invite-gated GitHub OAuth state plus PKCE with minimal identity scope;
- initial passkey registration before a normal session;
- returning discoverable-credential passkey login;
- backup passkey addition and non-current passkey revocation;
- one-time recovery-code rotation;
- bounded Argon2id recovery into a five-minute restricted authority;
- replacement-passkey completion before a normal session;
- logout, public-profile hide/show, and exact-handle deletion request;
- session-derived installation, AgentAccount, and device inventories;
- pause/reactivate, quarantine/disconnect, and device revocation controls; and
- private CarRecipe propose/preview/approve/reject behavior.

Enrollment and optional invite policy have separate exact tracked false defaults. Returning login
and recovery do not depend on enrollment enablement. Critical actions consume fresh action-bound
passkey authority. Tests use synthetic keys and injected OAuth/authenticator decisions; no live
GitHub OAuth app, authenticator, credential, distributed recovery perimeter, or production session
is proven.

## AgentAccount and batch pairing

`AgentAccount` is the only counted usage domain:

- a profile may own several providers and several accounts for one provider;
- an installation may service several accounts;
- an account may have several independently revocable account-scoped device keys;
- installation/device count never multiplies usage;
- private labels do not establish identity or deduplication; and
- provider, accounting revision, scope, trust tier, and account key are server-owned and immutable.

The closed registry recognizes `codex`, `claude_code`, `opencode`, `qwen_code`, `cline`, and
`aider`. Recognition grants no reader, account creation, sync, or support. Codex has one exact local
candidate reader for App Server `0.144.5`, but the default database revision is disabled and the
provider remains recognized because clean-machine real-account, composed pairing/first-sync,
official package, upgrade/uninstall, and release evidence are absent. Synthetic integrations
explicitly promote recognized providers only inside disposable data.

The bounded flow discovers at most 16 candidates, seals the whole manifest, creates one pending
account-scoped key per selected candidate, and returns a browser deep link plus fallback code. The
signed-in user chooses create/attach/skip per candidate and one fresh passkey assertion settles the
ordered batch atomically. Polling also proves pending-key possession. Activated credentials are
stored before success output; skipped pending keys are deleted.

Pairing HTTP and approval modules resolve exact `VIBERACING_PAIRING_ENABLED=true` independently.
Transport-free applications, database procedures, and connector clients exist, but the three public
connector operations stay `contract-only` because no hosted composed transport result exists.

## Connector

The Rust connector provides a provider-neutral reader boundary and bounded CLI:

- `connect --origin <https-origin>`;
- `sync [--codex <absolute-path>]`;
- `status`;
- `doctor`;
- `account list`;
- `account sync <1..16>`;
- `disconnect`;
- `forget-local`;
- candidate-only `check-codex`; and
- proposal-only `propose-car`.

Private installation and account keys use the native credential store with no plaintext fallback.
The client has no generic URL, proxy, redirect, arbitrary header/body, command launcher, shell hook,
plugin, or file-upload surface. Sensitive local records are reduced to opaque candidate metadata,
UTC dates, canonical decimal totals, and version identifiers before protocol composition.

The exact Codex candidate admission is Windows x86_64 only and pins version, artifact identity,
paths, arguments, deadlines, stdout/stderr budgets, environment clearing, JSONL handshake, response
schemas, and fixture digests. Privacy-sentinel tests forbid prompts, conversations, code,
repositories, paths, email, tokens, raw records, and provider detail from payloads, logs,
diagnostics, or errors.

Local Rust and portable Windows tests do not prove a clean-machine real account, a released binary,
code signing, notarization, package-manager lifecycle, macOS/Linux admission, credential rotation,
automatic server revocation, or production networking. The manual protected release-candidate
workflow declares five targets, checksums, SBOM generation, artifact attestations, and unsigned
candidate artifacts; no hosted run or signed public release is claimed.

## Edge, Ingest, and atomic usage accounting

`UsageSyncV1` contains only schema version, AgentAccount ID, sync ID, observation time, client and
reader versions, and 1–31 unique UTC-day/canonical-decimal entries. Provider, profile, trust, rank,
account label, device/installation identity, prompts, conversations, code, repositories, paths,
email, credentials, raw records, cost, model, and component detail are absent.

The dependency-free Edge Worker:

- registers only exact `POST /v1/usage` after `VIBERACING_USAGE_SYNC_ENABLED=true`;
- rejects malformed route/method/media/encoding/body/header input before forwarding;
- applies the configured Cloudflare rate-limit binding before HMAC work;
- strips caller-supplied origin authority;
- adds one fresh path/body-bound origin HMAC;
- forwards only allowlisted headers to one fixed HTTPS origin; and
- never retries.

Ingest has separate exact route and host startup decisions. It validates raw framing, origin HMAC,
duplicate-key-safe JSON, the closed contract, device signature, and signed-header/body relationships
before invoking one database capability.

PostgreSQL consumes origin replay before device lookup and idempotency. One successful call
atomically:

1. revalidates the active installation, AgentAccount, device, provider, reader, revision, scope,
   trust tier, and server-owned date policy;
2. classifies idempotency;
3. stores immutable observations;
4. replaces the submitting device's cumulative account/day values;
5. recomputes exact multi-device account/day totals without double counting;
6. appends hash-chained ranking events; and
7. coalesces every affected season into the dirty queue.

All rejected signature, replay, idempotency-conflict, date, decimal, state, or policy cases leave no
partial usage state. Exact decimals are parsed by PostgreSQL as `numeric(30,0)`, not JavaScript
`Number`.

Synthetic Edge, Ingest, compatibility, PostgreSQL, separate-process, and real-signal gates exist.
They do not prove a deployed Cloudflare zone, Worker binding/secret, WAF, public route,
direct-origin denial, Railway service, production certificate/login, representative rate/load,
alerting, or real-user ingestion.

## Database, ranking, and snapshots

The clean empty-database bootstrap comprises seven logical revisions:

1. roles, schemas, identity, and migration ledger;
2. authentication, passkeys, and recovery;
3. providers, AgentAccounts, installations, devices, and batch pairing;
4. origin replay, idempotency, exact usage accounting, events, and dirty work;
5. seasons, ranking, immutable snapshots, publication, and finalization;
6. retention, deletion, Admin audit/invites, and Jobs capabilities; and
7. CarRecipe state.

Every revision is transactional, checksum-bound, owner-only, and forward-only after publication. All
36 private tables force RLS with owner-only policies. Runtime logins receive no direct table or
sequence privileges and exactly one non-login role. Reviewed `SECURITY DEFINER` functions use fixed
`pg_catalog, pg_temp` search paths.

Database integration proves, with disposable hostname-verified TLS PostgreSQL:

- exact seven-row ledger and digest enforcement;
- narrow runtime grants and widened-login denial;
- immutable numeric GitHub identity and concurrent OAuth convergence;
- passkey/recovery/session races and lifecycle rules;
- bounded all-or-nothing batch pairing and attach behavior;
- multi-device cumulative replacement without double counting;
- replay-first and idempotency behavior;
- exact decimals beyond JavaScript safe integers;
- direct weekly sums, shared rank, stable pagination, and provider breakdowns;
- refresh failure with last-good retention;
- finalized snapshot immutability;
- 10,001 synthetic-profile scale semantics;
- deletion authority revocation, blocked purge while a published snapshot is not finalized, bounded
  purge, and terminal retention; and
- current-snapshot archive budgets plus two clean restores preserving a completed deletion, one
  independent revoked device, and the finalized snapshot.

This is semantic local evidence, not representative production capacity, a production backup system,
stale-backup deletion replay, cross-region recovery, measured RPO/RTO, monitoring, or a staging
migration.

## Migration, Jobs, deletion, and restore

The one-shot migration controller is closed before protected configuration unless exact
`VIBERACING_MIGRATIONS_ENABLED=true` is supplied to that process. It loads only the seven-file
manifest, rechecks every digest, probes a distinct owner-member login over required verified TLS,
takes one fixed session advisory lock, rereads an exact ledger prefix, applies only missing reviewed
bodies, and requires the complete ledger. It accepts no caller-selected SQL, path, revision,
rollback, repair, or privilege widening.

The Jobs login can invoke only a fixed thirteen-capability catalog. The default-off scheduler
selects no caller date or batch:

- minute cadence attempts one due dirty snapshot refresh;
- five-minute cadence refreshes and then attempts one due finalization; and
- hourly cadence runs the dependency-ordered retention, purge, and reset catalog.

The scheduler is sequential, suppresses overlap, retains slot state only in memory, emits generic
failures, and bounds first-signal shutdown. PostgreSQL remains the correctness and idempotency
authority. Disposable integrations cover fixed and wall clocks, native timers, process emission,
failure/retry, overlap, rollback, and SIGINT/SIGTERM settlement. They do not prove a deployed
replica count, durable cadence, orchestration grace, monitoring, automatic retry policy, or recovery
from committed external side effects.

Profile deletion immediately hides the profile and revokes sessions, recovery authority,
installations, AgentAccounts, devices, and pending security work. Jobs purges at most ten eligible
profiles per call only after snapshot safety checks, preserves a completed terminal job, and removes
that terminal UUID after 30 days. The checked failure runbook distinguishes request lock-down,
deployment-owned retry, completion, and terminal cleanup. It does not prove notifications,
cache/object-store/analytics deletion, stale-backup replay, a real-user request, or deployed
cadence.

The restore rehearsal creates one bounded current snapshot with native `pg_dump`, restores it twice
into fresh databases, and compares ledger, provider state, forced-RLS/grants, finalized snapshot,
completed-deletion non-resurrection, independent revoked-device authority, and semantic state under
fixed archive budgets. The runbook does not claim a managed backup, encrypted object store,
retention configuration, cross-region copy, stale-backup replay, production credentials, or recovery
objective.

## Web experience

The root synthetic experience is server-rendered and works without a database:

- EN and RU;
- semantic leaderboard table/list structure;
- exact token totals and shared rank;
- current/historical season controls;
- filter/pagination state;
- explicit Community/unverified copy and tokenizer caveat;
- three themes;
- forced-colors and keyboard-visible focus;
- reduced motion;
- lazy decorative pixel race with a meaningful text/table fallback;
- public profile and garage routes; and
- private account/pairing screens driven by injected or database-backed local evidence.

Synthetic snapshot fallback is explicit and never presented as live provider or production data.
Default-off live modules do not silently construct protected resources. Visual baselines and browser
checks are repository-owned synthetic evidence, not a production accessibility certification or
cross-device user study.

## Admin, deployment, and publication

Admin contains a transport-free beta-invitation kernel and bounded Access/JWKS/member prerequisite.
It requires injected complete authorization, fresh-passkey decision, external audit acknowledgement,
narrow Admin database capability, and committed database audit before success. There is no Admin
host, page, CLI, complete authorization adapter, fresh-passkey verifier, operational issuer, Access
policy/key refresh, or deployment.

The narrow procedure commits the invite and one immutable minimal Admin audit row atomically. One
Jobs audit capability deletes at most 1,000 globally ordered ranking/Admin events older than 180
days per call; no deployed cadence or external append-only audit sink is claimed.

Pinned image definitions and Railway configuration exist for Web, Ingest, Jobs scheduler, and
Migration. A stable-release workflow serializes source replacement behind secretless checks and a
protected environment. These files contain no credentials and prove no hosted database, service,
route, migration, secret, monitoring, rollback, or deployment.

The repository is public in source-only mode. The maintainer registry and CODEOWNERS agree; private
vulnerability reporting is enabled; Issues, Discussions, Projects, and Wiki are disabled; pull
requests are collaborator-only; and the active no-bypass `main` ruleset requires a pull request,
conversation resolution, strict named checks, and blocks deletion/non-fast-forward updates. The
published baseline `73532ec0b41f1dd3443787e7d644475493b56f85` completed hosted CI successfully.

That hosted evidence covers the published source baseline only. It is not CI evidence for an
unpushed branch, does not prove external vulnerability-report delivery, and grants no release,
deployment, provider, service, or open-participation claim. External participation remains closed.

## Capability defaults

Tracked defaults are false for:

- public snapshots;
- enrollment;
- optional invite gating;
- connector pairing;
- CarRecipe proposal mutation;
- Edge usage sync;
- Ingest host startup; and
- Jobs scheduler startup.

Migration startup uses its own exact one-shot decision. These are module/process replacement
controls, not dynamic production kill switches. The checked containment runbook covers ordered
closure and one-at-a-time recovery while preserving returning login, recovery, deletion lock-down,
and other required security paths.

## Verification tiers

### Deterministic local development

```text
corepack pnpm run verify
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo test --workspace --all-targets --all-features --locked
```

### Broad release preparation

```text
corepack pnpm run verify:release
corepack pnpm run check:public:staged
corepack pnpm run check:history
corepack pnpm run check:publication
```

### Opt-in disposable PostgreSQL

The database, migrate, Web, Ingest, Admin, Jobs, and scheduler integration commands use disposable
containers and synthetic data. Run the exact commands from
[local development](getting-started/LOCAL_DEVELOPMENT.md).

### Live and hosted evidence

No command in the default repository gate contacts a provider account, GitHub OAuth app, hosted
PostgreSQL, Cloudflare zone, Railway service, credential manager outside local fixtures, or public
release endpoint. The separately authorized read-only GitHub policy check above is
source-publication evidence only. Any other live evidence requires explicit authorization, private
configuration, a documented scope, safe redaction, and an updated status entry. Until then, it must
not be inferred from local tests.

## Current clean-replacement review boundary

The current branch completed its full tracked/untracked self-review and the repository-owned local
matrix: deterministic and release checks, exact Rust checks, local Windows connector checks, all
disposable PostgreSQL process/integration modes, and four local image builds. Checker mutation
suites cover the current contract, database, documentation, operations, architecture, public-file,
configuration, compatibility, publication, and build-evidence boundaries.

The registry-backed `pnpm audit` advisory lookup was not refreshed and is explicitly not counted as
green evidence. No claim is made that the dependency graph is advisory-free. The completed matrix
also remains local and synthetic: it does not add provider support, a released connector, hosted CI
for this branch, deployment, production credentials, representative capacity, monitoring, backup
operations, or real-user evidence.

## Remaining release blockers

- At least one provider needs a clean-machine real-account reader, accounting, pairing, and
  first-sync result before it can become supported.
- Connector packages need the declared target matrix, checksums, SBOMs, attestations, code signing
  where applicable, installation/upgrade/uninstall evidence, and release review.
- Web, Edge, Ingest, Jobs, Migration, Admin, database, TLS, protected secret delivery, monitoring,
  capacity, backup, restore, and containment need real hosted evidence before deployment claims.
- The distributed recovery-attempt perimeter and operational deletion/retention notification and
  stale-backup replay procedures remain unproven.
- Every new source revision needs reviewed hosted CI and policy readback before merge; external
  participation needs a real private conduct channel before it opens.

Do not upgrade any row in this ledger merely because code exists. Record the exact command, fixture,
environment, negative controls, and evidence boundary first.
