# Database foundation

## Status

This directory contains the first SQL-first persistence revision for identity, source, device,
pairing, and deletion state. The migration and its PostgreSQL integration tests are implemented. No
application route, OAuth callback, passkey ceremony, runtime database procedure, production
credential, or deployed database consumes this schema yet.

The empty `viberacing_api` schema is deliberate. Runtime roles can resolve that schema but receive
no table access and no executable capability until a later migration adds a narrow, tested procedure
for one application use case.

## Layout

- `roles/bootstrap.sql` creates idempotent `NOLOGIN` group roles, locks default database/schema
  access, and grants the protected deployment principal permission to `SET ROLE` to the owner.
- `migrations/manifest.json` is the ordered migration ledger and SHA-256 integrity source.
- `migrations/0001_identity_foundation.sql` creates the private schema, constraints, indexes,
  state-machine triggers, forced row-level security, and the empty API boundary.
- `tests/identity_invariants.sql` uses deterministic synthetic rows inside a rolled-back transaction
  to exercise valid state and expected integrity failures.
- `scripts/check-database.mjs` and its black-box tests enforce migration shape, checksums, paths,
  transactions, bounded execution, owner context, and forbidden grants or SQL capabilities.
- `scripts/test-database-integration.mjs` owns an isolated Compose project, executes PostgreSQL
  assertions, proves runtime denials, and removes the container, network, and ephemeral storage.

## Capability model

| Role                | Login | Private schema | API schema | Current executable capability                 |
| ------------------- | ----- | -------------- | ---------- | --------------------------------------------- |
| `viberacing_owner`  | No    | Owns objects   | Owns       | Migration and future procedure implementation |
| `viberacing_web`    | No    | None           | Usage      | None                                          |
| `viberacing_ingest` | No    | None           | Usage      | None                                          |
| `viberacing_jobs`   | No    | None           | Usage      | None                                          |
| `viberacing_admin`  | No    | None           | Usage      | None                                          |
| `PUBLIC`            | N/A   | None           | None       | None                                          |

Deployment login principals are environment-owned secrets and are not declared here. Each service
will receive one group role through protected infrastructure. Runtime roles are not members of the
owner or one another; they cannot create schema objects, use temporary database storage, read a
private table, or rely on `public` in `search_path`. The database default and group-role defaults
both use only `pg_catalog, pg_temp`; service startup must still verify the effective role and
setting after connecting.

Every private table has forced row-level security with an owner-only policy. This is defense in
depth against an accidental future table grant; it does not justify adding a direct runtime grant.
Runtime access must remain procedure-only and must have positive and negative integration tests.

## Data and privacy map

All current columns map to the canonical [privacy data map](../docs/security/PRIVACY_DATA_MAP.md):

| Tables                                   | Classes                       | Stored boundary                                                                 |
| ---------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------- |
| `profiles`                               | Account; handle is Public     | Numeric GitHub binding, normalized handle, explicit preferences, lifecycle time |
| `invites`, `sessions`, `auth_challenges` | Security                      | Keyed 32-byte verifiers/digests, bounded state, expiry, and one-time use        |
| `passkeys`, `recovery_codes`             | Security; label is Account    | Public credential material and Argon2id PHC verifiers; never plaintext secrets  |
| `codex_sources`                          | Account                       | Opaque source ID, owning profile, and constrained lifecycle state               |
| `device_keys`, `pairing_transactions`    | Security; metadata is Account | Ed25519 public key, exact source/device binding, keyed poll/code verifiers      |
| `deletion_jobs`, `deletion_tombstones`   | Security; Operational         | Keyed identity references, bounded work state, lease digest, and expiry         |
| `schema_migrations`                      | Operational                   | Revision name and server application time only                                  |

The schema has no column for GitHub access tokens, account email, prompts, conversations, repository
data, Codex credentials, API keys, local paths, arbitrary payloads, or raw support evidence.
Free-form JSON and arbitrary audit metadata are intentionally absent.

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

Migrations are forward-only. A SQL error rolls back revision 0001 atomically. Before any shared
environment exists, a disposable local/test database can be discarded and rebuilt. After a migration
reaches a shared environment, repair it with a reviewed forward migration; do not add a destructive
generic down script or edit the recorded file.

Production bootstrap, login creation, role membership, TLS, credentials, backups, restore, retention
schedules, and migration orchestration remain deployment work. The bootstrap file must run only
through the protected migration principal. An unexpected pre-existing group-role membership is a
hard failure, not something the script silently broadens or repairs.

## Remaining security work

- Add procedure-only invite, session, passkey, recovery, pairing, and deletion capabilities.
- Prove each procedure's IDOR, replay, expiry, concurrency, and rollback behavior.
- Implement bounded cleanup for expired ceremonies, sessions, pairings, jobs, and tombstones.
- Replace every launch-decision retention item with public policy and purge evidence.
- Exercise migration overlap, backup restore, deletion replay, role rotation, and service rollback
  in isolated staging before real-user ingestion.
