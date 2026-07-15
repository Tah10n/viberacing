# Database persistence foundation and capabilities

## Status

This directory contains eleven SQL-first revisions for identity, passkey login and management,
restricted recovery, source, device, pairing, audit, deletion, Community usage, scoring, and season
finalization state. The migrations, narrow database procedures, and PostgreSQL integration tests are
implemented. No authentication/HTTP Ingest route, OAuth callback, Argon2id/WebAuthn or
pairing-possession verifier, production credential, or deployed database consumes the protected
identity/ingest capabilities. A local Ingest kernel verifies a bounded exact-body origin/device
request, and a separate fixed-query adapter maps its output to these two capabilities through a
probed least-privileged pool. Mock tests do not call PostgreSQL or supply a working login. One local
public-score route and one local one-shot Jobs runner wrap narrow capabilities without a working
database login. The database-only ingest and Jobs-only ingest-retention, open-season scoring, and
terminal finalization procedures plus one Web-only public score projection are implemented; HTTP
ingest, scheduled execution, audited corrections, and purge are not.

The `viberacing_api` schema is a closed procedure boundary. Runtime roles receive no direct private
table access. Profile-scoped procedures derive identity from an exact active session ID and keyed
32-byte verifier instead of accepting a caller-selected profile ID. The database still relies on
Web/Auth to perform OAuth and WebAuthn cryptographic verification before invoking the matching
procedure; the current repository has no such application code.

## Layout

- `roles/bootstrap.sql` creates idempotent `NOLOGIN` group roles, locks default database/schema
  access, and grants the protected deployment principal permission to `SET ROLE` to the owner.
- `migrations/manifest.json` is the ordered migration ledger and SHA-256 integrity source.
- `migrations/0001_identity_foundation.sql` creates the private schema, constraints, indexes,
  state-machine triggers, forced row-level security, and closed API boundary.
- `migrations/0002_identity_capabilities.sql` adds bounded audit references and procedure-only
  invite, enrollment, initial-passkey, session, challenge, and deletion capabilities.
- `migrations/0003_pairing_capabilities.sql` adds session-approved new/existing-source pairing,
  immutable approval/activation bindings, and bounded device/source creation capabilities.
- `migrations/0004_source_device_lifecycle.sql` adds private inventory, immediate source pause and
  device revoke, fresh-step-up source reactivation/unlink, stale-authority invalidation, and bounded
  lifecycle audit events.
- `migrations/0005_passkey_login_and_management.sql` adds minimal passkey verification lookup,
  anonymous login ceremonies, passkey-bound sessions, exact step-up provenance, bounded
  multi-passkey add/revoke, and recursive stale-authority invalidation.
- `migrations/0006_restricted_recovery_authority.sql` adds passkey-protected recovery-code batch
  replacement, used-PHC scrubbing, one short-lived recovery-only authority, atomic replacement-key
  completion, deletion revoke, and post-lock protective race semantics.
- `migrations/0007_community_usage_ingest.sql` adds bounded raw Community snapshots, nonce replay
  state, monotonic current source/day values, minimal active-device verification lookup, and an
  Ingest-only submission procedure with duplicate and quarantine outcomes.
- `migrations/0008_ingest_retention_cleanup.sql` adds one Jobs-only, server-time procedure for
  serialized bounded deletion of expired nonce and raw-snapshot rows plus its private mutex row.
- `migrations/0009_community_scoring_foundation.sql` adds immutable Community v1 score parameters
  and season binding, private derived daily/weekly score tables, and one Jobs-only atomic refresh
  that aggregates eligible distinct sources under a single profile cap.
- `migrations/0010_community_season_finalization.sql` adds the public 48-hour server-time grace
  deadline, late-snapshot quarantine, shared season locks, terminal projection triggers, and one
  Jobs-only idempotent finalization capability.
- `migrations/0011_community_public_score_read.sql` adds one Web-only, active-profile, bounded score
  projection with a fixed public field allowlist and post-visibility rank/display positions.
- `tests/identity_invariants.sql` uses deterministic synthetic rows inside a rolled-back transaction
  to exercise valid state and expected integrity failures.
- `tests/identity_capabilities.sql` exercises the exact grant matrix, session possession,
  cross-profile denial, expiry, replay, rollback, audit redaction, and synchronous deletion effects.
- `tests/pairing_capabilities.sql` exercises new/existing-source choice, first-winner rebinding
  denial, replay, poll possession, exact activation, immutable binding, and public safety ceilings.
