# Database persistence foundation and capabilities

## Status

This directory contains thirty-nine SQL-first revisions for identity, passkey login and management,
restricted recovery, source, device, pairing, audit, deletion, Community usage, scoring, season
finalization, and CarRecipe proposal state. The migrations, narrow database procedures, and
PostgreSQL integration tests are implemented. A local invite/OAuth/initial-passkey,
returning-passkey, session-scoped passkey, source/device inventory, source
pause/reactivation/unlink, and immediate device-revoke application now consumes only fixed Web/Auth
capabilities with injected or synthetic dependencies. The same local boundary also performs bounded
recovery-code Argon2id verification and replacement WebAuthn verification before fixed recovery
calls. It now also performs session-rate-limited browser pairing review and fresh-passkey approval
for an explicit new or active existing source. Closed local start/poll routes now consume the
pairing applications through the same protected Web capability; no production credential or deployed
database consumes them. A Web/Auth boundary creates bounded pairing material through one fixed start
call; a second composes keyed pairing lookup, strict Ed25519 possession proof, and exact activation
through the same mock-tested fixed-query pool, but neither has a live login or transport. A local
Ingest kernel verifies a bounded exact-body origin/device request, and a separate fixed-query
adapter maps origin replay plus its output to three capabilities through a probed least-privileged
pool. Focused tests use mock pools. A separate opt-in integration creates a synthetic dedicated
Ingest login, passes independently signed loopback HTTP through the emitted host, and verifies the
exact database result. A separate opt-in Web integration builds and starts two emitted standalone
Next production processes against a TLS-enabled disposable narrow `viberacing_web` login, rejects a
deliberately widened login, validates exact public score/race/status contracts plus TLS 1.2/1.3, and
fingerprints every private table before and after both paths. It also holds exactly four score
queries behind an owner lock, rejects a fifth without a fifth public-score query, and validates all
four after rollback. The local one-shot Jobs runner has its own synthetic disposable-login
integration. No reusable or deployment certificate/login is supplied. The database-only ingest and
Jobs-only ingest-retention, pairing-retention, authentication-retention, invite-retention,
session-retention, abandoned-enrollment, CarRecipe-proposal, finalized-source-day,
terminal-deletion-job, audit-event, revoked-passkey, and revoked-device retention, pairing
approval-provenance redaction, primary profile deletion, open-season scoring, and terminal
finalization procedures plus Web-only public score/race/status and exact-session private score
projections are implemented; deployed HTTP ingest, host-timer delivery, a wall-clock recurring
scheduler process callback, OS-delivered process-signal/PostgreSQL behavior, deployed cadence,
audited corrections, cache/backup/tombstone purge, and restore replay are not. Fixed-clock startup,
injected repeated timer, injected lifecycle, and real-clock emitted-process terminal-marker evidence
are proven synthetically.

The `viberacing_api` schema is a closed procedure boundary. Runtime roles receive no direct private
table access. Profile-scoped procedures derive identity from an exact active session ID and keyed
32-byte verifier instead of accepting a caller-selected profile ID. The database still relies on
Web/Auth to perform OAuth and WebAuthn cryptographic verification before invoking the matching
procedure. The local identity slice does so for enrollment, login, passkey, recovery, profile,
device, source, pairing-approval, and CarRecipe proposal/decision controls with injected/synthetic
evidence. Pairing start/poll transport is locally implemented, but live credentials and deployment
remain absent. The stable public score read remains car-free; a separate compatible race read can
project only an active profile's current approved recipe. A third compatible status read preserves
those contracts while adding UTC-day-rounded freshness and an optional preference-gated streak.
Exact receipt time and daily score history remain private. A separate Web-only device proposal
capability now admits an exact signed recipe from an active source-bound device without granting
read/approve/reject/activate authority. Expired-proposal cleanup is a bounded local Jobs capability
in the default-off scheduler catalog and combined synthetic PostgreSQL integration, but no
production login, monitoring, deployed cadence, or deployment exists.

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
- `migrations/0012_origin_replay_store.sql` adds one forced-RLS origin replay table, atomic
  Ingest-only nonce consumption, and origin-nonce deletion to the existing Jobs cleanup procedure.
- `migrations/0013_pairing_retention_cleanup.sql` adds Jobs-only bounded deletion of expired
  non-activated pairing transactions and their still-pending keys through a separate private mutex.
- `migrations/0014_passkey_login_session_result.sql` composes post-proof login challenge creation
  and consumption with session minting, then returns only the three encrypted-cookie presentation
  fields to Web/Auth.
- `migrations/0015_profile_visibility.sql` gives only Web the exact-session closed visibility read
  and idempotent `active`/`hidden` transition.
- `migrations/0016_hidden_profile_device_controls.sql` preserves private source/device inventory and
  immediate owned-device revoke for an exact possessed session while public visibility is hidden.
- `migrations/0017_hidden_profile_source_pause_reactivation.sql` preserves immediate source pause
  and fresh-passkey paused-source reactivation for a possessed session while visibility is hidden.
- `migrations/0018_hidden_profile_source_unlink.sql` preserves terminal fresh-passkey source unlink
  for a possessed session while visibility is hidden.
- `migrations/0019_account_score_read.sql` gives only Web an exact-session read of one active
  profile's existing derived season summary and seven daily scores; hidden profiles return no rows.
- `migrations/0020_recovery_session_result.sql` composes successful restricted recovery completion
  with only profile ID, handle, and locale for post-commit session-cookie sealing.
- `migrations/0021_pairing_approval_attempt_policy.sql` adds a session-bound distributed attempt
  window, replaces Web access to the unbounded pairing lookup with one fixed two-key candidate
  lookup, and keeps deployment policy values outside tracked configuration.
- `migrations/0022_pairing_transport_rate_policy.sql` adds 130 fixed global/client-bucket window
  rows and one Web-only anonymous start/poll admission function without retaining a client ID or
  digest.
- `migrations/0023_auth_retention_cleanup.sql` adds Jobs-only bounded deletion of expired
  authentication challenges, restricted recovery authorities, and exact still-present used/scrubbed
  source-code rows under profile-first recovery serialization.
- `migrations/0024_profile_deletion_purge.sql` adds Jobs-only maximum-10 primary deletion of due
  `deletion_pending` profiles under all-maintenance serialization, restrictive-pairing cleanup, and
  atomic terminal job settlement.
- `migrations/0025_car_recipe_proposals.sql` adds one forced-RLS active recipe and at-most-one
  pending proposal per profile plus Web-only exact-session propose/read/approve/reject capabilities.
- `migrations/0026_car_recipe_proposal_cleanup.sql` adds Jobs-only maximum-1000 physical deletion of
  expired pending recipes under a separate private mutex while preserving live and active recipes.
- `migrations/0027_community_public_race_read.sql` adds a separate Web-only
  score-plus-current-recipe projection while preserving the stable score function and every private
  proposal field.
- `migrations/0028_connector_car_proposal_ingress.sql` adds Web-only minimal active-device material
  and exact device-proposal functions with profile/source/device revalidation and nonce replay
  consumption; it adds no activation authority.
- `migrations/0029_community_public_race_status.sql` adds a positive-score lookup index and a
  separate Web-only race-status projection with rounded freshness and preference-gated streak while
  preserving both older public functions.
- `migrations/0030_session_retention_cleanup.sql` adds Jobs-only maximum-1000 physical deletion of
  expired sessions that are no longer retained by rotation or pairing provenance. It shares the
  authentication mutex, cascades unusable session challenges, and preserves live sessions and every
  pairing approval reference until the separate aged-provenance redaction permits cleanup.
