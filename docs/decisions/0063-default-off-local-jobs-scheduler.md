# ADR 0063: Default-off local Jobs scheduler

- Status: Accepted (local scheduler and synthetic PostgreSQL composition; deployment pending)
- Date: 2026-07-19
- Decision owners: Jobs, Security, Privacy, Operations, and Database
- Supersedes: Scheduler-pending portion of ADR 0014
- Superseded by: None

## Context

The repository has seventeen reviewed one-shot Jobs capabilities. Their inputs, result shapes,
database role, connection ceiling, statement deadlines, row bounds, lock orders, and idempotency are
already enforced in `@viberacing/jobs` and PostgreSQL. An opt-in synthetic integration proves each
emitted command against a disposable least-privileged login.

Nothing invokes those commands on a recurring basis. Expiry makes authority unusable, but physical
cleanup, redaction, fixed-window reset, profile purge, scoring refresh, and terminal season
finalization still depend on an operator starting individual processes. A scheduler therefore needs
to close the local application gap without creating a generic maintenance API, accepting operational
commands from configuration, or implying that a deployed cadence and monitor exist.

This boundary crosses TB-07 and TB-11. A compromised or misconfigured scheduler could repeatedly
exercise all Jobs capabilities, starve interactive services through lock contention, silently skip
retention, derive a wrong season from local time, overlap itself, or print private database results.
VR-DATA-001 and VR-INGEST-002 remain non-negotiable: the scheduler may select only reviewed Jobs
objects, while PostgreSQL remains authoritative for time-sensitive eligibility, serialization, grace
closure, terminal state, and deletion bounds.

## Decision

Add a separate private `@viberacing/jobs-scheduler` workspace. It depends only on `@viberacing/jobs`
and Node platform timers. Its lint policy rejects direct PostgreSQL, filesystem, network, TLS, and
subprocess imports. The existing one-shot CLI remains unchanged and independently invocable.

The scheduler is admitted only when `VIBERACING_JOBS_SCHEDULER_ENABLED` is the exact string `true`.
The enable value is read before the Jobs runner is constructed and therefore before any
`VIBERACING_JOBS_DATABASE_*` value is read or a pool exists. Missing, false, malformed,
getter-failing, and tracked example values fail closed. The scheduler accepts no process argument.
No second flag, truthy parser, file, request, or runtime toggle can enable it.

The schedule is compiled into one closed UTC catalog:

- poll the in-memory schedule once per minute;
- refresh the current Monday-based Community season at most once per uninterrupted five-minute
  process slot;
- finalize the latest Community season whose fixed Wednesday 00:00 UTC grace boundary has elapsed at
  most once per UTC day;
- run the fifteen cleanup, redaction, reset, and profile-purge objects at most once per
  uninterrupted UTC-hour process slot.

The hourly catalog is dependency-ordered. Aged pairing approval provenance is redacted before
expired-session deletion, which runs before aged revoked-passkey and revoked-device deletion. This
allows one sequential cycle to release and then remove newly unreferenced retained rows while every
database function still repeats its own eligibility checks under the reviewed mutex order.

On Monday and Tuesday the latest grace-eligible finalization target is the season starting two
Mondays earlier. From Wednesday through Sunday it is the immediately preceding Monday. This avoids
depending on local time and still closes the most recent terminal boundary after an ordinary weekend
outage. The supported clock and generated Monday labels stay inside the existing `1999-12-27`
through `2099-12-28` Jobs contract. A non-integer, out-of-range, or backward wall clock fails the
cycle without reaching the runner.

This catalog intentionally does not scan arbitrary historical dates. An outage that misses more than
the latest grace-eligible season still requires the exact existing one-shot finalization command
under operator control. A future database-backed backlog or run ledger would collect new operational
state and needs its own privacy, capacity, and recovery decision.

Each catalog slot is marked in memory before invocation. Due objects run sequentially through one
configured Jobs runner and its existing one-client pool. A timer firing during a cycle is ignored;
cycles never overlap. A failed object does not receive an immediate retry and does not prevent later
fixed objects in that cycle. Only the next fixed slot or a process restart can retry it. Restarting
may repeat the current slot, which is safe only because every admitted PostgreSQL capability is
bounded and idempotent or converges on the same terminal state.