- `tests/source_device_lifecycle.sql` exercises inventory isolation, source/device IDOR denial,
  step-up binding, replay, quarantine separation, stale challenge/pairing cancellation, recursive
  device revoke, and audit-failure rollback.
- `tests/passkey_capabilities.sql` exercises credential-derived login, replay and rollback,
  monotonic usage state, session provenance, private inventory, multi-passkey add/revoke, last-key
  protection, cross-profile denial, and public safety ceilings.
- `tests/recovery_capabilities.sql` exercises exact-passkey code rotation, bounded PHC batches,
  profile-free lookup, one-time scrub and authority, exact completion binding, deletion revoke,
  retained activated devices, role denial, rollback, and the lifetime-passkey fail-closed edge.
- `tests/usage_ingest.sql` exercises exact device/source binding, strict bounds, canonical time,
  replay/idempotency, same-source device deduplication, monotonic state, quarantine, lifecycle
  rejection, retention markers, direct-transition constraints, and the exact role boundary.
- `tests/ingest_cleanup.sql` exercises batch bounds, deterministic expiry order, idempotency,
  live-row preservation, entry cascade, retained current values, and detached raw provenance.
- `tests/identity_concurrency_setup.sql` and `tests/identity_concurrency_assertions.sql` prove one
  invite enrollment, one initial-passkey challenge consumption, one active-session rotation, and
  deletion dominance over concurrent session rotation without leaving stale authority.
- `tests/pairing_concurrency_setup.sql` and `tests/pairing_concurrency_assertions.sql` create only
  ephemeral synthetic state and prove cross-connection first-winner, source-ceiling, and live
  device-authority-ceiling serialization.
- `tests/lifecycle_concurrency_setup.sql` and `tests/lifecycle_concurrency_assertions.sql` prove
  pause dominates concurrent approval and unlink dominates concurrent activation without leaving
  approved pairing or active device authority live.
- `tests/passkey_concurrency_setup.sql` and `tests/passkey_concurrency_assertions.sql` prove one
  login challenge has one winner and passkey revoke dominates concurrent login without leaving its
  browser or pending device authority live.
- `tests/recovery_concurrency_setup.sql` and `tests/recovery_concurrency_assertions.sql` prove one
  code creates one authority, fresh code rotation dominates concurrent old-code start, and recovery
  completion dominates concurrent old-passkey login in the committed final state.
- `tests/ingest_concurrency_setup.sql` and `tests/ingest_concurrency_assertions.sql` prove
  concurrent exact retries create one snapshot, same-source devices converge on one monotonic
  current value, and source pause/device revoke serialize ahead of later submission.
- `tests/ingest_season_lock_assertions.sql` plus the integration runner prove two payloads listing
  the same seasons in opposite order acquire the lower season first and both complete without a
  deadlock.
- `tests/cleanup_concurrency_setup.sql` and `tests/cleanup_concurrency_assertions.sql` prove two
  Jobs cleanup calls serialize and each expired raw row is removed once without deleting live state.
- `tests/season_scoring.sql` proves ISO-week grouping, exact logarithmic rounding and caps,
  distinct-source aggregation, same-rank semantics without a raw-token tie breaker, hidden and
  quarantined exclusion, immutable version/season definitions, idempotent refresh, role denial, and
  rollback.
- `tests/scoring_concurrency_setup.sql` and `tests/scoring_concurrency_assertions.sql` prove two
  Jobs refreshes serialize and converge on one semantically identical open-season materialization.
- `tests/season_finalization.sql` proves the exact grace boundary, early and no-data behavior, late
  whole-snapshot quarantine, terminal idempotency and mutation denial, role isolation, and
  profile-purge compatibility.
- `tests/finalization_concurrency_setup.sql` and `tests/finalization_concurrency_assertions.sql`
  prove finalization and late Ingest share a deadlock-free canonical lock order and converge on one
  terminal projection.
- `tests/public_score_read.sql` proves the exact public field allowlist, active-only visibility,
  post-hide re-ranking, open/finalized metadata, fixed result ceiling, generic failure, and role
  isolation.
- `scripts/check-database.mjs` and its black-box tests enforce migration shape, checksums, paths,
  transactions, bounded execution, owner context, forbidden grants or SQL capabilities, and reject
  scalar-subquery `IF NOT` assertions whose missing row would otherwise pass as SQL `NULL`.