- `migrations/0031_invite_retention_cleanup.sql` adds Jobs-only maximum-1000 physical deletion of
  expired active or revoked invite verifier rows under the shared authentication mutex while
  preserving live invites and redeemed enrollment provenance.
- `migrations/0032_terminal_deletion_job_retention_cleanup.sql` adds Jobs-only maximum-1000 physical
  deletion of `purged`, profile-free deletion jobs only after 30 days from server-recorded
  completion under the shared profile-deletion mutex.
- `migrations/0033_audit_event_retention_cleanup.sql` adds Jobs-only maximum-1000 physical deletion
  of database audit events only after 180 days from server-recorded occurrence under a separate
  private mutex.
- `migrations/0034_pairing_approval_provenance_retention.sql` adds Jobs-only maximum-1000 redaction
  of the exact approving session/passkey references from activated pairings only after 180 days,
  while preserving every profile/source/device binding and the pairing, device, and passkey rows.
- `migrations/0035_revoked_passkey_retention_cleanup.sql` adds Jobs-only maximum-1000 deletion of
  passkeys only after 180 days in revoked state and only when no session, verifying/authorized
  challenge, or pairing reference remains.
- `migrations/0036_revoked_device_retention_cleanup.sql` adds Jobs-only maximum-1000 paired deletion
  of an activated pairing and its exact revoked device key only after both are at least 180 days
  old, approval provenance is redacted, and no authorization challenge, nonce, or raw snapshot
  remains.
- `migrations/0037_pairing_rate_window_retention_reset.sql` adds a zero-argument Jobs-only reset of
  positive fixed pairing request windows only after the maximum one-hour duration, preserving all
  130 operation/global/bucket rows.
- `migrations/0038_abandoned_enrollment_retention_cleanup.sql` adds Jobs-only maximum-1000 physical
  deletion of canonical `enrolling` profiles only after every exact enrollment session and
  registration challenge expires, while preserving any active/non-enrollment, recovery,
  passkey/source, deletion, scoring, recipe, or malformed-invite state and retaining redacted audit
  evidence.
- `migrations/0039_finalized_source_day_retention_cleanup.sql` captures a private UTC-day/count
  projection at terminal finalization, keeps the compatible public race-status result stable, and
  adds Jobs-only maximum-1000 physical deletion of exact source/day rows only after 30 days and
  repeated live/captured integrity checks.
- `tests/identity_invariants.sql` uses deterministic synthetic rows inside a rolled-back transaction
  to exercise valid state and expected integrity failures.
- `tests/identity_capabilities.sql` exercises the exact grant matrix, session possession,
  cross-profile denial, private derived-score read/hide/republish, visibility
  hide/publish/idempotency, expiry, replay, rollback, audit redaction, and synchronous deletion
  effects.
- `tests/car_recipe_proposals.sql` exercises exact browser and device recipes, replacement without
  activation, approval/replay, rejection, hidden-profile access, paused-source and key/device
  denial, malformed values, wrong session proof, and the Web-only grant matrix.
- `tests/car_recipe_proposal_cleanup.sql` exercises oldest-first batch deletion, idempotency, live
  and active-state preservation, invalid bounds, missing mutex, and the Jobs-only grant matrix.
- `tests/pairing_capabilities.sql` exercises session-bound attempt blocking/reset, key-rotation
  lookup, new/existing-source choice, first-winner rebinding denial, replay, poll possession, exact
  activation, immutable binding, and public safety ceilings.
- `tests/source_device_lifecycle.sql` exercises inventory isolation, hidden-profile
  inventory/revoke, source/device IDOR denial, step-up binding, replay, quarantine separation, stale
  challenge/pairing cancellation, recursive device revoke, and audit-failure rollback.
- `tests/passkey_capabilities.sql` exercises credential-derived login, replay and rollback,
  monotonic usage state, session provenance, private inventory, multi-passkey add/revoke, last-key
  protection, cross-profile denial, and public safety ceilings.
- `tests/recovery_capabilities.sql` exercises exact-passkey code rotation, bounded PHC batches,
  profile-free lookup, one-time scrub and authority, exact completion binding, deletion revoke,
  retained activated devices, role denial, rollback, the retained-passkey fail-closed edge, and
  successful retry after bounded revoked-passkey cleanup.
- `tests/revoked_passkey_retention.sql` exercises oldest-first deletion, exact cutoff, every
  restrictive provenance reference, active/recent preservation, invalid bounds, missing mutexes,
  idempotency, and the Jobs-only grant matrix.
- `tests/revoked_device_retention.sql` exercises oldest-first paired deletion, exact cutoff,
  approval/challenge/nonce/snapshot blockers, active/recent preservation, invalid bounds, missing
  mutexes, idempotency, atomic rollback, and the Jobs-only grant matrix.
- `tests/usage_ingest.sql` exercises exact device/source binding, strict bounds, canonical time,
  replay/idempotency, same-source device deduplication, monotonic state, quarantine, lifecycle
  rejection, retention markers, direct-transition constraints, and the exact role boundary.
- `tests/origin_replay.sql` exercises first use, exact replay, rotation-key separation,
  expired-tuple reuse, strict digest/key/time input, and bounded proof lifetime.
- `tests/ingest_cleanup.sql` exercises batch bounds, deterministic expiry order, idempotency,
  live-row preservation, entry cascade, retained current values, and detached raw provenance.
- `tests/finalized_source_day_cleanup.sql` exercises finalization capture, backfill bounds,
  unchanged public status, oldest-first row progress, exact inventory drift rollback, recent/open/
  missing-projection preservation, profile-purge cascade, invalid bounds, missing mutexes, and
  Jobs-only authority.
- `tests/finalized_source_day_migration_setup.sql` and
  `tests/finalized_source_day_migration_assertions.sql` place one synthetic terminal season after
  revision 0038, then prove revision 0039 backfills its exact UTC-day/count projection without
  changing source/day state.
- `tests/pairing_cleanup.sql` exercises bounded oldest-first pending/approved/cancelled deletion,
  challenge cascade, idempotency, activated/live preservation, mutex failure, and exact role denial.
- `tests/auth_cleanup.sql` exercises independent challenge/authority bounds, consumed and terminal
  deletion, live and unused-code preservation, idempotency, full expiry indexes, mutex failure, and
  exact role denial.
- `tests/invite_cleanup.sql` exercises oldest-first active/revoked invite deletion, idempotency,
  live and redeemed preservation, invalid bounds, supporting index, mutex failure, and exact role
  denial.
- `tests/session_cleanup.sql` exercises oldest-first session bounds, active/revoked/rotated
  deletion, rotation-chain progress, challenge cascade, idempotency, live and pairing-provenance
  preservation, invalid batches, supporting indexes, mutex failure, and exact role denial.
- `tests/abandoned_enrollment_cleanup.sql` exercises oldest-first batch deletion, exact direct
  profile-FK inventory, profile/invite/session/challenge cascade, audit redaction, idempotency,
  live/active and every non-enrollment/recovery/passkey/source/deletion/score/recipe/ invite-drift
  preservation, invalid bounds, both mutexes, and exact role denial.
- `tests/profile_deletion_purge.sql` exercises maximum-10 oldest-first due work, retry/future state,
  idempotency, committed-state drift rollback, mutex failure, no-tombstone scope, and exact role
  denial. The identity capability scenario additionally runs the real request queue through purge
  and checks restrictive pairing, pending-key, identity/source/device, score, audit, and job state.
- `tests/deletion_job_cleanup.sql` exercises oldest-first 30-day terminal-job cleanup, recent,
  linked, and non-terminal preservation, idempotency, invalid bounds, supporting index, mutex
  failure, and exact role denial.