The schedule validates its due collection as one frozen dense array of at most seventeen entries.
The Jobs runner then revalidates every individual object before selecting one prepared capability.
No result is used to widen later work. Counts, dates, commands, identifiers, SQL, configuration,
driver errors, and stacks are discarded.

An optional process signal receives only `cycle_failed`, once for a cycle containing any failed
object or schedule decision. The production entry point turns that value into one generic sentence;
it does not identify the failing job. There is no run history, queue, retry counter, metric, trace,
health route, listener, or external monitoring backend in this slice.

The first `SIGINT` or `SIGTERM` clears the interval, prevents another object from starting, waits
for only the currently settling Jobs call, and closes the runner. Existing Jobs client and database
deadlines bound that call. A fixed 35-second process deadline, second signal, or close failure
forces an unsuccessful exit. The scheduler never abandons a live client merely to report success.

## Security and privacy consequences

The new workspace receives broad temporal authority but no new database capability. Compromise can
invoke only the same seventeen functions already granted to the Jobs login, sequentially and with
their fixed inputs. The database role probe still runs before every capability, failed clients are
destroyed, and the pool ceiling remains one. Default-off startup limits accidental execution from a
preview, developer shell, or incomplete deployment.

The fixed catalog and no-overlap rule reduce command injection, environment poisoning, retry storms,
and self-contention under VR-ABUSE-DATABASE-ROLE, VR-ABUSE-SEASON-RACE, and
VR-ABUSE-RESOURCE-EXHAUSTION. They do not establish capacity. One hourly cycle can still be delayed
by bounded lock or query waits, and a compromised valid Jobs credential can exercise every granted
function until the principal is revoked.

No personal, account, usage, or security field is added. In-memory slot numbers and the current
clock are Operational control state and disappear with the process. The scheduler does not retain
results or dates. A generic failure sentence may be captured by a deployment log outside this
repository; its access, retention, alert routing, and correlation remain deployment work. Adding a
run ledger, job name, affected count, timestamp, error code, or operator identity requires a new
privacy-map entry before collection.

This local scheduler is not evidence that any process is deployed or continuously running. It does
not provide a production Jobs credential/certificate, hosted timer result, single-replica lease,
cross-replica coordination, alert owner, capacity measurement, external audit sink, backup purge,
restore replay, cache invalidation, deletion notification, or real-user retention result. Multiple
deployed replicas would each have independent in-memory slots; PostgreSQL idempotency preserves
correctness, but load and cadence must be reviewed before deployment.

## Alternatives considered

- **Accept cron command and date strings from environment:** rejected because it would turn
  deployment configuration into a command/date injection surface and bypass the closed Jobs object
  inventory.
- **Run every capability on every one-minute poll:** rejected because logical expiry is already
  enforced by PostgreSQL and unnecessary repeated calls would increase lock and connection load.
- **Persist a scheduler queue or last-run table:** deferred because it introduces operational
  identifiers, retention, recovery, migration, and multi-replica semantics beyond this local slice.
- **Spawn the one-shot CLI for every job:** rejected because subprocess paths, environment copying,
  output budgets, and reap semantics add authority without improving the already reviewed runner
  boundary.
- **Run due jobs concurrently:** rejected because the single-client Jobs ceiling, maintenance mutex
  ordering, predictable load, and bounded shutdown are clearer when invocation is sequential.
- **Retry a failed object immediately:** rejected because failure may represent database saturation,
  lock contention, or invalid deployment credentials. The next fixed slot is the only local retry
  boundary until monitoring and backoff policy are reviewed.
- **Silently enable scheduling when database configuration exists:** rejected because credential
  presence is not operator authorization to perform recurring destructive maintenance.
- **Claim production scheduling from this process loop:** rejected because a binary and timer tests
  do not prove a hosted replica, credential, uptime, cadence, monitoring, or capacity.

## Migration and rollback

