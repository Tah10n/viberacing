# Database identity foundation and capabilities

## Status

This directory contains two SQL-first revisions for identity, source, device, pairing, audit, and
deletion state. The migrations, narrow identity procedures, and PostgreSQL integration tests are
implemented. No application route, OAuth callback, WebAuthn verifier, production credential, or
deployed database consumes them yet. Recovery, pairing, ingest, scoring, purge, and cleanup
procedures are not implemented.

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
- `tests/identity_invariants.sql` uses deterministic synthetic rows inside a rolled-back transaction
  to exercise valid state and expected integrity failures.
- `tests/identity_capabilities.sql` exercises the exact grant matrix, session possession,
  cross-profile denial, expiry, replay, rollback, audit redaction, and synchronous deletion effects.
- `scripts/check-database.mjs` and its black-box tests enforce migration shape, checksums, paths,
  transactions, bounded execution, owner context, and forbidden grants or SQL capabilities.
- `scripts/test-database-integration.mjs` owns an isolated Compose project, executes PostgreSQL
  assertions, proves runtime denials, and removes the container, network, and ephemeral storage.

## Capability model

| Role                | Login | Private schema | API schema | Current executable capability                                                   |
| ------------------- | ----- | -------------- | ---------- | ------------------------------------------------------------------------------- |
| `viberacing_owner`  | No    | Owns objects   | Owns       | Migration and procedure implementation                                          |
| `viberacing_web`    | No    | None           | Usage      | Enrollment, session-bound challenge/passkey/deletion, and session rotate/revoke |
| `viberacing_ingest` | No    | None           | Usage      | None                                                                            |
| `viberacing_jobs`   | No    | None           | Usage      | None                                                                            |
| `viberacing_admin`  | No    | None           | Usage      | Bounded invite issuance only                                                    |
| `PUBLIC`            | N/A   | None           | None       | None                                                                            |

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
- `create_auth_challenge` and `consume_auth_challenge` currently accept only initial-passkey and
  profile-deletion purposes. Each challenge is bound by a composite foreign key to the exact active
  session and profile, expires within 15 minutes, and can be consumed once.
- `register_initial_passkey` requires the same possessed enrolling session and its consumed, unused
  registration challenge before activating the profile.
- `rotate_session` and `revoke_session` require the exact keyed verifier. Rotation serializes on the
  current session/profile and creates a fresh bounded record before ending the old one.
- `request_profile_deletion` derives the target from the possessed session, requires the exact typed
  handle and a consumed, unused deletion challenge, then atomically hides the profile, revokes
  active browser/passkey/device authority, removes recovery/challenge state, unlinks sources,
  cancels approved pairings, and queues one opaque deletion job.

The application must call challenge consumption only after it has verified the exact WebAuthn RP ID,
origin, transaction context, signature, and user-verification result. These SQL procedures do not
implement a WebAuthn verifier. They use one generic failure message for closed authorization and
constraint failures; HTTP status mapping and response shaping remain application work. The deletion
procedure implements immediate lock-down only. Primary purge, cache purge, tombstones, backup
replay, and user-visible progress remain unimplemented.

## Data and privacy map

All current columns map to the canonical [privacy data map](../docs/security/PRIVACY_DATA_MAP.md):

| Tables                                   | Classes                       | Stored boundary                                                                  |
| ---------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------- |
| `profiles`                               | Account; handle is Public     | Numeric GitHub binding, normalized handle, explicit preferences, lifecycle time  |
| `invites`, `sessions`, `auth_challenges` | Security                      | Keyed 32-byte verifiers/digests, exact session binding, expiry, and one-time use |
| `passkeys`, `recovery_codes`             | Security; label is Account    | Public credential material and Argon2id PHC verifiers; never plaintext secrets   |
| `codex_sources`                          | Account                       | Opaque source ID, owning profile, and constrained lifecycle state                |
| `device_keys`, `pairing_transactions`    | Security; metadata is Account | Ed25519 public key, exact source/device binding, keyed poll/code verifiers       |
| `deletion_jobs`, `deletion_tombstones`   | Security; Operational         | Keyed identity references, bounded work state, lease digest, and expiry          |
| `audit_events`                           | Security; Operational         | Closed event/actor enums, request reference, reason code, and server time        |
| `schema_migrations`                      | Operational                   | Revision name and server application time only                                   |

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

- Implement OAuth/cookie/CSRF and WebAuthn application flows without weakening the session-bound
  database contract.
- Add procedure-only recovery, passkey-change, login, pairing/source-management, ingest, scoring,
  purge, and cleanup capabilities.
- Add adversarial concurrent-connection coverage for session rotation, challenge consumption,
  enrollment, deletion, and future pairing/ingest procedures.
- Implement bounded cleanup for expired ceremonies, sessions, pairings, jobs, and tombstones.
- Replace every launch-decision retention item with public policy and purge evidence.
- Exercise migration overlap, backup restore, deletion replay, role rotation, and service rollback
  in isolated staging before real-user ingestion.