- `tests/audit_event_cleanup.sql` exercises oldest-first 180-day audit cleanup, profile-linked and
  redacted eligibility, recent-event preservation, idempotency, invalid bounds, supporting index,
  mutex failure, and exact role denial.
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
- `tests/car_recipe_device_proposal_concurrency_setup.sql` and
  `tests/car_recipe_device_proposal_concurrency_assertions.sql` prove source pause serializes ahead
  of a queued device proposal without leaving a proposal or replay nonce.
- `tests/origin_replay_concurrency_setup.sql` and `tests/origin_replay_concurrency_assertions.sql`
  prove two ordered contenders for one locked expired tuple yield exactly one fresh consume and
  leave one live row.
- `tests/ingest_season_lock_assertions.sql` plus the integration runner prove two payloads listing
  the same seasons in opposite order acquire the lower season first and both complete without a
  deadlock.
- `tests/cleanup_concurrency_setup.sql` and `tests/cleanup_concurrency_assertions.sql` prove two
  Jobs cleanup calls serialize and each expired raw row is removed once without deleting live state.
- `tests/finalized_source_day_cleanup_concurrency_setup.sql` and
  `tests/finalized_source_day_cleanup_concurrency_assertions.sql` prove two cleanup workers
  serialize, a concurrent finalization remains terminal without becoming prematurely eligible, and
  primary profile purge waits for cleanup before cascading the projection.
- `tests/pairing_cleanup_concurrency_setup.sql` and
  `tests/pairing_cleanup_concurrency_assertions.sql` prove two pairing-cleanup calls serialize,
  delete each expired transaction/key pair once, and preserve live pending state.
- `tests/revoked_passkey_concurrency_setup.sql` and
  `tests/revoked_passkey_concurrency_assertions.sql` prove two one-row cleanup calls serialize,
  delete both aged revoked credentials once, and preserve recent plus active credentials.
- `tests/auth_cleanup_concurrency_setup.sql`, `tests/auth_cleanup_concurrency_assertions.sql`, and
  `tests/auth_cleanup_recovery_race_assertions.sql` prove two auth-cleanup calls serialize and that
  cleanup follows profile-first recovery lock order while preserving a concurrent new authority.
- `tests/session_cleanup_concurrency_setup.sql` and
  `tests/session_cleanup_concurrency_assertions.sql` prove two session-cleanup calls serialize on
  the shared auth mutex, remove each expired batch once, and preserve live authority.
- `tests/abandoned_enrollment_cleanup_concurrency_setup.sql` and
  `tests/abandoned_enrollment_cleanup_concurrency_assertions.sql` prove two cleanup workers
  serialize and an in-flight initial-passkey activation commits while cleanup skips its locked
  profile without waiting.
- `tests/invite_cleanup_concurrency_setup.sql` and `tests/invite_cleanup_concurrency_assertions.sql`
  prove two invite-cleanup calls serialize on the shared auth mutex, remove each expired batch once,
  and preserve live authority.
- `tests/profile_deletion_purge_concurrency_setup.sql` and
  `tests/profile_deletion_purge_concurrency_assertions.sql` prove two purge calls serialize and that
  purge holds the authentication-cleanup mutex before any primary profile cascade.
- `tests/deletion_job_cleanup_concurrency_setup.sql` and
  `tests/deletion_job_cleanup_concurrency_assertions.sql` prove two terminal-job cleanup calls
  serialize, remove each aged batch once, and preserve recent evidence.
- `tests/audit_event_cleanup_concurrency_setup.sql` and
  `tests/audit_event_cleanup_concurrency_assertions.sql` prove two audit cleanup calls serialize,
  remove each aged batch once, and preserve recent evidence.
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
- `scripts/test-ingest-postgres-integration.mjs` owns a separate one-off `postgres-test` container
  with only an ephemeral loopback-published port. It applies the same reviewed manifest, creates a
  synthetic login with only `viberacing_ingest`, sends signed HTTP through emitted Ingest host code,
  validates accepted/duplicate/replay/revoke responses and exact stored state, then holds four valid
  requests at the first replay-store call, rejects a fifth without a fifth replay call, releases the
  four to exact accepted results, closes the imported host, and starts the built host entry point as
  a separate silent child for one more exact accepted write. It forcibly ends only that child and
  removes the blocker, container, network, and storage; this is not graceful process-shutdown
  evidence.
- `scripts/test-web-postgres-integration.mjs` owns another one-off `postgres-test` container with an
  ephemeral loopback-published port, applies the same reviewed manifest, starts the three real Next
  development GETs, proves an extra-membership Web login fails generically without mutation,
  validates exact public contracts through the narrow login, fingerprints every private table,
  proves the four-request no-queue boundary with a controlled owner lock, and removes both Web
  processes plus the blocker, container, network, and storage.

## Capability model

| Role                | Login | Private schema | API schema | Current executable capability                                                       |
| ------------------- | ----- | -------------- | ---------- | ----------------------------------------------------------------------------------- |
| `viberacing_owner`  | No    | Owns objects   | Owns       | Migration and procedure implementation                                              |
| `viberacing_web`    | No    | None           | Usage      | Identity/passkey/recovery/pairing/lifecycle plus score/race/status reads            |
| `viberacing_ingest` | No    | None           | Usage      | Origin replay, device verification, and Community sync only                         |
| `viberacing_jobs`   | No    | None           | Usage      | Twelve cleanup calls, one redaction, one reset, profile purge, scoring/finalization |
| `viberacing_admin`  | No    | None           | Usage      | Bounded invite issuance only                                                        |
| `PUBLIC`            | N/A   | None           | None       | None                                                                                |

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
  passkey-bound session. Revision 0014's `complete_passkey_login_session` stores the sealed-cookie
  challenge only after application proof verification, immediately consumes it through that same
  capability, and returns only profile ID, handle, and locale after success. Known revoked and
  unknown credentials both return no material.
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
  closed at 32 retained passkey records; revision 0035 can later remove only old unreferenced
  revoked rows before an unchanged recovery attempt is retried. Revision 0020's
  `complete_recovery_registration_session` invokes that exact capability and returns only profile
  ID, handle, and locale after success; it grants no additional authority.
- `rotate_session` and `revoke_session` require the exact keyed verifier. Rotation serializes on the
  current session/profile, preserves its authentication provenance, and creates a fresh bounded
  record before ending the old one.
- `cleanup_expired_sessions` is Jobs-only, locks the existing private authentication-retention
  mutex, and deletes at most 1000 expired sessions in deterministic order only when no retained
  rotation predecessor or pairing approval references them. It repeats those predicates at delete,
  cascades their unusable challenges, and returns only one bounded count.
- `cleanup_expired_invites` is Jobs-only, shares that private mutex, and deletes at most 1000
  expired active or revoked invites in deterministic order. It repeats state and expiry at delete,
  preserves every live or redeemed row, and returns only one bounded count.
- `cleanup_abandoned_enrollments` is Jobs-only, locks the authentication- then profile-purge
  mutexes, and deletes at most 1000 oldest-first `enrolling` profiles only when one redeemed invite
  exists, every session is exact expired enrollment authority, every challenge is exact expired
  registration authority, and no recovery/passkey/source/deletion/score/recipe state exists. It
  repeats every predicate, skips a locked activation row, cascades the expired private enrollment
  state, retains audit rows with null profile linkage, and returns only one bounded count.
- `cleanup_terminal_deletion_jobs` is Jobs-only, shares the private profile-deletion mutex, and
  deletes at most 1000 oldest-first `purged`, profile-free jobs at least 30 days after completion.
  PostgreSQL derives the cutoff; the function repeats every eligibility predicate and returns only
  one bounded count.
