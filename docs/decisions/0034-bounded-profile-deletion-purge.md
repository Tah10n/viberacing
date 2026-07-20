# ADR 0034: Bounded primary profile deletion purge

- Status: Accepted (local scheduler catalog; deployment pending)
- Date: 2026-07-17
- Decision owners: Web/Auth, Jobs, Database, Security, Privacy, and Operations
- Supersedes: None
- Superseded by: None

## Context

The profile-deletion request already requires the exact active session, typed handle, and fresh
passkey assertion. Revision 0002 then hides the profile, revokes browser/passkey/device/recovery
authority, unlinks sources, cancels approved pairing, and queues one opaque deletion job in the same
transaction. That immediate lock-down prevents new public reads and submissions, but the repository
had no executable consumer for the queued primary-data deletion.

A purge cannot be implemented as an unrestricted Jobs query. The queue row requires a profile
reference until it is terminal, while pairing rows deliberately use `RESTRICT` references to
sources, devices, sessions, and passkeys. A profile cascade also intersects authentication cleanup,
ingest cleanup, pairing cleanup, Community scoring/finalization, and concurrent Ingest/Web lock
orders. The implementation must therefore be bounded, atomic, least-privileged, idempotent, and
explicit about the separate tombstone, cache, backup, schedule, and restore-replay gates.

## Decision

Revision 0024 adds one private `profile_deletion_purge` maintenance mutex and grants only
`viberacing_jobs` the new `purge_profile_deletions(integer)` function. One invocation accepts an
exact batch from 1 through 10 and uses database server time. It returns only `purged_profiles`.

Before touching a queue or profile row, the function locks all five current maintenance mutex rows
in stable capability order. A profile cascade can remove authentication, pairing, ingest, and score
state, so this deliberately serializes primary deletion against every existing Jobs mutation. Each
other Jobs function locks only its own row and therefore cannot wait in the reverse order.

The function then selects only due `queued` or `retry_wait` jobs, ordered by availability, request
time, and job ID, with `FOR UPDATE SKIP LOCKED`. For each candidate it:

1. locks the exact profile only when committed state is `deletion_pending`, skipping a concurrently
   held profile but failing closed on committed state drift;
2. deletes every pairing bound to that profile before any referenced identity/source/device row;
3. deletes a pairing's key only when it is still authority-free `pending` state with no source or
   public device ID;
4. marks the exact queue row `purged`, clears lease/error state, and records server completion time;
5. deletes the still-`deletion_pending` profile, allowing reviewed foreign-key cascades to remove
   its invite, sessions, passkeys, recovery state, challenges, sources, devices, usage, and personal
   score rows; and
6. verifies every required queue/profile/pairing mutation count before incrementing the result.

The job becomes terminal before the profile delete because its `ON DELETE SET NULL` foreign key
would otherwise violate the non-terminal queue shape. Both statements remain inside one database
transaction, so no caller can observe a purged job while primary data remains. The opaque job and
redacted audit event remain after success; their profile links are null. Repeating the command after
the due queue is empty returns zero.

ADR 0014's one-shot Jobs boundary gains `purge-profile-deletions`, always with the fixed maximum
batch of 10. The existing one-client pool, per-checkout login/role/search-path probe, fixed prepared
query, exact one-row result mapping, destructive release on failure, and non-reflective CLI output
remain unchanged. No caller chooses SQL, profile, cutoff, identifier, result column, or batch size.

## Security and privacy consequences

The capability now physically removes the requested profile's primary identity, credential, device,
usage, and personal score data while retaining only the already documented opaque terminal job and
audit record with its profile reference redacted. ADR 0045 subsequently makes that job
cleanup-eligible 30 days after completion, and ADR 0046 makes the database audit reference
cleanup-eligible 180 days after occurrence. The profile-purge slice collects no new field, prints no
count, and adds only one fixed non-personal mutex row.

The maximum is 10 rather than the 1000-row retention-cleanup limit because one profile may own many
cascaded rows. The 30-second database statement deadline and five-second lock deadline remain
fail-closed bounds, not capacity evidence. Locking every maintenance mutex prioritizes deletion
correctness over parallel Jobs throughput and removes the auth-child/profile and scoring/usage
cross-capability deadlock paths.

This decision does not create a security tombstone. The queued `profile_ref_digest` is random and
cannot safely stand in for a keyed identity digest; the repository has no reviewed tombstone key,
expiry, restore consumer, or backup policy. Cache invalidation, disclosed tombstone retention,
restore replay, backup expiry, host-timer delivery, a wall-clock recurring process callback,
deployed signal routing and orchestrator grace policy, deployed cadence, monitoring, alerting,
production Jobs login/TLS, capacity, and deployment remain launch-blocking gates. ADR 0063 provides
fixed-clock core composition, directly injected repeated-timer execution and lifecycle settlement,
real-clock emitted-process terminal-marker evidence, and one pinned-Linux OS-signal/PostgreSQL path;
emitted-child controller settlement before forced termination remains unproven.

