# ADR 0046: Bounded database audit-event retention cleanup

- Status: Accepted (local scheduler catalog; deployment pending)
- Date: 2026-07-18
- Decision owners: Jobs, Database, Security, Privacy, and Operations
- Supersedes: None
- Superseded by: None

## Context

The private PostgreSQL `audit_events` table keeps closed event and actor enums, a random request
reference, an optional bounded reason, server occurrence time, and an optional profile link. Profile
purge already nulls that link, but every row otherwise remained indefinitely. That preserved local
security evidence while also creating unbounded Security and Operational metadata growth without a
published retention boundary.

This slice must retain a useful investigation window, remove both linked and already-redacted rows
after one public maximum, serialize workers, and preserve the closed least-privileged Jobs boundary.
It must not create an audit reader or exporter, imply that an external append-only sink exists,
accept a caller-selected cutoff, schedule deletion, purge backups, or claim deployed retention.

## Decision

Revision 0033 changes the existing audit-time index to ordered `(occurred_at, audit_event_id)` form,
adds one private `audit_retention_cleanup` mutex, and grants only `viberacing_jobs` the new
`cleanup_expired_audit_events(integer)` function.

One invocation:

- accepts an exact batch from 1 through 1000;
- locks the private audit-retention mutex before capturing PostgreSQL server time;
- derives a fixed cutoff of 180 days before that server time, with no caller-selected timestamp;
- selects every audit row at or before the cutoff in occurrence/identifier order;
- locks candidates with `FOR UPDATE SKIP LOCKED` and repeats the cutoff predicate at deletion;
- leaves every event younger than 180 days untouched; and
- returns only `deleted_audit_events`.

The uniform public maximum applies to every current database event type and to both linked and
redacted rows. `append_audit_event` always records server time, so a new security action cannot age
into the selected set while a worker waits. Cleanup never locks a profile or authority row. A
concurrent profile purge may wait briefly on an old linked audit row, then safely continue after the
row is deleted; cleanup cannot form a reverse profile lock order.

ADR 0014's one-shot Jobs boundary gains the exact `cleanup-expired-audit-events` command. It always
supplies 1000, performs the same per-checkout role/login/search-path probe, issues one fixed
parameterized query, accepts one exact result row, holds the client through settlement, destroys it
on failure, and emits only the existing generic completion or failure sentence. No caller chooses
SQL, event type, profile, request, reason, cutoff, identifier, result column, or batch size.

## Security and privacy consequences

Eligible deletion removes the random audit ID, closed event and actor values, optional profile link,
random request reference, optional bounded reason, and occurrence time after at least 180 days. It
adds no collected field, personal identifier, log, cache, export, dependency, role, or user-facing
response. The aggregate count is transient in the local process and is never printed, logged,
cached, exported, or stored.

The table's `(request_id, event_type)` uniqueness therefore supplies finite, not permanent,
duplicate-action evidence. A request reference is not authority: every capability must still prove
its current role, session, verifier, challenge, state, and row constraints. A retry older than 180
days is outside the database idempotency window and must not be accepted merely because its old
audit row is absent.

The local database is not an append-only external audit system. Until a separately reviewed export,
access, integrity, retention, and incident-response contract exists, running this cleanup makes the
selected local evidence irrecoverable except for independently governed backups. There is no
scheduler here, so no deployed deletion cadence or proof is implied.

Residual risk remains: there is no external audit sink or user-visible audit subset. ADR 0063
supplies a default-off in-memory local catalog, sequential execution, no-overlap lifecycle,
fixed-clock core composition, and real-clock emitted-process terminal-marker evidence. There is no
controller settlement before forced termination, recurring timer-callback or graceful
process-signal/PostgreSQL result, deployed cadence, durable missed-slot recovery, monitoring,
capacity result, production Jobs login/TLS connection, cache or backup purge, tombstone policy,
restore replay, or deployed retention evidence.

Affected invariant is VR-DATA-001. Primary attacker stories are VR-ABUSE-DATABASE-ROLE,
VR-ABUSE-RESOURCE-EXHAUSTION, and VR-ABUSE-DELETE-RESURRECTION.

## Alternatives considered

- **Retain database audit rows indefinitely:** rejected because bounded metadata would still grow
  without a bounded purpose or public deletion rule.
- **Delete profile-linked audit events during primary purge:** rejected because short-lived redacted
  security evidence is useful after primary personal data is removed.
- **Retain redacted rows forever:** rejected because request references, event history, reasons, and
  times remain Security and Operational data even without a profile foreign key.
- **Use per-event retention periods:** rejected for this first slice because current rows share one
  minimal shape and no implemented external sink or incident class justifies a more complex policy.
- **Accept a CLI cutoff or batch:** rejected because a fixed server-time rule and reviewed maximum
  remove operator-selected deletion scope.
- **Export before deletion in this function:** rejected because network or sink authority does not
  belong in a database procedure or the one-shot Jobs query boundary.
- **Create a scheduler in this slice:** rejected because cadence, monitoring, overlap policy,
  credentials, sink coordination, and capacity evidence are separate operational decisions.

## Migration and rollback

Revision 0033 is forward-only and runs in one transaction under the migration advisory lock, the
non-login owner, a five-second migration lock timeout, and a 30-second statement timeout. It
replaces one existing index with its deterministic two-column form, widens the closed
maintenance-lock enum, adds one mutex row, creates and grants one function, and records its
immutable manifest digest. It changes no audit row shape, foreign key, trigger, event/actor enum,
role membership, existing procedure signature, or external system.

Before a shared environment, rollback discards and rebuilds the disposable database and removes the
local command. After release, repair requires another reviewed forward migration; do not edit
revision 0033. Stopping a future schedule cannot restore deleted audit rows, and rollback must not
widen Jobs table access or infer an external record.

## Verification

Acceptance evidence recorded for this decision includes:

- static validation of 33 contiguous immutable migration revisions and the exact checksum ledger;
- real PostgreSQL scenarios for oldest-first batches, the exact 180-day server cutoff, linked and
  redacted eligibility, recent-event preservation, idempotency, invalid batches, missing mutex,
  supporting index, and exact role grants;
- an observed two-worker race in which separate one-row batches serialize, each aged event is
  removed once, and recent evidence remains;
- the complete isolated PostgreSQL suite with 27 tables, 33 observed lock-wait races, 12 direct
  relation denials, and 52 cross-capability denials;
- 192 focused Jobs tests with 100% statement, branch, function, and line coverage plus strict lint
  and type checking; and
- a separate disposable PostgreSQL integration that runs all eleven built Jobs commands through a
  narrow login, rejects a deliberately widened login before mutation, preserves generic output,
  removes one aged audit event, and verifies exact stored state.

All fixtures are synthetic. ADR 0063 separately proves the default-off scheduler against a fake
runner and clock and composes its production core with the real runner and disposable PostgreSQL
under fixed injected UTC time. These layers do not prove an external append-only sink, recurring
timer-callback or graceful process-signal/PostgreSQL behavior, production cadence/login/TLS,
monitoring, cache or backup purge, restore replay, capacity, or deployment.

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
- [Bounded terminal deletion-job retention cleanup](0045-bounded-terminal-deletion-job-retention-cleanup.md)