- `cleanup_expired_audit_events` is Jobs-only, locks a separate private audit-retention mutex, and
  deletes at most 1000 oldest-first audit rows at least 180 days after server-recorded occurrence.
  PostgreSQL derives the cutoff; the function repeats it at delete and returns only one bounded
  count.
- `redact_aged_pairing_approval_provenance` is Jobs-only, locks the authentication- then
  pairing-retention mutexes, and redacts at most 1000 oldest-first activated pairing session/passkey
  references at least 180 days after activation. PostgreSQL derives and repeats the cutoff; the
  exact trigger transition preserves the approved profile/source, activation device/time, pairing,
  device, and passkey rows and returns only one bounded count.
- `cleanup_aged_revoked_passkeys` is Jobs-only, locks the same authentication- then
  pairing-retention mutexes, and deletes at most 1000 oldest-first passkey rows only after 180 days
  in revoked state. PostgreSQL derives and repeats the cutoff plus the absence of session,
  verifying/authorized challenge, and pairing references; active or referenced credentials never
  qualify.
- `cleanup_aged_revoked_devices` is Jobs-only, locks the existing Ingest- then pairing-retention
  mutexes, and deletes at most 1000 oldest-first activated pairing/revoked-device pairs only after
  180 days. PostgreSQL derives and repeats both cutoffs, exact binding, minimized approval, and the
  absence of authorization-challenge, nonce, and raw-snapshot references; both returned counts must
  match.
- `reset_expired_pairing_request_windows` is Jobs-only and accepts no arguments. It verifies the
  fixed 130-row matrix and resets only positive aggregate timestamps/counts older than the maximum
  one-hour admission duration to the exact epoch/zero state while preserving every row. Ordered row
  locks serialize overlapping reset workers and Web admission.
- `read_profile_visibility` maps only the possessed active session's current profile state to
  `public` or `hidden`. `set_profile_visibility` accepts no profile ID, moves only between active
  and hidden, preserves source sync, and treats repeated state as a no-op.
- `read_profile_score` authenticates the exact active or hidden session and accepts one bounded
  canonical Monday. It returns only the active profile's existing derived weekly score, active-day
  and contributing-source counts, season dates/state, and seven 0–1000 daily scores. It exposes no
  raw usage or private identifier; a hidden profile returns no rows.
- `request_profile_deletion` derives the target from the possessed session, requires the exact typed
  handle and a consumed, unused deletion challenge, then atomically hides the profile, revokes
  active browser/passkey/device authority, removes recovery/challenge state, unlinks sources,
  cancels approved pairings, and queues one opaque deletion job.
- `start_pairing` stores only keyed poll/code verifiers, a bounded challenge, immutable pending
  public key, and bounded display metadata for at most ten minutes. ADR 0028's transport-free Web
  boundary now generates all IDs, 32-byte token/challenge material, a separate keyed 60-bit human
  code, and a nine-minute expiry before invoking only this fixed procedure through the probed
  read-write Web pool. Tests use injected pools and create no live row.
- `read_pairing_for_approval_limited`, `create_pairing_approval_challenge`, and `approve_pairing`
  require the exact active session. The lookup atomically counts every admitted code attempt on the
  session under deployment-supplied bounded policy and probes one primary plus one optional rotation
  verifier without revealing which failed. Approval also requires a fresh, consumed,
  transaction-bound WebAuthn challenge and persists the exact verifying passkey plus approving
  session. The user can select a new opaque source or an existing active source owned by the same
  profile. The first valid approval wins; after that, another profile cannot take over or rebind the
  transaction.
- `read_pairing_verification_material`, `activate_pairing`, and `poll_pairing_status` expose only
  the minimum material needed for external Ed25519 proof verification and poll possession. An
  unexpired activated transaction retains the same read-only material so a lost success response can
  be retried only after another valid possession proof. Activation atomically binds the exact
  pending key to the approved source and one public device ID.
- `read_source_inventory` derives the profile from the exact possessed active or hidden session and
  returns only its opaque source lifecycle plus bounded device metadata. Internal key IDs, public
  keys, profile IDs, account email, and exact usage are absent from the result.
- `pause_source` and `revoke_device` are immediate protective actions. They accept no caller-chosen
  profile, close on cross-profile IDs and replay, and append one bounded audit reference. Both
  remain available while public visibility is hidden. Pausing invalidates unused source-bound
  challenges and cancels approved-but-not-activated pairings.
- `create_source_action_challenge`, `reactivate_source`, and `unlink_source` bind a short-lived
  source action to the exact active or hidden session, profile, purpose, source, and context.
  Reactivation is limited to paused sources and does not change profile visibility; normal user
  authority cannot lift quarantine. Unlink accepts any non-terminal source while the profile is
  active or hidden and is terminal: it revokes every active device, cancels approved pairings, and
  invalidates unused source actions in the same transaction without changing visibility.
- `read_device_verification_material` returns only the exact active device key ID, opaque bound
  source ID, and Ed25519 public key. Paused/unlinked sources, revoked devices, and deletion-pending
  profiles return no material; quarantined sources remain verifiable so their submissions can be
  retained as quarantined evidence.
- `consume_origin_nonce` accepts only one closed origin key ID, 32-byte domain-separated digest, and
  millisecond expiry within 65 seconds of the database clock. It atomically inserts or replaces only
  an expired exact tuple, returns `false` for an unexpired replay, and rechecks expiry after lock
  wait so delayed work cannot reopen acceptance.
- `submit_community_sync` revalidates the exact activated device/source binding, schema-level
  identifier/version/date/token/digest bounds, millisecond timestamp precision, and a server-time
  replay window. It records one nonce per device and one snapshot per device/sync ID, returns an
  exact retry as `duplicate`, quarantines a whole decrease, quarantined source, or payload touching
  a server-closed season, and advances one monotonic current value per source/date without summing
  devices. Server `receivedAt` is captured after the affected season locks so waiting cannot
  backdate acceptance. Paused/unlinked sources, revoked devices, and deletion-pending profiles fail
  closed.
- `cleanup_expired_ingest_state` accepts only a batch size from 1 through 1000, derives its cutoff
  from server time, and serializes Jobs callers. Each call independently deletes at most one batch
  of expired origin nonces, device nonces, and raw snapshots. Snapshot entries cascade; current
  source/day values remain and only their expired raw-snapshot reference is cleared.
- `cleanup_expired_pairing_state` accepts only a batch size from 1 through 1000, derives its cutoff
  after a separate private Jobs mutex, and deletes oldest expired `pending`, `approved`, or
  `cancelled` transactions only with their exact still-pending, unbound key. Pairing-bound approval
  challenges cascade; live pending rows, activated transactions/keys, sources, and audit provenance
  remain. Contended pairing/key rows are deferred to a later invocation.
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
- `list_public_community_race` is separately Web-only and preserves those score rows while adding at
  most one exact current active recipe JSON object. It exposes no proposal identity, state,
  timestamp, private ID, raw/daily usage, or arbitrary content. The stable score function is
  unchanged.
- `list_public_community_race_status` is a third Web-only read. It preserves the race rows, adds one
  saturated complete-UTC-day freshness value, and adds a consecutive positive-score streak only when
  the current active profile enables it. Exact accepted timestamps, daily scores, and the preference
  itself are not returned; both older functions remain unchanged.

The public schema safety ceilings are 8 to 16 codes per replacement recovery batch, one active
recovery authority per profile for at most ten minutes, 32 retained passkey records, 32 active
unexpired browser sessions, 32 lifetime source records, 64 active plus unexpired approved device
authorities per profile, and 100 rows per public score, race, or status read. They bound retained
credential growth, authority fan-out, and one response; they are not substitutes for lower
deployment-specific fair-use limits, edge rate limits, cache design, capacity evidence, or bounded
cleanup.