- `scripts/test-database-integration.mjs` owns an isolated Compose project, executes PostgreSQL
  assertions and lock-contention races, waits until every tagged contender is observed in the
  holder's transitive blocker chain, proves protective contender order before releasing the holder,
  proves runtime denials, and removes the container, network, and ephemeral storage.

## Capability model

| Role                | Login | Private schema | API schema | Current executable capability                                      |
| ------------------- | ----- | -------------- | ---------- | ------------------------------------------------------------------ |
| `viberacing_owner`  | No    | Owns objects   | Owns       | Migration and procedure implementation                             |
| `viberacing_web`    | No    | None           | Usage      | Identity/passkey/recovery/pairing/lifecycle plus public score read |
| `viberacing_ingest` | No    | None           | Usage      | Device verification lookup and Community sync submission only      |
| `viberacing_jobs`   | No    | None           | Usage      | Ingest cleanup plus Community refresh and finalization             |
| `viberacing_admin`  | No    | None           | Usage      | Bounded invite issuance only                                       |
| `PUBLIC`            | N/A   | None           | None       | None                                                               |

Deployment login principals are environment-owned secrets and are not declared here. Each service
will receive one group role through protected infrastructure. Runtime roles are not members of the
owner or one another; they cannot create schema objects, use temporary database storage, read a
private table, or rely on `public` in `search_path`. The database default and group-role defaults
both use only `pg_catalog, pg_temp`; service startup must still verify the effective role and
setting after connecting. The server-only public-score adapter now performs that verification before
every pooled score read and additionally rejects a privileged or multiply-grouped deployment login;
other future service adapters must implement equivalent capability-specific startup evidence.

Every private table has forced row-level security with an owner-only policy. This is defense in
depth against an accidental future table grant; it does not justify adding a direct runtime grant.
Runtime access must remain procedure-only and must have positive and negative integration tests.

## Implemented procedure boundary

- `issue_invite` is admin-only, requires a bounded reason code and audit reference, and refuses an
  expiry more than 90 days ahead.
- `enroll_profile` atomically proves invite-verifier possession, creates one enrolling profile and a
  fresh bounded session, redeems the invite, and appends an audit reference. A failed redemption
  leaves none of those rows behind.
- `create_auth_challenge` creates initial-passkey and profile-deletion challenges;
  `create_pairing_approval_challenge`, `create_source_action_challenge`, and
  `create_passkey_change_challenge` create tighter transaction-bound variants. Initial registration
  uses `consume_auth_challenge`; every critical action uses `consume_passkey_challenge`, which
  records the exact active owned passkey after the application verifies its assertion. Each
  authenticated challenge is bound by a composite foreign key to the exact session and profile,
  expires within its purpose-specific maximum, and can be consumed and claimed once.
- `register_initial_passkey` requires the same possessed enrolling session and its consumed, unused
  registration challenge before activating the profile and binding that session to the new key.
- `create_passkey_login_challenge` creates a profile-free ceremony for at most five minutes.
  `read_passkey_verification_material` returns only the active credential's opaque key ID, COSE
  public key, counter, and backup flags. `complete_passkey_login` derives the profile from that
  exact credential, atomically consumes the challenge, advances monotonic usage state, and creates a
  passkey-bound session. Known revoked and unknown credentials both return no material.
- `read_passkey_inventory` returns only the authenticated profile's opaque passkey IDs, bounded
  labels, lifecycle times, backup flags, and current-authenticator marker. `add_passkey` and
  `revoke_passkey` require a consumed action- and target-bound step-up. Revocation cannot remove the
  last active passkey; it revokes sessions derived from the target and cancels its unused challenges
  and approved-but-not-activated pairing authority. Already activated devices remain separately
  visible and explicitly revocable.
- `create_recovery_change_challenge` plus `consume_passkey_challenge` bind code regeneration to an
  exact active session and fresh owned-passkey assertion. `replace_recovery_codes` accepts only a
  complete 8-to-16-code batch of opaque IDs and bounded Argon2id PHCs, atomically removes the old
  batch, revokes active old-code authority, and never receives plaintext code secrets.
- `read_recovery_code_verification_material` returns only the supplied unused opaque code ID and its
  PHC, never a profile ID. After Web/Auth performs bounded Argon2id/pepper verification,
  `start_recovery` consumes and scrubs exactly that code and creates one recovery-only authority for
  at most ten minutes. It creates no browser session.