Affected invariants are VR-AUTH-001, VR-AUTH-003, VR-INGEST-001, VR-INGEST-002, VR-DATA-001, and
VR-DELETE-001. Primary attacker stories are VR-ABUSE-DATABASE-ROLE, VR-ABUSE-DELETE-RESURRECTION,
VR-ABUSE-RESOURCE-EXHAUSTION, VR-ABUSE-PROFILE-ENUMERATION, and VR-ABUSE-SCORE-MANIPULATION.

## Alternatives considered

- **Delete the profile before settling the job:** rejected because the queue constraint requires a
  profile for non-terminal state and the foreign key sets that reference to null.
- **Rely only on profile cascade:** rejected because profile-bound pairings intentionally restrict
  deletion through their source/device/session/passkey provenance, and cancelled pending pairings
  can leave an authority-free key.
- **Lock only the new purge mutex:** rejected because authentication cleanup can lock a challenge
  before a profile while purge locks the profile before cascading that challenge. Other maintenance
  capabilities also touch profile-owned usage or score rows.
- **Lease the job and issue generic application-side deletes:** rejected because it would require
  direct table authority, expose a partial-failure interval, and widen the fixed Jobs adapter.
- **Use the 1000-row cleanup batch:** rejected because profile cascades have a materially larger and
  more variable row fan-out than one expired nonce, challenge, or pairing.
- **Create a tombstone from the opaque job digest:** rejected because a random per-request value
  cannot detect identity resurrection and must not be misrepresented as a keyed identity marker.

## Migration and rollback

Revision 0024 is forward-only and runs in one transaction under the migration advisory lock, the
non-login owner, a five-second migration lock timeout, and a 30-second statement timeout. It extends
the closed maintenance-mutex enum, inserts one fixed mutex row, creates and grants one function, and
records its immutable manifest digest.

Before a shared environment, rollback discards and rebuilds the disposable database and removes the
local command. After release, repair requires another reviewed forward migration; do not edit
revision 0024. Stopping a future schedule prevents new purges but cannot restore already deleted
primary data. Rollback must never grant Jobs direct tables, reattach profile references, or recreate
data from terminal job/audit rows.

## Verification

Current evidence includes:

- static migration/checksum validation across 24 immutable revisions;
- real PostgreSQL scenarios for oldest-first maximum-10 batching, `retry_wait`, future work,
  idempotency, invalid batches, committed state drift rollback, missing mutex, exact role grants,
  terminal job shape, and explicit no-tombstone behavior;
- the existing end-to-end deletion-request fixture followed by real purge of its invite, sessions,
  passkeys, source, active and pending keys, restrictive pairing, and open score rows while
  retaining a terminal opaque job and redacted audit event;
- an observed two-worker race proving one-row purge batches serialize and settle each exact job;
- an observed purge-versus-auth-cleanup race proving the shared ordered mutex contract; and
- the complete isolated PostgreSQL suite with 25 tables, 27 observed lock-wait races, 12 relation
  denials, and 34 cross-capability checks, plus 132 focused Jobs tests at 100% statement, branch,
  function, and line coverage with strict lint, type checking, and production build.

The SQL evidence uses synthetic rows in a portless ephemeral PostgreSQL project. Focused Jobs tests
use an injected pool; the shared opt-in Jobs integration additionally proves this emitted command
through one disposable narrow login and exact terminal job/profile state. A separate ADR 0045
integration proves only local terminal-job cleanup after the fixed retention boundary. ADR 0063
separately proves the default-off scheduler against a fake runner and clock, composes its production
core with the real runner and disposable PostgreSQL under fixed injected UTC time, and directly
invokes the production interval handler for a repeated fixed-clock cycle and the lifecycle handler
after an active runner call starts. These layers do not prove host-timer delivery, OS-signal
delivery, emitted-child controller settlement before forced termination, wall-clock recurring
process behavior, a published deletion window, production login/TLS, monitoring, backup expiry,
tombstone/restore replay, cache invalidation, capacity, or deployment.

## References

- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
- [Database capability boundary](../../database/README.md)
- [Jobs boundary](../../apps/jobs/README.md)
- [Identity and device authority](0003-identity-step-up-and-device-authority.md)
- [Bounded Community maintenance runner](0014-bounded-community-maintenance-job-runner.md)
- [Bounded authentication retention cleanup](0032-bounded-auth-retention-cleanup.md)
- [Bounded terminal deletion-job retention cleanup](0045-bounded-terminal-deletion-job-retention-cleanup.md)
- [Bounded database audit-event retention cleanup](0046-bounded-audit-event-retention-cleanup.md)