The application must call `complete_passkey_login` or `consume_passkey_challenge` only after it has
verified the exact WebAuthn RP ID, origin, challenge, transaction context, signature, and
user-verification result against the returned credential material. ADRs 0026 and 0027 now provide a
strict external Ed25519 pairing verifier and a closed local adapter that calls activation only after
that proof over the exact returned material. These SQL procedures still implement neither
cryptographic verification nor network rate limiting. ADR 0015's local Ingest kernel validates the
exact bounded `ConnectorSyncV1` body, body-bound origin proof, and canonical strict Ed25519 request
against an injected minimal lookup. ADRs 0016 and 0018 let the adapter atomically consume the origin
replay tuple, provide that lookup, and map only a reconstructed, contract-revalidated allowlist to
`submit_community_sync` through fixed parameterized SQL, a four-client deadline-bound pool, and an
exact Ingest login/role/search-path probe. The database still independently enforces binding,
replay, time, lifecycle, season, and monotonic state. The local HTTP service preserves the exact raw
envelope, uses ADR 0017's protected key reader plus ADR 0018's persistent replay capability,
composes verifier and adapter, and maps only a generic public acknowledgement. The opt-in synthetic
loopback gate exercises that complete path through a disposable least-privileged login. It is not
deployment TLS/credential, edge, capacity, or real-user evidence. The local returning-login options
route keeps its challenge only in an encrypted browser continuation and creates no database state
before valid proof, but it is not launch-ready without edge/service limits. Revision 0023 supplies
bounded cleanup after expiry, and ADR 0063 includes the exact command in a default-off local catalog
plus the combined synthetic PostgreSQL integration; deployed execution and retention evidence remain
required. Procedures use one generic failure message for closed authorization and constraint
failures; HTTP status mapping and response shaping remain application work. Recovery SQL now uses a
short-lived restricted authority and never represents it as an ordinary session. The local
application now performs bounded matching/dummy Argon2id work under the protected pepper, generic
configured-floor HTTP handling, and exact replacement WebAuthn verification before these fixed
calls. Distributed edge attempt controls, deployed cleanup cadence, notifications, live integration,
and operational monitoring remain absent. The deletion procedures now implement immediate lock-down,
local primary purge, and 30-day terminal-job retention; cache purge, tombstones, backup replay,
deployed scheduling, and user-visible progress remain unimplemented. Fixed-clock synthetic
scheduler/PostgreSQL composition is proven.

## Data and privacy map

All current columns map to the canonical [privacy data map](../docs/security/PRIVACY_DATA_MAP.md):

| Tables                                      | Classes                       | Stored boundary                                                                                     |
| ------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------- |
| `profiles`                                  | Account; handle is Public     | Numeric GitHub binding, handle, closed visibility/preferences, lifecycle time                       |
| `invites`, `sessions`, `auth_challenges`    | Security                      | Keyed verifiers, exact session/passkey provenance, pairing-attempt window, expiry, and one-time use |
| `passkeys`, `recovery_codes`                | Security; label is Account    | Public credential material, opaque selectors, and unused PHCs; no plaintext                         |
| `recovery_authorities`                      | Security                      | Keyed/challenge/context digests, terminal state, expiry, and opaque provenance                      |
| `codex_sources`                             | Account                       | Opaque source ID, owning profile, and constrained lifecycle state                                   |
| `device_keys`, `pairing_transactions`       | Security; metadata is Account | Ed25519 public key, exact source/device binding, keyed poll/code verifiers                          |
| `deletion_jobs`, `deletion_tombstones`      | Security; Operational         | Keyed identity references, bounded work state, lease digest, completion, and expiry                 |
| `audit_events`                              | Security; Operational         | Closed event/actor enums, request reference, reason code, and server time                           |
| `maintenance_locks`                         | Operational                   | Fixed owner-only cleanup/scoring mutex rows; no user or request data                                |
| `pairing_request_windows`                   | Security; Operational         | Fixed 130-row operation/global/bucket matrix; aggregate timestamp and saturated count only          |
| `origin_nonces`                             | Security                      | Origin key ID, domain-separated replay digest, and millisecond expiry                               |
| `device_nonces`                             | Security                      | Device-bound replay digest and 15-minute expiry marker                                              |
| `usage_snapshots`, `usage_snapshot_entries` | Usage; Security               | Bounded signed snapshot metadata, exact private daily values, 30-day expiry marker                  |
| `source_day_values`                         | Usage                         | One monotonic current token value and accepted provenance per source/date                           |
| `finalized_season_profile_freshness`        | Usage; Public-derived         | One UTC freshness date, source/value inventory, and bounded cleanup progress per profile/season     |
| `score_versions`, `seasons`                 | Operational; Public           | Immutable formula, ISO-week binding, grace, and terminal state                                      |
| `season_entries`, `season_daily_scores`     | Public                        | Private pre-projection scores, active days, source count, rank, and display order                   |
| `schema_migrations`                         | Operational                   | Revision name and server application time only                                                      |

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
deployed scheduler, monitoring, retention policy, or real-user purge evidence exists. ADR 0014's
local runner can invoke one fixed maximum-size batch only after its Jobs-role probe. The shared
opt-in integration now proves that emitted command through one disposable narrow login and exact
stored state. ADR 0063 separately supplies an exact-default-off in-memory UTC catalog against a fake
runner and clock, plus a second fixed-clock synthetic composition with the real runner and
disposable PostgreSQL. A third advances the fixed clock by one hour, invokes the production interval
handler twice during the active real-runner cycle, proves the exact recurring catalog plus overlap
and same-slot suppression, and verifies the rearmed terminal reset. A fourth composes the production
process lifecycle under fixed time, injects its first handler during the penultimate real database
job, and proves graceful settlement plus no later scheduler job. A fifth starts the built entry
point under real host time, reaches the terminal startup-catalog marker without process output, then
forcibly ends only its persistent test child. These do not supply host-timer delivery, OS-signal
delivery, emitted-child controller settlement before forced termination, a wall-clock recurring
process callback, production login/TLS, deployed cadence, monitoring, capacity, or real-user purge
evidence.

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
correction record, deployed Jobs scheduler/monitor, production login/TLS integration, or capacity
claim is implemented. The local one-shot runner selects only the prepared refresh/finalization call
after a closed canonical-season command and a least-privilege session probe; the shared synthetic
integration now proves both emitted calls and their exact open/finalized state.

Revision 0011 exposes only a bounded score projection to the Web role. It filters current profile
state to `active`, then recomputes shared rank and contiguous display position so hide/purge leaves
no public gap. Its exact ten fields omit private IDs, raw/daily values, and exact timestamps;
Ingest, Jobs, Admin, and `PUBLIC` are denied. Ranking still evaluates the visible season before the
100-row result cap, so the five-second database deadline is defense in depth rather than capacity
evidence. A separate server-only Web mapper now narrows an unknown adapter result to the canonical
top-32 response and fails closed on projection drift. ADR 0011 adds a bounded `pg` adapter that
verifies its Web-only deployment login/session before each fixed parameterized call, casts calendar
dates to text, and applies that mapper. ADR 0013 supplies the local score HTTP route; the stable
score response remains car-free. No cache/invalidation, profile detail, rate limit, deployment
login/TLS integration, or live adapter connection is implemented.

Revision 0012 stores only the already mapped Security replay tuple: a closed origin key ID, the
verifier's domain-separated 32-byte nonce digest, and millisecond expiry. It stores no raw nonce,
proof, HMAC key, body, header, device, source, profile, IP address, or free-form metadata. An
Ingest-only function atomically consumes one tuple under five-second lock/statement bounds and
rechecks expiry after contention. The existing Jobs cleanup now independently caps deletion of
origin nonces, device nonces, and snapshots under its private mutex. Expiry ends replay acceptance;
physical deletion still needs a production schedule, monitor, backup policy, and purge evidence.

