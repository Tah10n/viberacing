# ADR 0050: Bounded pairing rate-window retention reset

- Status: Accepted (local scheduler catalog; deployment pending)
- Date: 2026-07-18
- Decision owners: Pairing, Web/Auth, Jobs, Database, Security, Privacy, and Operations
- Supersedes: None
- Superseded by: None

## Context

Revision 0022 preallocates exactly 130 anonymous pairing transport rate rows: one operation-global
row plus 64 digest-selected buckets for each of `start` and `poll`. Admission stores no raw client
ID or digest, increments saturating aggregate counts, and resets an expired row only when another
request for that operation/bucket arrives. Fixed storage bounds attacker-created state, but if
traffic stops the last aggregate count and millisecond window-start timestamp would otherwise remain
indefinitely.

The admission contract accepts a deployment-private window of at most 3600 seconds. A retention
reset can therefore scrub a row only after one complete hour has elapsed without weakening any valid
configured window. It must preserve all 130 preallocated rows, the global-then-bucket admission
order, Web-only admission, saturating limits, and absence of client identifiers. It must not accept
an operation, bucket, cutoff, duration, batch, identity, or SQL from Jobs; create a trusted edge
identity; schedule itself; or claim capacity, monitoring, or deployment.

## Decision

Revision 0037 strengthens each fixed row to one of two closed shapes:

- zero count with the exact Unix-epoch sentinel timestamp; or
- count 1 through 1,000,001 with a post-epoch window timestamp.

It grants only `viberacing_jobs` the new zero-argument `reset_expired_pairing_request_windows()`
function. One invocation:

- verifies before mutation that the constrained primary-key table still contains all 130 possible
  operation/bucket rows;
- captures PostgreSQL server time and derives one fixed cutoff exactly one hour earlier;
- selects only rows with a positive count and `window_started_at` at or before that cutoff;
- visits at most the full fixed matrix in primary-key order: operation, then global bucket `-1`,
  then numbered buckets;
- locks each selected row in that order, repeats the positive-count and cutoff predicates, sets the
  timestamp to the epoch sentinel and count to zero, and requires exactly one changed row; and
- returns only one bounded `reset_windows` aggregate from 0 through 130.

The fixed one-hour cutoff is conservative for every allowed deployment window. No caller can select
a cutoff, reset any current permitted window, select a bucket, reduce a live counter, or
create/delete a row. The procedure uses the same operation-local global-before-bucket order as Web
admission. The fixed rows are their own private serialization boundary, so no new maintenance mutex
or caller-visible lock key is added. Concurrent reset workers converge; overlapping Web admission
either completes before reset and makes the row recent, or completes after reset and starts a fresh
count of one.

ADR 0014's one-shot Jobs boundary gains the exact `reset-expired-pairing-request-windows` command.
It supplies no parameters, performs the same per-checkout login/role/search-path probe, invokes one
fixed query, validates one exact result row bounded by 130, holds the client through settlement,
destroys it on failure, and emits only the existing generic completion or failure sentence.

## Security and privacy consequences

The reset reduces retained Security/Operational metadata after the longest permitted rate window. It
does not collect, reconstruct, return, log, cache, or export a client ID, digest, IP address, user
agent, profile, source, device, request body, operation choice, bucket, timestamp, or count. Jobs
retains no result; the transient aggregate is not printed.

The zero-state constraint prevents a nominally empty row from retaining an arbitrary timestamp. The
exact 130-row inventory check fails before mutation if owner/migration drift removed a fixed bucket.
Runtime roles still have no direct table access: Web can execute only admission, Jobs can execute
only reset, and Ingest/Admin/PUBLIC can execute neither maintenance capability.

Two observed PostgreSQL races cover the concurrency contract. Overlapping reset workers serialize on
the same fixed rows and converge on one scrubbed state. In the reset-versus-admission race, Web is
observed waiting on the reset-held global row, then successfully establishes fresh global/bucket
counts after release; reset does not erase the admitted request. A rollback-only trigger also proves
that failure on a later row restores every earlier row in the same invocation.

The self-asserted client ID remains cheap rate shaping, not authentication, a stable person/device
identity, or a trusted network signal. The 130 rows themselves remain for the lifetime of the
capability. ADR 0063 supplies only a default-off in-memory local catalog, sequential execution,
no-overlap lifecycle, fixed-clock core composition, directly injected lifecycle settlement, and
real-clock emitted-process terminal-marker evidence. Trusted edge limits, capacity evidence,
OS-signal delivery, emitted-child controller settlement before forced termination, recurring
timer-callback behavior, deployed cadence, durable missed-slot recovery, monitoring, production Jobs
login/TLS, real-user evidence, and deployment remain absent. Keyed deletion tombstones, caches,
backups, and restore replay still require separate policies and proof.

