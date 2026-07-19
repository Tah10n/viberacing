# ADR 0014: Bounded Community maintenance job runner

- Status: Accepted (local synthetic PostgreSQL integration; wrapped by ADR 0063)
- Date: 2026-07-15
- Decision owners: Jobs, Database, Security, Privacy, and Operations
- Supersedes: None
- Superseded by: ADR 0063 (scheduler-pending portion only)

## Context

Revisions 0008 through 0010 expose three narrow `viberacing_jobs` database capabilities: delete one
bounded batch of expired ingest state, refresh one open Community season, and idempotently finalize
one Community season after grace. PostgreSQL integration proves their role grants, server-time
decisions, serialization, bounds, rollback, and concurrency semantics. Until now, no application
process could invoke those procedures without inventing a generic database client or relying on an
operator's owner credentials.

A production scheduler, service login, certificate, monitoring backend, retry policy, and capacity
result do not yet exist. The first application slice therefore needs to make one invocation safe and
testable without claiming scheduled execution or accepting arbitrary maintenance work. This boundary
crosses TB-07 and touches TB-11 because cleanup removes retained raw state and scoring writes public
derived state.

## Decision

Add a private `apps/jobs` TypeScript workspace containing one local one-shot command runner. It
accepts exactly these command forms:

- `cleanup-expired-ingest-state`, mapped to a fixed batch of 1000;
- `refresh-community-season YYYY-MM-DD`; and
- `finalize-community-season YYYY-MM-DD`.

[ADR 0029](0029-bounded-pairing-retention-cleanup.md) later extends the current closed set with one
fourth fixed command, `cleanup-expired-pairing-state`; it does not change this decision's pool,
probe, output, or generic-query prohibitions.

[ADR 0032](0032-bounded-auth-retention-cleanup.md) adds a fifth fixed command,
`cleanup-expired-auth-state`, under those same boundaries.

[ADR 0034](0034-bounded-profile-deletion-purge.md) adds a sixth fixed command,
`purge-profile-deletions`, with its separate maximum-10 profile batch under those same boundaries.

[ADR 0036](0036-bounded-car-recipe-proposal-cleanup.md) adds a seventh fixed command,
`cleanup-expired-car-recipe-proposals`, with the fixed maximum batch of 1000.

[ADR 0042](0042-bounded-expired-session-retention-cleanup.md) adds an eighth fixed command,
`cleanup-expired-sessions`, with the fixed maximum batch of 1000 and the same one-shot boundary.

[ADR 0043](0043-bounded-invite-retention-cleanup.md) adds a ninth fixed command,
`cleanup-expired-invites`, with the fixed maximum batch of 1000 and the same one-shot boundary.

[ADR 0045](0045-bounded-terminal-deletion-job-retention-cleanup.md) adds a tenth fixed command,
`cleanup-terminal-deletion-jobs`, with the fixed maximum batch of 1000 and the same one-shot
boundary.

[ADR 0046](0046-bounded-audit-event-retention-cleanup.md) adds an eleventh fixed command,
`cleanup-expired-audit-events`, with the fixed maximum batch of 1000 and the same one-shot boundary.

[ADR 0047](0047-bounded-pairing-approval-provenance-retention.md) adds a twelfth fixed command,
`redact-aged-pairing-approval-provenance`, with the fixed maximum batch of 1000 and the same
one-shot boundary.

[ADR 0048](0048-bounded-revoked-passkey-retention-cleanup.md) adds a thirteenth fixed command,
`cleanup-aged-revoked-passkeys`, with the fixed maximum batch of 1000 and the same one-shot
boundary.

[ADR 0049](0049-bounded-revoked-device-retention-cleanup.md) adds a fourteenth fixed command,
`cleanup-aged-revoked-devices`, with the fixed maximum batch of 1000 and the same one-shot boundary.

[ADR 0050](0050-bounded-pairing-rate-window-retention-reset.md) adds a fifteenth fixed command,
`reset-expired-pairing-request-windows`. It accepts no parameter and can reset at most the existing
130 fixed operation/global/bucket rows.

[ADR 0061](0061-bounded-abandoned-enrollment-retention-cleanup.md) adds a sixteenth fixed command,
`cleanup-abandoned-enrollments`, with the fixed maximum batch of 1000 and the same one-shot
boundary.

[ADR 0062](0062-finalized-source-day-retention-cleanup.md) adds a seventeenth fixed command,
`cleanup-finalized-source-day-values`, with the fixed maximum batch of 1000 and the same one-shot
boundary.

Season input must be one canonical Monday from `1999-12-27` through `2099-12-28`. Unknown commands,
arguments, fields, sparse or exotic arrays, accessors, prototypes, and values fail before database
configuration or connection. Programmatic job objects are separately revalidated as closed plain
data, so the CLI parser is not the only enforcement point.