Revision 0013 physically removes only expired non-activated pairing authority and the exact
source-free pending key it owns. It extends the expiry index to cancelled state, captures server
time after its separate owner-only mutex, caps one invocation at 1000 pairs, skips rows involved in
another security transition, and rolls back if the pair/key deletion is not exact. Activated binding
provenance and explicit source lifecycle remain outside cleanup. The observed two-worker race proves
serialization and live-row preservation only in the isolated database; no production schedule, Node
login, backup policy, or broader ceremony cleanup exists.

Revision 0014 adds no table or pre-proof authority. After Web/Auth verifies the exact active
credential against the encrypted challenge continuation, one fixed function creates and consumes
that five-minute profile-free challenge in the same transaction as the existing credential-derived
session. It returns only profile ID, public handle, and locale so Web/Auth can seal its existing
session shape. Ingest, Jobs, Admin, and `PUBLIC` are denied; the complete isolated suite now proves
64 cross-capability denials. Physical challenge cleanup after expiry is supplied by revision 0023; a
deployment login, edge attempt policy, monitoring, and live authenticator/database integration
remain open.

Revision 0015 adds no table, preference field, or broader role. It maps the existing active/hidden
profile lifecycle to one closed account value, derives the target solely from an exact active
session, and permits only the reversible visibility transition. Hiding leaves source/device ingest
authority unchanged while the existing public score projection excludes the profile. Repeating the
current state writes nothing. Only Web can execute either function.

Revision 0016 adds no table, field, role, or new action. It corrects the existing private
`read_source_inventory` and immediate `revoke_device` capabilities so a possessed session retains
them in both `active` and `hidden` profile states. The PostgreSQL suite proves hidden inventory and
one exact owned-device revoke while leaving public visibility hidden; cross-profile and replay
denials remain unchanged.

Revision 0017 adds no table, field, role, or new action. It permits the existing `pause_source`,
`source_reactivation` challenge/consume, and `reactivate_source` capabilities for the same possessed
session while its profile is hidden. The source must still be active to pause and `paused` to
reactivate; reactivation leaves the profile hidden, cannot lift quarantine, and consumes the exact
fresh source/session/context-bound proof in the same transaction as the state change. Unlink remains
active-profile-only in that revision.

Revision 0018 adds no table, field, role, or new action. It permits the existing `source_unlink`
challenge/consume and `unlink_source` capability for the same possessed session while its profile is
hidden. The distinct fresh passkey context, active/paused/quarantined input states, terminal result,
recursive active-device revoke, approved-pairing cancellation, stale-action invalidation, and public
visibility all retain their prior semantics.

Revision 0019 adds no table, column, retained value, or runtime role. Its Web-only
`read_profile_score` derives the profile from the exact possessed session, admits only a bounded
Monday, and projects existing derived season rows. PostgreSQL evidence covers exact possession,
canonical-week rejection, seven-row shape, hidden empty state, and republish restoration. Ingest,
Jobs, Admin, and `PUBLIC` remain denied by the runtime capability matrix.

Revision 0023 physically removes expired authentication challenges and independently bounded expired
restricted recovery authorities. It deletes an authority's exact source code only when the row still
exists in terminal used/scrubbed form; unused recovery codes remain credentials. Cleanup captures
server time after its private Jobs mutex and locks candidate profiles in stable order before
authority/code rows, matching recovery and deletion transitions. Observed worker and recovery-start
races prove serialization, live-authority preservation, and the profile-first lock order in isolated
PostgreSQL. The shared synthetic integration proves the emitted command through a disposable narrow
login. The exact object is in ADR 0063's default-off local catalog and combined synthetic PostgreSQL
integration, but no production Jobs login/TLS, backup purge, monitoring, deployed retention cadence,
or deployment is implied.

Revision 0024 physically removes at most ten due `deletion_pending` profiles per invocation. It
locks every current maintenance mutex in stable name order before queue/profile rows, including the
six rows present after revision 0026, so cascaded auth, pairing, proposal, usage, and score deletion
cannot deadlock a concurrent Jobs capability. It removes every profile-bound restrictive pairing
first and deletes only a still-pending source-free key directly; source-bound keys leave through the
profile cascade. The exact job becomes terminal inside the same transaction before its profile
foreign key is nulled, while audit linkage is redacted. The opaque job remains. The purge object is
in the default-off local catalog and combined synthetic scheduler/PostgreSQL integration, but no
keyed identity tombstone, cache/backup purge, restore replay, production Jobs login/TLS, monitoring,
capacity, or deployment is implied. The CLI integration separately proves one emitted local purge
and its exact terminal job/profile state.

Revision 0025 stores only the exact `CarRecipeV1` columns, with database checks repeating every
version, enum, and seed bound. Both tables are forced-RLS and have no runtime table grants. Web may
propose, read, approve, or reject only after the function derives an `active` or `hidden` profile
from the exact session ID and 32-byte verifier digest; no function accepts a profile ID. Proposal
IDs and expiries are server-created, one pending row replaces the previous pending row, approval
atomically inserts or replaces the active recipe and deletes the exact proposal, while rejection
deletes only the exact proposal. Ingest, Jobs, Admin, `PUBLIC`, direct table reads, cross-profile
controls, and replay are denied. Profile deletion cascades both recipe rows. Expiry prevents use
after at most 24 hours. Revision 0026 supplies bounded physical deletion and the default-off local
catalog plus the combined synthetic scheduler/PostgreSQL integration include that object, while
deployed cadence, production credentials, monitoring, capacity evidence, and deployment remain open.
Revision 0027 separately supplies only the bounded current public projection.

Revision 0028 adds no table or direct grant. Web may read only a device key ID/public key for an
active device on an active source whose profile is active or hidden. Its proposal function locks and
rechecks profile, source, and device, consumes a 32-byte domain-separated nonce digest for seven
minutes, and creates or replaces the same single pending exact recipe with server-owned ID/time and
24-hour expiry. It never changes the active recipe. Paused, quarantined, unlinked, revoked,
mismatched, stale, future-skewed, replayed, Ingest, Jobs, Admin, and `PUBLIC` calls are denied. This
includes an observed source-pause-versus-proposal lock race. Isolated PostgreSQL evidence proves no
live Web login, wire signature, edge admission, schedule, monitoring, capacity, or deployment.

Revision 0026 physically removes at most 1000 expired CarRecipe proposals per invocation. It
captures server time only after its separate private Jobs mutex, selects oldest expiry/ID first,
uses `FOR UPDATE SKIP LOCKED` around concurrent Web decisions, rechecks expiry at deletion, and
returns only one bounded count. Active recipes and live proposals are never candidates. Web, Ingest,
Admin, `PUBLIC`, and direct table access remain denied. The observed two-worker race proves
serialization, exact expired-row progress, and live-row preservation only in isolated PostgreSQL.
The object is in the default-off local catalog and combined synthetic scheduler/PostgreSQL
integration, but no deployed cadence, production Jobs login/TLS, monitoring, backup purge, capacity,
or deployment is implied. The CLI integration separately proves the emitted command through a
disposable narrow login and exact stored state.

Revision 0027 adds no table, retained field, or write authority. Its Web-only function calls the
unchanged public score projection, resolves only the current `active` profile behind each visible
handle, and left-joins its one approved recipe. It constructs one exact nine-field JSON object from
database-constrained columns or returns SQL `NULL` for absence. Proposal rows, IDs, state,
timestamps, raw/daily usage, and arbitrary content remain private. The function has the same
five-second statement deadline and 100-row ceiling; Ingest, Jobs, Admin, and `PUBLIC` are denied.
The projected recipe is current presentation state rather than a historical season snapshot. This
local evidence proves no live Web login, cache, edge policy, load result, monitoring, or deployment.

