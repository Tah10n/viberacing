# ADR 0036: Bounded CarRecipe proposal retention cleanup

- Status: Accepted (local scheduler catalog; deployment pending)
- Date: 2026-07-17
- Decision owners: Web/Auth, Jobs, Database, Security, Privacy, and Operations
- Supersedes: None
- Superseded by: None

## Context

ADR 0035 makes a pending `CarRecipeV1` proposal unusable after at most 24 hours, but logical expiry
does not physically remove its private profile binding and closed recipe fields. Replacement,
approval, rejection, or profile deletion removes the row incidentally; an abandoned account can
otherwise retain expired proposal state indefinitely.

The database already gives Jobs separate bounded retention capabilities and ADR 0014 forbids generic
SQL. This slice needs the smallest physical-deletion capability for expired proposals. It must
preserve every live proposal and active recipe, serialize workers, remain least-privileged, and
avoid claiming a scheduler, production cadence, production Jobs login/TLS, or deployment.

## Decision

Revision 0026 adds one owner-only maintenance mutex named `car_recipe_proposal_cleanup` and grants
only `viberacing_jobs` the new `cleanup_expired_car_recipe_proposals(integer)` function.

One invocation:

- accepts a batch from 1 through 1000;
- locks the fixed private mutex and only then captures the PostgreSQL clock;
- selects only proposals whose `expires_at` is at or before that clock;
- orders candidates by expiry and proposal ID, limits them to the requested batch, and uses
  `FOR UPDATE SKIP LOCKED` so an in-flight Web decision is left for a later invocation;
- rechecks expiry while deleting the exact selected proposal IDs;
- leaves active recipes, live proposals, profiles, sessions, audit state, and every other table
  untouched; and
- returns only one bounded `deleted_proposals` count.

Invalid or missing batch values, a missing mutex, lock timeout, integrity failure, unexpected row or
column shape, or database error fails closed and rolls back the invocation. Web, Ingest, Admin,
`PUBLIC`, and all runtime direct-table paths remain denied.

ADR 0014's one-shot Jobs boundary gains `cleanup-expired-car-recipe-proposals`, always with the
fixed maximum batch of 1000. It retains the one-client pool, per-checkout Jobs-only login/role and
search-path probe, fixed parameterized query, closed one-row mapper, destructive release on failure,
pool close on every CLI path, and non-reflective success/failure output. The CLI exposes no cutoff,
proposal/profile ID, SQL, result column, or caller-selected batch.

## Security and privacy consequences

Physical cleanup removes expired Account-class proposal state after its authority is already gone.
It collects no new personal field. The new mutex row is fixed non-personal operational state, and
the transient deletion count is not printed, logged, cached, exported, or retained.

The private mutex serializes cleanup workers. `SKIP LOCKED` deliberately trades immediate progress
for safety around a concurrent propose, approve, reject, or profile purge; a later invocation
re-evaluates the row. Cleanup cannot activate a recipe and does not grant Jobs a profile, browser,
device, or direct-table capability.

Residual risk remains: ADR 0063 supplies a default-off in-memory local catalog, sequential
execution, no-overlap lifecycle, fixed-clock core composition, directly injected repeated-timer
execution and lifecycle settlement, real-clock emitted-process post-startup signal settlement, and
later native-timer plus active-call OS-signal paths. Those emitted paths prove one local recurring
callback and three local signal settlements, not deployed OS-signal routing or
controller/orchestrator grace, deployed cadence, durable missed-slot recovery, monitoring, capacity
result, production Jobs login/TLS connection, backup-expiry proof, or deployed retention policy.
Active recipes remain until replacement or profile deletion. The separate public active-recipe
projection, device proposal ingress, and local agent orchestration were later accepted in
[ADR 0037](0037-bounded-public-community-race-projection.md),
[ADR 0038](0038-bounded-device-car-recipe-proposal-ingress.md), and
[ADR 0039](0039-bounded-agent-car-proposal-orchestration.md); scheduling and deployed retention
remain separate Phase 4 gates.

Affected invariants are VR-CAR-001 and VR-DATA-001. Primary attacker stories are
VR-ABUSE-CAR-INJECTION, VR-ABUSE-DATABASE-ROLE, and VR-ABUSE-RESOURCE-EXHAUSTION.

## Alternatives considered

- **Delete expired proposals during account reads:** rejected because a read-only browser request
  should not own retention progress and accounts that never return would still retain rows.
- **Extend Web rejection to accept expired controls:** rejected because an expired session-bound
  browser control is not authority and should not become a cleanup credential.
- **Delete active recipes after inactivity:** rejected because active recipes have no expiry and are
  public-intended profile presentation, not abandoned proposal state.
- **Combine proposal cleanup with authentication, pairing, or ingest cleanup:** rejected because the
  data class, incident rollback, cadence, and result contract are independent.
- **Expose cutoff, profile, proposal, or batch on the CLI:** rejected because PostgreSQL server time
  and the reviewed maximum are authoritative and keep operator-controlled deletion scope closed.
- **Grant Jobs direct table delete:** rejected because it would bypass the procedure-only role
  boundary and make future schema changes silently widen authority.

## Migration and rollback

Revision 0026 is forward-only and runs in one transaction under the migration advisory lock, the
non-login owner, a five-second migration lock timeout, and a 30-second statement timeout. It extends
the closed maintenance-mutex enum, inserts one fixed mutex, creates and grants one function, and
records its immutable manifest digest.

Before a shared environment, rollback discards and rebuilds the disposable database and removes the
local command. After release, repair requires another reviewed forward migration; do not edit
revision 0026. Stopping a future schedule cannot restore expired rows already deleted, and rollback
must not widen Jobs table access or substitute owner SQL.

## Verification

Acceptance evidence recorded for this decision included:

- static migration/checksum validation across 26 immutable revisions and 23 checker regression
  cases;
- real PostgreSQL scenarios for oldest-first batch bounds, idempotency, live-proposal and
  active-recipe preservation, invalid batches, missing mutex, and exact role grants;
- an observed two-worker race in which separate one-row batches serialize and remove each expired
  proposal once while preserving the live row;
- the complete isolated PostgreSQL suite with 27 tables, 28 observed lock-wait races, 12 relation
  denials, and 37 cross-capability checks; and
- 144 focused Jobs tests with 100% statement, branch, function, and line coverage plus strict lint,
  type checking, and production build.

The SQL evidence uses synthetic rows in a portless ephemeral PostgreSQL project. Focused Jobs tests
use an injected pool; the shared opt-in Jobs integration additionally proves this emitted command
through one disposable narrow login and exact stored state. ADR 0063 separately proves the
default-off scheduler against a fake runner and clock, composes its production core with the real
runner and disposable PostgreSQL under fixed injected UTC time, directly invokes the production
interval handler for a repeated fixed-clock cycle and the lifecycle handler after an active
real-runner call starts, and starts the built entry point under the real host clock through its
terminal startup-catalog marker without process output. Later ADR 0063 post-startup, native-timer,
and active-call OS-signal gates prove one local recurring callback and three local signal
settlements, but these layers still do not prove deployed signal routing or controller/orchestrator
grace, production cadence/login/TLS, monitoring, backup purge, capacity, or deployment.

## References

- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [CarRecipe reference](../reference/car-recipe.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
- [Database capability boundary](../../database/README.md)
- [Jobs boundary](../../apps/jobs/README.md)
- [Enum-only CarRecipe](0005-enum-only-car-recipe.md)
- [Bounded Community maintenance runner](0014-bounded-community-maintenance-job-runner.md)
- [Session-owned CarRecipe proposal](0035-bounded-session-car-recipe-proposal.md)
