# ADR 0045: Bounded terminal deletion-job retention cleanup

- Status: Accepted (local scheduler catalog; deployment pending)
- Date: 2026-07-18
- Decision owners: Web/Auth, Jobs, Database, Security, Privacy, and Operations
- Supersedes: None
- Superseded by: None

## Context

Primary profile purge deliberately leaves one terminal `deletion_jobs` row after the profile and its
personal data are removed. The row contains a random 32-byte profile-reference digest, closed state,
attempt metadata, and timestamps. This bounded operational evidence can reconcile recent purge
completion, but indefinite retention would preserve Security metadata and permit unbounded growth
without improving deletion authority.

This slice must establish one fixed retention boundary, preserve recent terminal evidence, never
delete active or retryable work, avoid racing primary purge, and keep the existing least-privileged
Jobs boundary. It must not invent a keyed deletion tombstone, purge audit evidence, claim cache or
backup deletion, schedule work, or imply restore-replay protection.

## Decision

Revision 0032 adds one partial ordered `(completed_at, deletion_job_id)` index over only `purged`
jobs whose profile link is already null. It grants only `viberacing_jobs` the new
`cleanup_terminal_deletion_jobs(integer)` function.

One invocation:

- accepts an exact batch from 1 through 1000;
- locks the existing private `profile_deletion_purge` mutex before capturing PostgreSQL server time;
- derives a fixed cutoff of 30 days before that server time, with no caller-selected timestamp;
- selects only `purged` jobs with a null profile link and non-null completion at or before the
  cutoff, ordered by completion and identifier;
- locks candidates with `FOR UPDATE SKIP LOCKED` and repeats all state, profile, completion, and
  cutoff predicates in the delete;
- leaves queued, running, retry-wait, linked, malformed, and recent terminal rows untouched; and
- returns only `deleted_deletion_jobs`.

Sharing the profile-deletion mutex makes a concurrently settling purge commit or roll back before
the cleanup cutoff is captured, serializes cleanup workers, and preserves the existing global Jobs
lock order. Invalid batches, a missing mutex, lock timeout, integrity failure, changed result shape,
or a count outside the requested batch produce the existing generic failure and roll back the call.

ADR 0014's one-shot Jobs boundary gains the exact `cleanup-terminal-deletion-jobs` command. It
always supplies 1000, performs the same per-checkout role/login/search-path probe, issues one fixed
parameterized query, accepts one exact result row, holds the client through settlement, destroys it
on failure, and emits only the existing generic completion or failure sentence. No caller chooses
SQL, cutoff, row state, identifier, result column, or batch size.

## Security and privacy consequences

The cleanup removes the random job identifier, random 32-byte reference digest, closed operational
state, attempt/error metadata, and timestamps once at least 30 days of terminal retention have
elapsed. It adds no collected field, personal identifier, log, cache, export, dependency, role,
table, or maintenance row. The aggregate count is transient in the local process and is never
printed, logged, cached, exported, or stored.

Recent completion evidence remains available for bounded operational reconciliation. Redacted audit
events remain under their separate policy. No identity-derived tombstone is created or deleted;
there is still no reviewed digest, expiry, backup, or restore-replay contract for one. The repeated
database predicates prevent cleanup from widening into pending deletion authority.

Residual risk remains: ADR 0063 supplies only a default-off in-memory local catalog, sequential
execution, and no-overlap lifecycle. There is no combined scheduler/PostgreSQL result, deployed
cadence, durable missed-slot recovery, monitoring, capacity result, production Jobs login/TLS
connection, external audit sink, public cache purge, backup-expiry proof, disclosed tombstone
policy, restore replay, or deployed retention evidence.

Affected invariants are VR-DATA-001 and VR-DELETE-001. Primary attacker stories are
VR-ABUSE-DATABASE-ROLE, VR-ABUSE-DELETE-RESURRECTION, and VR-ABUSE-RESOURCE-EXHAUSTION.

## Alternatives considered

- **Retain terminal jobs indefinitely:** rejected because random Security metadata and queue history
  would grow without a bounded operational purpose.
- **Delete the job in the primary purge transaction:** rejected because short-lived terminal
  evidence is useful for recent completion reconciliation and would disappear before the purge
  caller settles.
- **Use requested or available time:** rejected because only `completed_at` marks the terminal
  transition whose retention is being bounded.
- **Delete linked or non-terminal jobs:** rejected because those rows still represent pending or
  retryable deletion authority.
- **Accept a CLI cutoff or batch:** rejected because the fixed server-time rule and reviewed maximum
  remove operator-selected deletion scope.
- **Create or populate tombstones in this slice:** rejected because safe restore replay requires a
  separately reviewed keyed identity digest, expiry, backup, and recovery contract.
- **Create a scheduler in this slice:** rejected because cadence, monitoring, overlap policy,
  credentials, and capacity evidence are separate operational decisions.

## Migration and rollback

Revision 0032 is forward-only and runs in one transaction under the migration advisory lock, the
non-login owner, a five-second migration lock timeout, and a 30-second statement timeout. It adds
one partial index, creates and grants one function, and records its immutable manifest digest. It
changes no row shape, foreign key, trigger, role membership, maintenance row, or existing procedure
signature.

Before a shared environment, rollback discards and rebuilds the disposable database and removes the
local command. After release, repair requires another reviewed forward migration; do not edit
revision 0032. Stopping a future schedule cannot restore terminal rows already deleted, and rollback
must not widen Jobs table access or delete non-terminal work.

## Verification

Acceptance evidence recorded for this decision includes:

- static validation of 33 contiguous immutable migration revisions and the exact checksum ledger;
- real PostgreSQL scenarios for oldest-first batch bounds, the exact 30-day terminal predicate,
  recent/non-terminal preservation, idempotency, invalid batches, missing mutex, supporting index,
  and exact role grants;
- an observed two-worker race in which separate one-row batches serialize and each aged terminal job
  is removed once while recent evidence remains;
- the complete isolated PostgreSQL suite with 27 tables, 33 observed lock-wait races, 12 direct
  relation denials, and 52 cross-capability denials;
- 192 focused Jobs tests with 100% statement, branch, function, and line coverage plus strict lint
  and type checking; and
- a separate disposable PostgreSQL integration that runs all eleven built Jobs commands through a
  narrow login, rejects a deliberately widened login before mutation, preserves generic output,
  deletes an aged terminal job, and retains the newly completed purge job.

All fixtures are synthetic. ADR 0063 separately proves the default-off scheduler against a fake
runner and clock. These layers do not prove combined scheduler/PostgreSQL execution, production
cadence/login/TLS, monitoring, cache or backup purge, tombstone/restore replay, capacity, or
deployment.

## References

- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
- [Database capability boundary](../../database/README.md)
- [Jobs boundary](../../apps/jobs/README.md)
- [Bounded Community maintenance runner](0014-bounded-community-maintenance-job-runner.md)
- [Bounded primary profile deletion purge](0034-bounded-profile-deletion-purge.md)
- [Bounded invite retention cleanup](0043-bounded-invite-retention-cleanup.md)
- [Bounded database audit-event retention cleanup](0046-bounded-audit-event-retention-cleanup.md)