There is no database or public protocol migration. `@viberacing/jobs` gains only a package export
for its existing runner and types. The workspace graph and lockfile gain one internal consumer and
no new external package version.

Rollback is to set the exact enable latch to any value other than `true`, stop the process, and then
remove the scheduler workspace, root scripts, verifier entries, documentation, and lockfile importer
in a reviewed change. The one-shot Jobs commands and PostgreSQL procedures remain safe and available
for explicit recovery. Rollback must not weaken expiry, finalization immutability, database grants,
or procedure bounds.

## Verification

Local evidence includes:

- exact true-only configuration and proof that no Jobs database field is inspected before it;
- UTC Monday, Wednesday grace, year-boundary, supported-range, backward-clock, five-minute, hourly,
  and daily schedule cases;
- an exact frozen maximum-seventeen due collection and rejection of sparse, accessor-backed,
  oversized, mutable, or extra-key arrays;
- sequential initial execution, ignored overlapping ticks, no next object after shutdown, current
  object settlement, and idempotent close;
- continuation after one failed object with one closed signal and containment of a throwing sink;
- partial-start cleanup, invalid dependency/runner/schedule containment, interval setup failure, and
  combined shutdown failure;
- first-signal graceful close, shutdown during startup, second-signal/deadline/close-failure forced
  exit, invalid controller/dependency denial, and hostile proxy containment;
- 94 scheduler tests at 100% statement, branch, function, and line coverage, including the explicit
  provenance/session/passkey/device dependency order and a lint-policy regression for static,
  exported, dynamic, and legacy forbidden runtime imports plus built-in module-loader escape paths,
  strict TypeScript, production build, and a built-entrypoint check that rejects disabled and
  argument-bearing startup without reflective output;
- the existing separate synthetic Jobs PostgreSQL integration for all seventeen emitted database
  capabilities;
- an opt-in combined integration that builds the production scheduler core and Jobs runner, injects
  one fixed UTC clock/timer, executes the exact ordered seventeen-job catalog against one disposable
  PostgreSQL database, fingerprints every private table before and after a widened-login denial, and
  verifies exact stored state through the narrow login;
- a separate opt-in timer integration that advances the fixed clock by one hour, invokes the
  production interval handler twice during the active real-runner cycle, proves the exact recurring
  sixteen-job catalog plus overlap and same-slot suppression, and verifies the rearmed terminal
  pairing-rate-window reset;
- a separate opt-in lifecycle integration that composes the production process state machine with
  that fixed-clock core and real runner, starts the penultimate real-runner call before injecting
  its first handler, proves that active call settles and the later scheduler job does not start, and
  requires exact interval/deadline/handler/runner cleanup plus exit code 0. The harness invokes the
  omitted reset only afterward before the shared exact-state oracle;
- a separate opt-in emitted-process integration that starts the built entry point with exact enable
  and narrow-login configuration, requires real host/disposable-database UTC-date agreement, waits
  for the terminal reset marker, requires no process output, forcibly ends only its otherwise
  persistent test child, and then verifies the same exact stored state. Secretless CI declares all
  four scheduler commands, but this tree claims only the observed local passes.

The fixed-clock, timer, and lifecycle integrations invoke production components in-process. The
timer handler is called directly and therefore does not exercise host-timer delivery; the lifecycle
signal handler is called directly and therefore does not exercise OS-signal delivery. The
emitted-process integration observes only the immediate startup catalog through its terminal
database marker and deliberately uses `SIGKILL` because Windows cannot deliver this child a
catchable POSIX shutdown signal. It does not prove controller settlement before forced termination.
None exercises a wall-clock recurring process callback or an OS-delivered graceful process signal
against PostgreSQL. None proves that a production clock remains stable, a deployment has one
replica, durable cadence is maintained, missed historical seasons are recovered, production
TLS/credentials work, or a real-user retention/deletion deadline is met.

## References

- [Bounded Community maintenance runner](0014-bounded-community-maintenance-job-runner.md)
- [Community season grace and immutable finalization](0008-community-season-grace-and-finalization.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