Revision 0029 adds no retained personal field or write authority. Its Web-only function calls the
unchanged race projection and uses already retained accepted server receipt times plus materialized
daily scores to derive two bounded integers at read time. `freshness_days` is the saturated number
of complete UTC calendar days since the latest accepted receipt within the requested season.
`streak_days` counts consecutive positive daily scores through the closed season Sunday or the
current-day/yesterday grace anchor, can continue across prior materialized seasons, and is SQL
`NULL` when the active profile disables public streak visibility. The exact timestamps, daily rows,
preference, and profile identifier are not returned. A partial positive-score index bounds the
streak lookup; the function retains the five-second statement deadline and 100-row ceiling. Ingest,
Jobs, Admin, and `PUBLIC` are denied. This local evidence proves no query-plan/load result, live Web
login, cache, edge policy, monitoring, or deployment.

Revision 0030 physically removes expired active, revoked, or rotated session rows only after no
retained session names them as its replacement and no pairing transaction retains them as immutable
approval provenance. It uses the existing authentication mutex, a full expiry index, a supporting
pairing-reference index, oldest-first row locks with `SKIP LOCKED`, and repeated delete predicates.
Deleting a session cascades only its now-unusable session-bound challenges. Activated-pairing
provenance and live sessions remain until revision 0034 can redact the exact approval references
after 180 days while preserving the pairing/device binding; the observed worker race proves local
serialization. The object is in the default-off local catalog. The shared synthetic integration
additionally proves the emitted cleanup command through a disposable narrow login and exact stored
state. The combined synthetic scheduler/PostgreSQL integration proves provenance redaction precedes
this cleanup so newly unreferenced state can be deleted in the same cycle. Neither proves deployed
cadence, complete device-history policy, backup purge, production login/TLS, monitoring, capacity,
deployment, or real-user retention.

Revision 0031 physically removes expired active or revoked invite rows only after the shared
authentication mutex. It uses the ordered partial expiry index, server time captured after the
mutex, `FOR UPDATE SKIP LOCKED`, and repeated state/expiry predicates. Redeemed enrollment
provenance and live invite authority are never candidates. The observed worker race proves local
serialization and exact progress; the shared synthetic integration proves only the emitted command
through a disposable narrow login and exact stored state. The object is in the default-off local
catalog, and the combined synthetic scheduler/PostgreSQL integration exercises it. These layers do
not prove invite issuance UI, deployed cadence, production login/TLS, monitoring, capacity, backup
purge, or deployed retention.

Revision 0032 physically removes only terminal profile-deletion jobs whose profile link is null and
whose server-recorded completion is at least 30 days old. It shares the profile-deletion mutex,
orders the partial-index path by completion and identifier, uses `FOR UPDATE SKIP LOCKED`, and
repeats every terminal/cutoff predicate. Recent evidence and non-terminal authority remain. The
observed worker race and shared synthetic integration prove only local serialization,
least-privileged execution, and exact stored state. The object is in the default-off local catalog;
the combined synthetic scheduler/PostgreSQL integration exercises it, but these layers do not prove
deployed cadence, cache/backup purge, tombstone/restore replay, monitoring, capacity, or deployment.

Revision 0033 physically removes both profile-linked and already-redacted database audit events only
after 180 days from server-recorded occurrence. It uses a separate private mutex, a deterministic
time/identifier index, `FOR UPDATE SKIP LOCKED`, and a repeated cutoff predicate. Recent evidence
remains. The observed worker race and shared seventeen-command synthetic integration prove only
local serialization, least-privileged execution, and exact stored state. The object is in the
default-off local catalog; the combined synthetic scheduler/PostgreSQL integration exercises it.
These layers do not prove an external append-only sink, deployed cadence, production login/TLS,
monitoring, capacity, backup purge, or deployed retention.

Revision 0034 redacts only `approved_by_session_id` and `approved_by_passkey_id` from activated
pairings at least 180 days after server-recorded activation. It locks the existing authentication
and pairing mutexes in profile-purge order, uses an ordered partial index and
`FOR UPDATE SKIP LOCKED`, repeats every state/cutoff/reference predicate, and permits one exact
trigger transition only when every other approval and activation binding remains immutable. Partial
or pre-activation redaction fails closed. The pairing, source, active device, passkey, and
activation evidence remain; a separate session-cleanup call can then remove a newly unreferenced
expired session. The observed worker race and shared seventeen-command synthetic integration prove
local serialization, least-privileged execution, and exact stored state. This redaction does not
itself delete device history; revision 0036 separately handles only an aged minimized pair. The
object is in the default-off local catalog. The combined synthetic scheduler/PostgreSQL integration
proves it precedes dependent session, passkey, and device cleanup. These layers do not prove
deployed cadence, production login/TLS, monitoring, capacity, backup purge, or deployed retention.

Revision 0035 physically removes a passkey row only after it has remained revoked for at least 180
days and no retained session, verifying challenge, authorized challenge, or pairing references it.
It locks the existing authentication and pairing mutexes in profile-purge order, uses an ordered
partial index plus `FOR UPDATE SKIP LOCKED`, and repeats every state/cutoff/reference predicate at
delete. Active, recent, and referenced credentials remain. A recovery scenario first fails
atomically at the unchanged 32-row ceiling, deletes 31 eligible historical rows, then completes with
the existing replacement-passkey proof. The observed worker race and shared seventeen-command
integration prove only local serialization, least-privileged execution, and exact state. The object
is in the default-off local catalog, and the combined synthetic scheduler/PostgreSQL integration
exercises it after provenance/session cleanup. These layers do not prove deployed cadence,
production login/TLS, monitoring, capacity, backup purge, or deployed retention.

Revision 0036 physically removes only an activated pairing and its exact revoked device-key row when
both activation and revocation are at least 180 days old, the approving session/passkey references
are already null, and no authorization challenge, device nonce, or raw usage snapshot remains. It
locks the existing Ingest and pairing mutexes in profile-purge order, locks both candidate rows with
`FOR UPDATE SKIP LOCKED`, deletes the pairing before the key, repeats every predicate, and requires
exactly one row at each step so failure rolls back the pair. Active, recent, and referenced history
remains, and configured challenge/raw cascades never define eligibility. The observed worker race
and shared seventeen-command integration prove only local serialization, least-privileged execution,
and exact state. The object is in the default-off local catalog. The combined synthetic
scheduler/PostgreSQL integration exercises it after provenance, session, and passkey cleanup. These
layers do not prove deployed cadence, production login/TLS, monitoring, capacity, backup purge, or
deployed retention.

Revision 0037 resets only positive `pairing_request_windows` rows whose server-recorded window start
is at least one hour old, which is the maximum duration accepted by Web admission. It first verifies
the complete constrained 130-row matrix, locks candidates in operation/global/bucket order, repeats
the cutoff/count predicates, and replaces only the aggregate timestamp/count with the exact
epoch/zero state. The table rows, operations, buckets, Web-only admission function, saturating
limits, and absence of client ID/digest storage remain unchanged. A failed later-row update rolls
back the whole reset. Observed worker/worker and reset/admission races prove convergence and a fresh
admission count surviving reset. The object is in the default-off local catalog. The separate
seventeen-command integration proves the no-argument Jobs path and exact stored state, not trusted
edge identity. The combined synthetic scheduler/PostgreSQL integration also exercises the reset;
neither proves deployed cadence, monitoring, capacity, production login/TLS, or deployment.