The runner reads only `VIBERACING_JOBS_DATABASE_*`. Cleartext is allowed solely for explicit
development/test loopback use; every other connection requires certificate-verifying TLS with a DNS
hostname. Passwords are non-enumerable and JSON-redacted. The pool maximum is one, connection
acquisition is bounded to two seconds, the client statement deadline is 31 seconds, and its query
deadline is 32 seconds, outside the procedures' 30-second statement deadline. A failed client is
destroyed, a healthy client is released only after the procedure result settles and validates, and
the pool is closed on every acquired CLI path.

Every checkout first verifies all of the following in one fixed query:

- `CURRENT_USER` is exactly `viberacing_jobs`;
- `SESSION_USER` is a distinct, non-superuser login that can set `viberacing_jobs`;
- the login can connect but cannot create or use temporary database objects;
- it has no other group membership; and
- the search path is exactly `pg_catalog,pg_temp`.

The second and only capability query is selected in code from a closed set of seventeen fixed
parameterized SQL strings: the original three plus ADR 0029's pairing-retention cleanup, ADR 0032's
authentication cleanup, ADR 0034's primary profile deletion purge, ADR 0036's CarRecipe-proposal
cleanup, ADR 0042's session-retention cleanup, ADR 0043's invite-retention cleanup, ADR 0045's
terminal deletion-job cleanup, ADR 0046's audit-event cleanup, ADR 0047's pairing
approval-provenance redaction, ADR 0048's aged revoked-passkey cleanup, ADR 0049's aged
revoked-device cleanup, ADR 0050's fixed pairing-rate-window reset, ADR 0061's abandoned-enrollment
cleanup, and ADR 0062's finalized source/day cleanup. There is no generic query, table access,
migration, owner, Web, Ingest, Admin, interactive auth, or correction capability. The returned array
and row must contain exactly one plain dense row and the allowlisted integer columns. Cleanup counts
cannot exceed the requested batch; paired deletion counts must agree; rate-window reset cannot
exceed 130; scoring counts must fit PostgreSQL `integer`. Accessors, extra columns, missing rows,
invalid counts, and driver/runtime exceptions produce one stable error type without reflecting
values.

The CLI prints only one stable success or failure sentence. It does not print the command, season,
counts, configuration, SQL, exception, or stack. The pool monitoring seam accepts only the closed
`idle_client_error` signal and contains sink failures. There is deliberately no scheduled loop,
network listener, health endpoint, retry loop, telemetry backend, or production login provisioning
in this decision.

## Security and privacy consequences

The application can exercise only authority the database already grants to `viberacing_jobs`, and it
rechecks effective authority on every connection instead of trusting configuration alone. Fixed
queries and closed results reduce SQL-injection, capability-confusion, prototype/accessor, and
unexpected-driver-data paths. Single-client operation plus layered deadlines bounds one process;
PostgreSQL remains authoritative for mutexes, server time, idempotency, grace, score caps, and final
immutability.

No new personal or usage field is collected, retained, cached, exported, or logged. The runner
transiently receives a public season label or a fixed cleanup batch and private aggregate counts,
then discards them when the process exits. Stable CLI outcomes are operational control flow, not an
analytics or retention sink. Production scheduler metadata, run history, alerts, and aggregate
metrics still require a privacy-map and retention review before collection.

A local synthetic integration now proves the emitted application can use one disposable narrow login
for all seventeen capabilities and that an extra-membership login fails the runtime probe before
mutation. Residual risk remains: no production login/certificate path proves deployment membership;
no external audit sink exists; ADR 0063 supplies only a default-off in-memory local scheduler, not a
deployed cadence, durable backlog, production monitor, or alerting; cleanup does not cover every
expiring identity state; no correction, cache/backup purge, or restore replay exists; and no
capacity test proves the selected deadlines under production load. A compromised Jobs login still
has all seventeen database capabilities, so principal separation and revocation remain required.

Affected invariants are VR-PUBLIC-001, VR-INGEST-002, VR-ABUSE-001, VR-DATA-001, and VR-DELETE-001.
Primary attacker stories are VR-ABUSE-SEASON-RACE, VR-ABUSE-DATABASE-ROLE,
VR-ABUSE-RESOURCE-EXHAUSTION, and VR-ABUSE-DELETE-RESURRECTION.

## Alternatives considered

- **Let an operator call SQL directly:** rejected because it encourages owner credentials, bypasses
  the runtime-role probe, and has no closed command or result boundary.
- **Add a generic Jobs SQL adapter:** rejected because generic SQL would erase the procedure-only
  capability model and make future configuration or command input an injection/privilege surface.
- **Implement the scheduler immediately:** rejected because deployment cadence, overlap, retry,
  alert, retention, and production login policy have not been selected or capacity-tested. The
  one-shot boundary is the reusable unit a future scheduler may invoke.
