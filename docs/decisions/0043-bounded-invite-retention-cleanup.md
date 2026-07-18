# ADR 0043: Bounded invite retention cleanup

- Status: Accepted (database capability and local one-shot command implemented; scheduling pending)
- Date: 2026-07-18
- Decision owners: Web/Auth, Admin, Jobs, Database, Security, Privacy, and Operations
- Supersedes: None
- Superseded by: None

## Context

An invite stops authorizing enrollment at its server-owned expiry, and revocation ends it earlier.
Without physical cleanup, the database still retains the unredeemed invite identifier and 32-byte
verifier digest after neither can authorize a profile. Repeated issuance could therefore grow
Security state indefinitely even though the separate issuance audit event does not require the
verifier row.

Redeemed invites are different: their row is the exact profile-enrollment provenance and already
cascades with primary profile deletion. This slice must reduce only expired unredeemed state, keep
that provenance intact, avoid racing an in-flight redemption, and preserve the closed Jobs database
boundary. It must not imply an invite issuer UI, scheduler, production Jobs login, or deployed
retention policy.

## Decision

Revision 0031 replaces the active-only invite expiry index with one ordered
`(expires_at, invite_id)` index over only `active` and `revoked` rows. It grants only
`viberacing_jobs` the new `cleanup_expired_invites(integer)` function.

One invocation:

- accepts an exact batch from 1 through 1000;
- locks the existing private `auth_retention_cleanup` mutex before capturing PostgreSQL server time;
- selects only expired `active` or `revoked` rows in deterministic expiry/identifier order;
- locks candidates with `FOR UPDATE SKIP LOCKED`, so an enrollment already holding a row settles and
  that row remains for a later invocation;
- repeats state and expiry predicates in the delete;
- never selects a `redeemed` row or a live invite; and
- returns only `deleted_invites`.

Sharing the authentication-retention mutex serializes cleanup workers and keeps the existing
profile-purge lock order without adding a caller-selectable or public lock key. Any invalid batch,
missing mutex, lock timeout, integrity failure, changed result shape, or count outside the requested
batch produces the existing generic failure and rolls back the call.

ADR 0014's one-shot Jobs boundary gains the exact `cleanup-expired-invites` command. It always
supplies 1000, performs the same per-checkout role/login/search-path probe, issues one fixed
parameterized query, accepts one exact result row, holds the client through settlement, destroys it
on failure, and emits only the existing generic completion or failure sentence. No caller chooses
SQL, cutoff, state, identifier, result column, or batch size.

## Security and privacy consequences

Physical cleanup removes an expired high-entropy verifier digest and invite identifier only after
they cannot authorize enrollment. It adds no field, identifier, log, cache, export, dependency,
role, table, or maintenance row. The count is transient in the local process and is never printed,
logged, cached, exported, or stored.

Redeemed invite provenance remains until its profile is purged. Issuance audit evidence remains a
separate bounded event without the verifier digest. The row lock prevents cleanup from deleting an
invite underneath an already-running redemption, while the repeated predicates fail closed if a
candidate changes before deletion.

Residual risk remains: no invite issuance UI, scheduler, cadence, retry/overlap policy, monitoring,
capacity result, production Jobs login/TLS connection, backup-expiry proof, or deployed retention
policy exists. Terminal deletion jobs/tombstones, pairing-referenced sessions, historical
passkey/device provenance, and any future expiring class still require separate reviewed rules.

Affected invariants are VR-AUTH-001 and VR-DATA-001. Primary attacker stories are
VR-ABUSE-AUTH-TAKEOVER, VR-ABUSE-DATABASE-ROLE, and VR-ABUSE-RESOURCE-EXHAUSTION.

## Alternatives considered

- **Delete every expired invite:** rejected because a redeemed row retains exact enrollment
  provenance until the profile is purged.
- **Delete revoked invites immediately:** rejected because the existing `expires_at` remains the
  single reviewed physical-retention boundary and avoids a new caller-selected cutoff.
- **Add a new maintenance mutex:** rejected because invite verifiers are authentication state and
  the existing mutex already serializes relevant Jobs cleanup and profile purge.
- **Wait on every candidate row:** rejected because a live enrollment must settle within its own
  deadline; cleanup can safely leave a locked row for a later batch.
- **Expose cutoff, state, or batch on the CLI:** rejected because PostgreSQL server time and the
  fixed reviewed maximum remove operator-selected deletion scope.
- **Create an invite scheduler in this slice:** rejected because deployment cadence, monitoring,
  overlap policy, credentials, and capacity evidence are separate operational decisions.

## Migration and rollback

Revision 0031 is forward-only and runs in one transaction under the migration advisory lock, the
non-login owner, a five-second migration lock timeout, and a 30-second statement timeout. It
replaces one index, creates and grants one function, and records its immutable manifest digest. It
changes no row shape, foreign key, trigger, role membership, or existing procedure signature.

Before a shared environment, rollback discards and rebuilds the disposable database and removes the
local command. After release, repair requires another reviewed forward migration; do not edit
revision 0031. Stopping a future schedule cannot restore expired rows already deleted, and rollback
must not delete redeemed provenance or widen Jobs table access.

## Verification

Acceptance evidence recorded for this decision includes:

- static validation of 31 contiguous immutable migration revisions and the exact checksum ledger;
- real PostgreSQL scenarios for oldest-first batch bounds, active/revoked deletion, idempotency,
  live and redeemed preservation, invalid batches, missing mutex, supporting index, and exact role
  grants;
- an observed two-worker race in which separate one-row batches serialize and each expired row is
  removed once while live authority remains;
- the complete isolated PostgreSQL suite with 27 tables, 31 observed lock-wait races, 12 direct
  relation denials, and 46 cross-capability denials;
- 168 focused Jobs tests with 100% statement, branch, function, and line coverage plus strict lint
  and type checking; and
- a separate disposable PostgreSQL integration that runs all nine built Jobs commands through a
  narrow login, rejects a deliberately widened login before mutation, preserves generic output, and
  verifies exact stored state.

All fixtures are synthetic. This evidence proves no scheduler, production cadence/login/TLS,
monitoring, backup purge, capacity, invite issuance UI, or deployment.

## References

- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
- [Database capability boundary](../../database/README.md)
- [Jobs boundary](../../apps/jobs/README.md)
- [Identity step-up and device authority](0003-identity-step-up-and-device-authority.md)
- [Bounded Community maintenance runner](0014-bounded-community-maintenance-job-runner.md)
- [Bounded authentication retention cleanup](0032-bounded-auth-retention-cleanup.md)
- [Bounded primary profile deletion purge](0034-bounded-profile-deletion-purge.md)