Affected invariants are VR-DATA-001 and VR-ABUSE-001. Primary attacker stories are
VR-ABUSE-PAIRING-HIJACK, VR-ABUSE-DATABASE-ROLE, and VR-ABUSE-RESOURCE-EXHAUSTION.

## Alternatives considered

- **Rely only on request-time reset:** rejected because the last aggregate timestamp/count then has
  no bounded end when traffic stops.
- **Delete expired rows:** rejected because a missing global or bucket row breaks fail-closed
  admission and turns maintenance into availability-sensitive schema mutation.
- **Reset after each configured duration:** rejected because the duration is deployment-private and
  caller-controlled maintenance scope would permit premature reset. One hour safely covers every
  allowed value.
- **Pass operation, bucket, cutoff, or batch from the CLI:** rejected because the table is already a
  fixed maximum and PostgreSQL server time plus a zero-argument procedure closes operator scope.
- **Store one row per client ID or digest:** rejected because it creates attacker-amplified state
  and persistent linkability without providing trusted identity.
- **Add a maintenance mutex:** rejected because the exact fixed rows already serialize reset with
  both workers and Web admission, while another lock could introduce an avoidable ordering edge.
- **Use `SKIP LOCKED`:** rejected for this tiny fixed matrix because a complete ordered reset and
  observed serialization give simpler convergence evidence; the five-second lock deadline remains
  the fail-closed bound.

## Migration and rollback

Revision 0037 is forward-only and runs in one transaction under the migration advisory lock, the
non-login owner, a five-second migration lock timeout, and a 30-second statement timeout. It
replaces one row-shape constraint, creates and grants one Jobs-only function, and records its
immutable manifest digest. It adds no table, row, column, index, dependency, role membership,
maintenance mutex, browser value, or external system.

Before a shared environment, rollback discards and rebuilds the disposable database and removes the
local command. After release, repair requires another reviewed forward migration; do not edit
revision 0037. Stopping a future schedule leaves rate admission unchanged, and rollback must not
widen table access or allow deletion of fixed rows.

## Verification

Acceptance evidence recorded for this decision includes:

- static validation of 37 contiguous immutable migration revisions and the exact checksum ledger;
- PostgreSQL scenarios for the 130-row inventory, closed state shape, exact one-hour boundary,
  recent-row preservation, idempotency, no-argument signature, role grants, missing-row failure,
  continued Web admission, and atomic rollback after a later-row constraint failure;
- observed reset-worker and reset-versus-live-admission races with final exact-state assertions;
- the complete isolated PostgreSQL suite with 27 tables, 38 observed lock-wait races, 12 direct
  relation denials, and 64 cross-capability denials;
- 242 focused Jobs tests with 100% statement, branch, function, and line coverage plus strict lint,
  type checking, and build; and
- a separate disposable PostgreSQL integration that runs all fifteen built Jobs commands through a
  narrow login, rejects a deliberately widened login before the reset mutates state, preserves
  generic output, and verifies both exact reset rows.

All fixtures are synthetic. ADR 0063 separately proves the default-off scheduler against a fake
runner and clock, exercises the reset in a fixed-clock production-core/PostgreSQL cycle, and
directly invokes the production lifecycle handler after an active runner call starts. These layers
do not prove a trusted anonymous identity, edge limit, OS-signal delivery, emitted-child controller
settlement before forced termination, recurring timer-callback behavior, production
cadence/login/TLS, monitoring, capacity, backup or cache purge, restore replay, real-user retention,
or deployment.

## References

- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
- [Database capability boundary](../../database/README.md)
- [Jobs boundary](../../apps/jobs/README.md)
- [Service and database isolation](0004-edge-service-and-database-isolation.md)
- [Bounded Community maintenance runner](0014-bounded-community-maintenance-job-runner.md)
- [Bounded connector pairing transport](0030-bounded-connector-pairing-transport.md)
- [Bounded expired-session retention cleanup](0042-bounded-expired-session-retention-cleanup.md)
- [Bounded revoked-device retention cleanup](0049-bounded-revoked-device-retention-cleanup.md)