- `complete_recovery_registration` is callable only with the exact authority verifier, challenge,
  and context after application WebAuthn verification. One transaction installs the replacement
  passkey, revokes previous active passkeys and sessions, cancels approved pairings, removes profile
  challenges and remaining codes, completes the authority, and then creates the new passkey-bound
  session. Activated source-bound devices remain active and explicitly revocable. Completion fails
  closed at 32 lifetime passkey records until bounded provenance-preserving cleanup exists.
- `rotate_session` and `revoke_session` require the exact keyed verifier. Rotation serializes on the
  current session/profile, preserves its authentication provenance, and creates a fresh bounded
  record before ending the old one.
- `request_profile_deletion` derives the target from the possessed session, requires the exact typed
  handle and a consumed, unused deletion challenge, then atomically hides the profile, revokes
  active browser/passkey/device authority, removes recovery/challenge state, unlinks sources,
  cancels approved pairings, and queues one opaque deletion job.
- `start_pairing` stores only keyed poll/code verifiers, a bounded challenge, immutable pending
  public key, and bounded display metadata for at most ten minutes.
- `read_pairing_for_approval`, `create_pairing_approval_challenge`, and `approve_pairing` require
  the exact active session. Approval also requires a fresh, consumed, transaction-bound WebAuthn
  challenge and persists the exact verifying passkey plus approving session. The user can select a
  new opaque source or an existing active source owned by the same profile. The first valid approval
  wins; after that, another profile cannot take over or rebind the transaction.
- `read_pairing_verification_material`, `activate_pairing`, and `poll_pairing_status` expose only
  the minimum material needed for external Ed25519 proof verification and poll possession.
  Activation atomically binds the exact pending key to the approved source and one public device ID.
- `read_source_inventory` derives the profile from the exact possessed session and returns only its
  opaque source lifecycle plus bounded device metadata. Internal key IDs, public keys, profile IDs,
  account email, and exact usage are absent from the result.
- `pause_source` and `revoke_device` are immediate protective actions. They accept no caller-chosen
  profile, close on cross-profile IDs and replay, and append one bounded audit reference. Pausing
  invalidates unused source-bound challenges and cancels approved-but-not-activated pairings.
- `create_source_action_challenge`, `reactivate_source`, and `unlink_source` bind a short-lived
  source action to the exact active session, profile, purpose, source, and context. Reactivation is
  limited to paused sources; normal user authority cannot lift quarantine. Unlink is terminal,
  revokes every active device, cancels approved pairings, and invalidates unused source actions in
  the same transaction.
- `read_device_verification_material` returns only the exact active device key ID, opaque bound
  source ID, and Ed25519 public key. Paused/unlinked sources, revoked devices, and deletion-pending
  profiles return no material; quarantined sources remain verifiable so their submissions can be
  retained as quarantined evidence.
- `submit_community_sync` revalidates the exact activated device/source binding, schema-level
  identifier/version/date/token/digest bounds, millisecond timestamp precision, and a server-time
  replay window. It records one nonce per device and one snapshot per device/sync ID, returns an
  exact retry as `duplicate`, quarantines a whole decrease, quarantined source, or payload touching
  a server-closed season, and advances one monotonic current value per source/date without summing
  devices. Server `receivedAt` is captured after the affected season locks so waiting cannot
  backdate acceptance. Paused/unlinked sources, revoked devices, and deletion-pending profiles fail
  closed.
- `cleanup_expired_ingest_state` accepts only a batch size from 1 through 1000, derives both cutoffs
  from server time, and serializes Jobs callers. Each call deletes at most one batch of expired
  device nonces and one batch of expired raw snapshots. Snapshot entries cascade; current source/day
  values remain and only their expired raw-snapshot reference is cleared.
- `refresh_community_season` accepts only a bounded ISO Monday before its exact grace deadline,
  serializes Jobs and Ingest at that season, and atomically replaces the private Community score
  projection. An open no-data week remains a state-free no-op.
- `finalize_community_season` accepts the same bounded ISO calendar only at or after grace,
  rematerializes once, and records an immutable terminal timestamp. Exact retries return the stored
  result; a closed no-data week records one terminal definition, and no runtime correction exists.
