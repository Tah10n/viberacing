# Database identity foundation and capabilities

## Status

This directory contains five SQL-first revisions for identity, passkey login and management, source,
device, pairing, audit, and deletion state. The migrations, narrow database procedures, and
PostgreSQL integration tests are implemented. No application route, OAuth callback, WebAuthn
verifier, production credential, or deployed database consumes them yet. Recovery, ingest, scoring,
purge, and cleanup procedures are not implemented.

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
- `tests/pairing_concurrency_setup.sql` and `tests/pairing_concurrency_assertions.sql` create only
  ephemeral synthetic state and prove cross-connection first-winner, source-ceiling, and live
  device-authority-ceiling serialization.
- `tests/lifecycle_concurrency_setup.sql` and `tests/lifecycle_concurrency_assertions.sql` prove
  pause dominates concurrent approval and unlink dominates concurrent activation without leaving
  approved pairing or active device authority live.
- `tests/passkey_concurrency_setup.sql` and `tests/passkey_concurrency_assertions.sql` prove one
  login challenge has one winner and passkey revoke dominates concurrent login without leaving its
  browser or pending device authority live.
- `scripts/check-database.mjs` and its black-box tests enforce migration shape, checksums, paths,
  transactions, bounded execution, owner context, forbidden grants or SQL capabilities, and reject
  scalar-subquery `IF NOT` assertions whose missing row would otherwise pass as SQL `NULL`.
- `scripts/test-database-integration.mjs` owns an isolated Compose project, executes PostgreSQL
  assertions and lock-contention races, waits until every tagged contender is observed in the
  holder's transitive blocker chain, proves runtime denials, and removes the container, network, and
  ephemeral storage.

## Capability model

| Role                | Login | Private schema | API schema | Current executable capability                                      |
| ------------------- | ----- | -------------- | ---------- | ------------------------------------------------------------------ |
| `viberacing_owner`  | No    | Owns objects   | Owns       | Migration and procedure implementation                             |
| `viberacing_web`    | No    | None           | Usage      | Identity, passkey, pairing, inventory, and source/device lifecycle |
| `viberacing_ingest` | No    | None           | Usage      | None                                                               |
| `viberacing_jobs`   | No    | None           | Usage      | None                                                               |
| `viberacing_admin`  | No    | None           | Usage      | Bounded invite issuance only                                       |
| `PUBLIC`            | N/A   | None           | None       | None                                                               |

Deployment login principals are environment-owned secrets and are not declared here. Each service
will receive one group role through protected infrastructure. Runtime roles are not members of the
owner or one another; they cannot create schema objects, use temporary database storage, read a
private table, or rely on `public` in `search_path`. The database default and group-role defaults
both use only `pg_catalog, pg_temp`; service startup must still verify the effective role and
setting after connecting.

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

The public schema safety ceilings are 32 lifetime passkey records, 32 active unexpired browser
sessions, 32 lifetime source records, and 64 active plus unexpired approved device authorities per
profile. They bound retained credential growth and authority fan-out and are not substitutes for
lower deployment-specific fair-use limits, edge rate limits, or bounded cleanup.

The application must call `complete_passkey_login` or `consume_passkey_challenge` only after it has
verified the exact WebAuthn RP ID, origin, challenge, transaction context, signature, and
user-verification result against the returned credential material. It must verify the connector's
Ed25519 possession proof over the exact returned pairing material before activation. These SQL
procedures implement neither cryptographic verification nor network rate limiting. In particular,
the anonymous login-challenge endpoint is not launch-ready without edge/service limits and bounded
expiry cleanup. Procedures use one generic failure message for closed authorization and constraint
failures; HTTP status mapping and response shaping remain application work. Recovery needs its own
short-lived restricted authority and is intentionally not represented as an ordinary session. The
deletion procedure implements immediate lock-down only; primary purge, cache purge, tombstones,
backup replay, and user-visible progress remain unimplemented.

## Data and privacy map

All current columns map to the canonical [privacy data map](../docs/security/PRIVACY_DATA_MAP.md):

| Tables                                   | Classes                       | Stored boundary                                                                 |
| ---------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------- |
| `profiles`                               | Account; handle is Public     | Numeric GitHub binding, normalized handle, explicit preferences, lifecycle time |
| `invites`, `sessions`, `auth_challenges` | Security                      | Keyed verifiers, exact session/passkey provenance, expiry, and one-time use     |
| `passkeys`, `recovery_codes`             | Security; label is Account    | Public credential material and Argon2id PHC verifiers; never plaintext secrets  |
| `codex_sources`                          | Account                       | Opaque source ID, owning profile, and constrained lifecycle state               |
| `device_keys`, `pairing_transactions`    | Security; metadata is Account | Ed25519 public key, exact source/device binding, keyed poll/code verifiers      |
| `deletion_jobs`, `deletion_tombstones`   | Security; Operational         | Keyed identity references, bounded work state, lease digest, and expiry         |
| `audit_events`                           | Security; Operational         | Closed event/actor enums, request reference, reason code, and server time       |
| `schema_migrations`                      | Operational                   | Revision name and server application time only                                  |

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
- Add a separate short-lived recovery-only authority plus procedure-only ingest, scoring, purge, and
  cleanup capabilities. Recovery must not mint a normal session before a new passkey is safely
  established.
- Add edge/service rate limiting and bounded cleanup for unauthenticated pairing starts and
  passkey-login challenges plus authenticated short-code lookups; do not encode deployable private
  thresholds in this repository.
- Add adversarial concurrent-connection coverage for session rotation, challenge consumption,
  enrollment, deletion, and future ingest procedures. Pairing approval, both public pairing
  ceilings, pause-versus-approval, unlink-versus-activation, single-challenge login, and
  revoke-versus-login already have observed blocker-chain cross-connection coverage.
- Implement bounded cleanup for expired ceremonies, sessions, pairings, jobs, and tombstones.
- Replace every launch-decision retention item with public policy and purge evidence.
- Exercise migration overlap, backup restore, deletion replay, role rotation, and service rollback
  in isolated staging before real-user ingestion.