Revision 0038 physically removes at most 1000 canonical abandoned enrollment profiles per
invocation. It locks the existing authentication and profile-purge mutexes in stable order, captures
one server time, uses a partial creation-time/identifier index plus `FOR UPDATE SKIP LOCKED`, and
repeats exact state, redeemed-invite, expired enrollment-session/registration-challenge, and
no-other-profile-state predicates at deletion. The existing profile cascade removes only the
redeemed invite and expired enrollment authority; audit rows remain with null profile linkage. Live
or equal-boundary authority, active profiles, and every non-enrollment, recovery, passkey/source,
deletion, scoring, recipe, or missing-invite drift remain. Worker serialization and an in-flight
initial-passkey activation race pass in isolated PostgreSQL. The shared seventeen-command
integration proves only the emitted command through a disposable narrow login and exact stored
state. The object is in the default-off local catalog, and the combined synthetic
scheduler/PostgreSQL integration exercises this cleanup. None of these layers proves invite
repair/reuse, a deletion job/tombstone, notification, deployed cadence, production login/TLS,
monitoring, capacity, backup purge, restore replay, or deployed retention. Revision 0039 repeats its
eligibility boundary with a finalized-freshness exclusion so the new direct profile foreign key
cannot widen this cascade.

Revision 0039 captures one private profile/season projection when an open season becomes finalized:
the latest accepted receipt's UTC date, retained source count, exact source/day row count, and zero
cleanup progress. It backfills the same bounded projection for existing finalized state. The
compatible public status read prefers that rounded date and otherwise falls back to live rows, so
its contract and visible freshness remain unchanged. Only Jobs may delete oldest exact source/day
rows, at most 1000 per invocation, after finalization has remained terminal for 30 days. Before each
row it proves that live rows plus progress equal the captured count, the live maximum UTC day still
matches the projection, and first-row source count is exact. It locks the existing scoring, Ingest-
retention, and profile-purge mutexes in stable order; worker, finalization, and profile-purge races
prove local serialization. Open, recent, missing-projection, or drifted state remains untouched or
fails closed. The exact command is in ADR 0063's default-off local hourly catalog. The combined
synthetic scheduler/PostgreSQL integration exercises it, but there is no production login/TLS path,
correction authority, backup purge, capacity result, or deployed retention evidence.

The local account application consumes those capabilities through the same probed read-write pool.
Its combined overview query reads visibility and the current week's derived score with one checkout,
then accepts only one all-null empty row or exactly seven consecutive, internally consistent daily
rows. Hidden profiles never map a score, and raw usage, source IDs, profile IDs, and timestamps do
not enter the page. Its fixed query projects active credentials plus one exact all-null device
sentinel for each source without one, caps the result at 96 so the mapper can reject more than the
maximum 95 rows implied by 32 sources and 64 active devices, rounds activation to a UTC date, and
maps at most 32 opaque sources. The page renders source ordinal/state plus bounded device
label/platform/version, not the source ID, internal key/profile ID, public key, or exact time. Only
the selected opaque device ID enters its same-origin revoke form. Source actions instead receive an
exact-shape encrypted session-bound control token for at most 15 minutes. Pause is a bounded
same-origin form; reactivation requires one fresh application-verified passkey assertion before an
atomic consume-and-reactivate call. A distinct fresh context reaches one atomic consume-and-unlink
call, which terminally unlinks any active, paused, or quarantined source and revokes all of its
active devices. All three controls preserve hidden visibility.

The local account application also consumes the existing `read_passkey_inventory` capability. Its
fixed query and closed mapper retain at most 32 rows, require exactly one current active
authenticator, round creation time to a UTC date, and pass only label, active/revoked state, and
that current marker plus an opaque revoke target into the authenticated page. The target ID is sent
only when revoking an owned non-current active key. The application creates an exact
session/target/context-bound challenge and, after fresh WebAuthn verification, uses one atomic query
that consumes the challenge before calling `revoke_passkey`. Credential IDs, public keys, sign
counters, exact activity timestamps, and profile IDs remain outside the page and request.

The same application now composes the existing add capability without a migration. It validates and
seals one label, issues independent existing-key assertion and new-key registration challenges, and
binds both to the exact session/profile/RP/origin context. After both application verifiers succeed,
one materialized statement consumes the step-up and calls `add_passkey`; a failed consume never
calls add, while any insert/audit failure rolls back the consume. The database rechecks the lifetime
cap under its existing profile serialization.

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
pnpm run test:web:postgres-integration
pnpm run test:ingest:postgres-integration
```

The first two commands are offline and part of `pnpm run verify`. All three integration commands
require Docker and never connect to the normal `postgres` volume. The database suite starts only the
portless `postgres-test` service in a uniquely named Compose project with ephemeral `tmpfs` storage.
The Web and Ingest suites each start a separate one-off `postgres-test` container with only an
ephemeral loopback-published port. The Web suite additionally mounts one generated read-only
test-only certificate/key directory, copies the material under closed container permissions before
the original PostgreSQL entrypoint, and requires verified TLS from two emitted standalone Next
processes. Both suites remove their process/container/network/storage resources in `finally`; Web
also removes the ephemeral host key directory.

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

- Integrate the local OAuth/cookie/CSRF and WebAuthn registration/login flows with deployment-owned
  credentials and live browser/database evidence without weakening the session/passkey contract.
- Integrate the local recovery boundary with deployment-owned pepper/timing configuration and live
  authenticator/database evidence; add distributed edge attempt policy, notifications, inventory
  review evidence, and provenance-preserving cleanup at the 32-passkey lifetime edge.
- Add edge/service rate limiting for anonymous login, recovery, and pairing starts; do not encode
  deployable private thresholds in this repository. Schedule and monitor the implemented bounded
  expired authentication, invite, session, abandoned-enrollment, and CarRecipe-proposal cleanup
  before exposure.
- Deploy the local exact-byte Ingest HTTP/host boundary with live secret-manager/edge key injection,
  a deployment-provisioned least-privileged login and verified TLS, direct-origin denial,
  distributed backpressure/rate controls, monitoring, and load evidence. The synthetic loopback
  integration does not replace those gates.
- Deploy the default-off local scheduler with a production Jobs login/TLS path,
  single-replica/cadence policy, monitoring, missed-backlog recovery, and capacity evidence, plus
  audited corrections. The fixed-clock, injected-timer, injected-lifecycle, and emitted
  terminal-marker evidence do not provide host-timer delivery, OS-signal delivery, emitted-child
  controller settlement before forced termination, a wall-clock recurring process callback,
  production configuration, or deployed evidence.
- Integrate the bounded database adapter and local score/race/status routes with a
  deployment-provisioned Web-only login and verified TLS, then add cache/invalidation, edge request
  shaping, query-plan/load evidence, monitoring, and deployment verification.
- Extend the separate profile surface only after authenticated profile detail has real persistence,
  privacy, compatibility, and lifecycle evidence; do not widen either closed legacy race response.
- Schedule and monitor the implemented retention-cleanup procedures for expired authentication,
  invitation, abandoned-enrollment, CarRecipe-proposal, finalized source/day, ingest, pairing,
  session, terminal-deletion-job, and database audit-event state, aged revoked passkeys and
  minimized revoked devices, plus aged pairing approval-provenance redaction and fixed
  pairing-rate-window reset; implement a reviewed keyed tombstone policy separately. Retention
  markers outside revisions 0008, 0012, 0013, 0023, 0026, 0030, 0031, 0032, 0033, 0034, 0035, 0036,
  0037, 0038, and 0039 are not cleanup, redaction, or reset evidence.
- Replace every launch-decision retention item with public policy and purge evidence.
- Exercise migration overlap, backup restore, deletion replay, role rotation, and service rollback
  in isolated staging before real-user ingestion.