- `list_public_community_scores` is Web-only and returns at most 100 active-profile rows for one
  bounded ISO season. It exposes only dates, score version/finalized state, handle, score, active
  days, source count, shared rank, and deterministic display position. Visibility filtering happens
  before public re-ranking; no identifier, raw value, daily detail, or exact timestamp is returned.

The public schema safety ceilings are 8 to 16 codes per replacement recovery batch, one active
recovery authority per profile for at most ten minutes, 32 lifetime passkey records, 32 active
unexpired browser sessions, 32 lifetime source records, 64 active plus unexpired approved device
authorities per profile, and 100 rows per public score read. They bound retained credential growth,
authority fan-out, and one response; they are not substitutes for lower deployment-specific fair-use
limits, edge rate limits, cache design, capacity evidence, or bounded cleanup.

The application must call `complete_passkey_login` or `consume_passkey_challenge` only after it has
verified the exact WebAuthn RP ID, origin, challenge, transaction context, signature, and
user-verification result against the returned credential material. It must verify the connector's
Ed25519 possession proof over the exact returned pairing material before activation. These SQL
procedures implement neither cryptographic verification nor network rate limiting. ADR 0015's local
Ingest kernel validates the exact bounded `ConnectorSyncV1` body, body-bound origin proof, and
canonical strict Ed25519 request against an injected minimal lookup. ADR 0016's adapter can provide
that lookup and map only a reconstructed, contract-revalidated allowlist to `submit_community_sync`
through fixed parameterized SQL, a four-client deadline-bound pool, and an exact Ingest
login/role/search-path probe. The database still independently enforces binding, replay, time,
lifecycle, season, and monotonic state. A future HTTP service must preserve the exact raw envelope,
use ADR 0017's protected key reader plus persistent replay, compose verifier and adapter, and map
only a generic public acknowledgement. The mock-pool evidence is not a live login or PostgreSQL
integration result. In particular, the anonymous login-challenge endpoint is not launch-ready
without edge/service limits and bounded expiry cleanup. Procedures use one generic failure message
for closed authorization and constraint failures; HTTP status mapping and response shaping remain
application work. Recovery SQL now uses a short-lived restricted authority and never represents it
as an ordinary session, but application Argon2id/pepper and WebAuthn verification, timing
normalization, rate limits, cleanup, notifications, and UI remain absent. The deletion procedure
implements immediate lock-down only; primary purge, cache purge, tombstones, backup replay, and
user-visible progress remain unimplemented.

## Data and privacy map

All current columns map to the canonical [privacy data map](../docs/security/PRIVACY_DATA_MAP.md):

| Tables                                      | Classes                       | Stored boundary                                                                    |
| ------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------- |
| `profiles`                                  | Account; handle is Public     | Numeric GitHub binding, normalized handle, explicit preferences, lifecycle time    |
| `invites`, `sessions`, `auth_challenges`    | Security                      | Keyed verifiers, exact session/passkey provenance, expiry, and one-time use        |
| `passkeys`, `recovery_codes`                | Security; label is Account    | Public credential material, opaque selectors, and unused PHCs; no plaintext        |
| `recovery_authorities`                      | Security                      | Keyed/challenge/context digests, terminal state, expiry, and opaque provenance     |
| `codex_sources`                             | Account                       | Opaque source ID, owning profile, and constrained lifecycle state                  |
| `device_keys`, `pairing_transactions`       | Security; metadata is Account | Ed25519 public key, exact source/device binding, keyed poll/code verifiers         |
| `deletion_jobs`, `deletion_tombstones`      | Security; Operational         | Keyed identity references, bounded work state, lease digest, and expiry            |
| `audit_events`                              | Security; Operational         | Closed event/actor enums, request reference, reason code, and server time          |
| `maintenance_locks`                         | Operational                   | Fixed owner-only cleanup/scoring mutex rows; no user or request data               |
| `device_nonces`                             | Security                      | Device-bound replay digest and 15-minute expiry marker                             |
| `usage_snapshots`, `usage_snapshot_entries` | Usage; Security               | Bounded signed snapshot metadata, exact private daily values, 30-day expiry marker |
| `source_day_values`                         | Usage                         | One monotonic current token value and accepted provenance per source/date          |
| `score_versions`, `seasons`                 | Operational; Public           | Immutable formula, ISO-week binding, grace, and terminal state                     |
| `season_entries`, `season_daily_scores`     | Public                        | Private pre-projection scores, active days, source count, rank, and display order  |
| `schema_migrations`                         | Operational                   | Revision name and server application time only                                     |