- **Expose an HTTP maintenance endpoint:** rejected because Jobs are not a public request surface
  and no edge/auth/origin contract grants remote maintenance authority.
- **Accept a caller-selected cleanup batch on the CLI:** rejected for the initial runner because the
  database's reviewed 1000-row maximum already bounds one useful invocation and removes one
  operational tuning input. Programmatic validation retains the database range for direct tests and
  future reviewed orchestration.
- **Reuse the Web database login or configuration namespace:** rejected because scoring/cleanup are
  write capabilities and must remain independently revocable from the public read principal.

## Migration and rollback

This change adds one private workspace, public-safe placeholder environment names, root verification
gates, and a direct declaration of the already locked and reviewed `pg@8.22.0` client. It adds no
database migration, role grant, credential, network route, stored field, cache, or deployment.

Rollback is to stop invoking and remove the Jobs workspace, scripts, placeholders, documentation,
lockfile importer, and dependency-inventory references. The database capabilities remain safe and
idempotently callable by a future reviewed implementation. Rollback must not replace the runner with
owner SQL, weaken procedure grants, or edit released migrations. A future scheduler wraps the same
closed runner or supersedes this ADR if it changes commands, overlap, telemetry, authority, or retry
semantics.

## Verification

Current local evidence includes:

- strict configuration bounds, local-only cleartext, verified production TLS, redacted password
  enumeration/serialization, and hostile environment reads;
- exact one-client pool configuration, structured query forwarding, close/release behavior, and
  contained synchronous/asynchronous signal-sink failures;
- canonical season and batch bounds, closed object/array/result allowlists, sparse/exotic/accessor/
  proxy rejection, aggregate count bounds, and non-reflective failures;
- effective-role/login/capability/search-path rejection before every procedure call;
- exact prepared parameters for all seventeen functions, healthy versus destructive release,
  connection and query translation, and a deferred query proving release occurs only after
  settlement;
- CLI rejection before configuration, pool close after success or failure, stable output, writer
  failure containment, and no reflected command/error detail;
- 266 unit tests with 100% statement, branch, function, and line coverage, including a lint-policy
  regression that keeps direct `pg` imports inside the fixed pool adapter;
- one opt-in Docker integration that revalidates and applies the migration manifest, runs all
  seventeen built commands through a synthetic narrow login, rejects a deliberately widened login
  before mutation, validates constant process output and exact stored state, and removes its
  container, network, and storage; and
- strict lint, type checking, production TypeScript build, dependency/license inventory, root
  deterministic verification, and staged public-data review.

The general SQL integration suite separately proves the seventeen procedure bodies and concurrency
behavior in portless ephemeral PostgreSQL. The Jobs integration proves one synthetic loopback
Node-to-PostgreSQL application path. ADR 0063 proves the local scheduler against a fake runner and
clock, separately composes its production core under fixed injected UTC time with this real runner
and disposable PostgreSQL, directly injects the production lifecycle handler after an active runner
call starts, and starts the built entry point under the real host clock through its terminal
startup-catalog marker without process output. OS-signal delivery, emitted-child controller
settlement before forced termination, recurring timer-callback behavior, production TLS/login,
capacity, monitoring, real-user retention, and deployment evidence remain required before those
behaviors may be claimed.

## References

- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [System context](../architecture/SYSTEM_CONTEXT.md)
- [Data flow](../architecture/DATA_FLOW.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
- [Database capability boundary](../../database/README.md)
- [Edge, service, and database isolation](0004-edge-service-and-database-isolation.md)
- [Community season grace and finalization](0008-community-season-grace-and-finalization.md)
- [Bounded pairing retention cleanup](0029-bounded-pairing-retention-cleanup.md)
- [Bounded authentication retention cleanup](0032-bounded-auth-retention-cleanup.md)
- [Bounded primary profile deletion purge](0034-bounded-profile-deletion-purge.md)
- [Bounded CarRecipe proposal retention cleanup](0036-bounded-car-recipe-proposal-cleanup.md)
- [Bounded expired session retention cleanup](0042-bounded-expired-session-retention-cleanup.md)
- [Bounded invite retention cleanup](0043-bounded-invite-retention-cleanup.md)
- [Bounded terminal deletion-job retention cleanup](0045-bounded-terminal-deletion-job-retention-cleanup.md)
- [Bounded database audit-event retention cleanup](0046-bounded-audit-event-retention-cleanup.md)
- [Bounded pairing approval-provenance retention](0047-bounded-pairing-approval-provenance-retention.md)
- [Bounded revoked-passkey retention cleanup](0048-bounded-revoked-passkey-retention-cleanup.md)
- [Bounded revoked-device retention cleanup](0049-bounded-revoked-device-retention-cleanup.md)
- [Bounded pairing rate-window retention reset](0050-bounded-pairing-rate-window-retention-reset.md)