The schema has no column for GitHub access tokens, account email, prompts, conversations, repository
data, Codex credentials, API keys, local paths, arbitrary payloads, or raw support evidence.
Free-form JSON and arbitrary audit metadata are intentionally absent.

Audit rows never store a handle, session verifier, WebAuthn material, request body, IP address, or
arbitrary metadata. The profile foreign key is nulled when a profile is purged, and the integration
test proves that this redaction cannot block deletion. Retention and any external append-only audit
sink remain launch decisions; the current table is only a bounded application reference.

Pending device key records have no source, public device ID, or authority. Activation atomically
sets all three lifecycle fields, and a composite foreign key proves that the activated device is the
exact key record shown during pairing. A key record then moves only `active → revoked` and cannot be
rebound to another source.

Revision 0005 deliberately invalidates every pre-revision ceremony and approved-but-not-activated
pairing because they lack exact verifying-passkey provenance. It also revokes legacy active browser
sessions for profiles that already have passkeys, requiring one fresh login after upgrade. This is a
security migration, not a user-data purge: profiles, passkeys, sources, and activated devices
remain.

Revision 0006 preserves existing unused recovery-code rows, makes used verifier state terminal and
scrubbed, and adds no HTTP endpoint. Protective operations serialize on the profile and use time
captured after lock acquisition: an old-code start can never survive fresh rotation, and an
old-passkey login can never remain active after successful recovery completion.

Revision 0007 stores only fields already mapped for the Community sync boundary: opaque
device/source/sync IDs, connector/Codex versions, a body digest, submitted signature, nonce digest,
exact private `codexReportedDate` values, tokens, server receipt time, and closed outcome/reason
state. Nonce and snapshot rows carry 15-minute and 30-day expiry markers respectively. Raw values
remain private owner-only tables, and runtime access is procedure-only. Current source/day
provenance must match one exact accepted snapshot entry; deleting that raw snapshot clears only its
reference and preserves the current value.

Revision 0008 turns those two expiry markers into one callable Jobs-only deletion boundary. It uses
server time, rejects null, zero, negative, or over-1000 batch sizes, serializes workers with a
private owner-only mutex row plus a five-second lock timeout, and leaves live rows untouched. The
procedure and observed two-worker race are deletion evidence for the isolated SQL boundary only: no
production scheduler, monitoring, retention policy, or real-user purge evidence exists. ADR 0014's
local runner can invoke one fixed maximum-size batch only after its Jobs-role probe; no live login
or Node-to-PostgreSQL integration is supplied.

Revision 0009 materializes only an open Community season. It binds each ISO Monday-through-Sunday
season to immutable `community_v1` parameters, sums current eligible source/day values with numeric
overflow protection, applies one daily profile cap after distinct-source aggregation, and computes
weekly score, active days, contributing-source count, shared rank, and deterministic display order
atomically. Hidden/deleting profiles and quarantined sources are excluded; paused or unlinked source
history remains eligible. The score tables copy neither raw token totals nor source IDs. A private
mutex, five-second lock timeout, and 30-second statement deadline bound Jobs callers; a week without
stored source/day state creates no empty season. Repeated or concurrent refreshes converge on the
same semantic state.

Revision 0010 closes each season at Wednesday 00:00 UTC after its ISO week, using only server
`receivedAt`. A payload touching any closed season is retained atomically as `season_closed` but
cannot update accepted source/day state. Ingest and Jobs acquire per-season locks before
profile/source/device locks; the observed finalization-versus-late-Ingest race proves this order is
deadlock-free. Jobs may refresh only before grace and may finalize only at or after grace. The
terminal transition rematerializes once, records its immutable timestamp, supports an exact
idempotent retry, and rejects direct metadata or projection mutation. Profile purge can still
cascade personal score rows without reopening the non-personal season record. A closed no-data week
stores one terminal season, bounded to the ISO weeks reachable from the contract's `20xx` dates. No
correction record, Jobs scheduler/monitor, live integration, or production capacity claim is
implemented. The local one-shot runner selects only the prepared refresh/finalization call after a
closed canonical-season command and a least-privilege session probe.

Revision 0011 exposes only a bounded score projection to the Web role. It filters current profile
state to `active`, then recomputes shared rank and contiguous display position so hide/purge leaves
no public gap. Its exact ten fields omit private IDs, raw/daily values, and exact timestamps;
Ingest, Jobs, Admin, and `PUBLIC` are denied. Ranking still evaluates the visible season before the
100-row result cap, so the five-second database deadline is defense in depth rather than capacity
evidence. A separate server-only Web mapper now narrows an unknown adapter result to the canonical
top-32 response and fails closed on projection drift. ADR 0011 adds a bounded `pg` adapter that
verifies its Web-only deployment login/session before each fixed parameterized call, casts calendar
dates to text, and applies that mapper. No HTTP route, cache/invalidation, car, streak, rounded
freshness, profile detail, rate limit, deployment login/TLS integration, or live adapter connection
is implemented.

The recovery-code string in the integration fixture is an intentionally weak, obviously synthetic
PHC-format sample used only to test the database constraint. Production work factors and peppers
belong to private deployment configuration and require application-level tests before use.

## Migration workflow

1. Read `AGENTS.md`, the relevant ADRs, threat/abuse cases, and privacy data map.
2. Add a new zero-padded migration; never rewrite a migration already used by a released or shared
   environment.
3. Use one transaction, bounded lock/statement time, the advisory migration lock, and
   `SET LOCAL ROLE viberacing_owner`.
4. Add the exact revision/name ledger insert, calculate the SHA-256 digest, and update the manifest.
5. Add constraint, role-denial, concurrency, cleanup, and failure-path evidence appropriate to the
   change.
6. Run the static and real PostgreSQL gates, then the complete repository gate.
7. Review the exact staged SQL and checksum before commit.

Focused commands:

```text
pnpm run test:database-check
pnpm run check:database
pnpm run test:database:integration
```

The first two commands are offline and part of `pnpm run verify`. The integration command requires
Docker, starts only the opt-in `postgres-test` service with no host port, uses ephemeral `tmpfs`
storage, and removes its uniquely named Compose project in `finally`. It never connects to the
normal `postgres` volume.

## Rollback and deployment boundary

Migrations are forward-only. A SQL error rolls back its revision atomically. Before any shared
environment exists, a disposable local/test database can be discarded and rebuilt. After a migration
reaches a shared environment, repair it with a reviewed forward migration; do not add a destructive
generic down script or edit the recorded file.

Production bootstrap, login creation, role membership, TLS, credentials, backups, restore, retention
schedules, and migration orchestration remain deployment work. The bootstrap file must run only
through the protected migration principal. An unexpected pre-existing group-role membership is a
hard failure, not something the script silently broadens or repairs.

## Remaining security work

- Implement OAuth/cookie/CSRF and WebAuthn application flows without weakening the
  session/passkey-bound database contract.
- Implement the application recovery boundary: bounded Argon2id with protected pepper, exact
  WebAuthn verification, generic response/timing behavior, cookies/CSRF, notifications, inventory,
  and provenance-preserving cleanup at the 32-passkey lifetime edge.
- Add edge/service rate limiting and bounded cleanup for unauthenticated pairing starts,
  passkey-login challenges, and recovery-code lookups; do not encode deployable private thresholds
  in this repository.
- Wrap the local Ingest verification kernel and protected key reader with an exact-byte HTTP
  boundary, live secret-manager/edge key injection, persistent replay store, generic public errors,
  no-queue admission, socket deadlines, backpressure, and rate limits. Compose them with the local
  least-privileged PostgreSQL adapter through a deployment-provisioned login and verified TLS, then
  add integration/load evidence.
- Implement a scheduler, monitoring, retry/overlap policy, live login/TLS integration, and capacity
  evidence around the local one-shot Jobs cleanup/refresh/finalization runner, plus audited
  corrections and freshness/streak projection.
- Integrate the bounded database adapter and local score route with a deployment-provisioned
  Web-only login and verified TLS, then add cache/invalidation, edge request shaping,
  query-plan/load evidence, monitoring, and deployment verification.
- Define a separate complete race/profile contract when CarRecipe, streak, freshness, and profile
  detail have real persistence and lifecycle evidence.
- Schedule and monitor the implemented ingest-retention procedure, and implement bounded cleanup for
  ceremonies, sessions, pairings, jobs, recovery authority, and tombstones. Expiry columns outside
  the revision 0008 boundary are not cleanup.
- Replace every launch-decision retention item with public policy and purge evidence.
- Exercise migration overlap, backup restore, deletion replay, role rotation, and service rollback
  in isolated staging before real-user ingestion.
