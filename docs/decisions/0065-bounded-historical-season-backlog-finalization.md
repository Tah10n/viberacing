# ADR 0065: Bounded historical season backlog finalization

- Status: Accepted (local database, Jobs, scheduler, and synthetic PostgreSQL evidence)
- Date: 2026-07-20
- Decision owners: Jobs, Security, Privacy, Operations, and Database
- Supersedes: Historical-backlog deferral in ADR 0063
- Superseded by: None

## Context

ADR 0063 deliberately finalizes only the latest grace-eligible Community season. That closes an
ordinary weekend outage, but a longer interruption can leave older accepted source/day values or an
already-created open season without a terminal projection. Ingest still rejects a late payload by
server time, so this is not an acceptance bypass; it is a missing bounded recovery path for derived
score state and later retention.

Accepting a caller-selected date range, scanning every calendar week, or adding a durable scheduler
queue would create new authority, capacity, privacy, and recovery semantics. A recovery step can
instead derive work only from state already retained by the scoring boundary.

## Decision

Revision 0040 adds the zero-argument Jobs-only `viberacing_api.finalize_community_season_backlog()`
capability. It acquires the existing `community_scoring_refresh` mutex, captures PostgreSQL time
after that lock, and selects only the oldest grace-eligible candidate from either:

- an existing `open` season; or
- an ISO week already represented by retained `source_day_values` and not already finalized.

The function never accepts a date, range, batch, limit, command, or clock. It processes at most one
season by invoking the existing idempotent finalization capability in the same transaction. Its only
result is `finalized_season_count` in the closed range 0–1 plus the existing bounded
`profile_count`; it does not return the selected date or any identifier. An empty eligible backlog
returns one exact zero/zero row.

The pre-existing reviewed source-date/source-ID index and one new partial index over open season
starts support oldest-first discovery. The 5-second lock timeout and 30-second statement timeout
remain defense in depth. They are not capacity evidence.

The Jobs runner adds exactly one no-argument `finalize-community-backlog` command and fixed query.
The default-off scheduler places that object first in its hourly catalog, after the separately
derived latest-season finalization and current-season refresh on a startup cycle. The maximum
startup catalog is therefore eighteen objects; a later hour contains seventeen because the explicit
latest-season finalization is daily. One invocation can advance only one historical season. A
failure is contained like every other scheduler object and can retry only in a later fixed slot or
through an explicit one-shot command.

This boundary intentionally does not invent or finalize empty calendar weeks that have neither an
existing season nor retained accepted data. Those weeks have no user projection to recover, while
the unchanged server-time Ingest rule already treats them as closed after grace. It also adds no run
ledger, queue, retry counter, affected date, metric, trace, operator identity, or monitoring sink.

## Security and privacy consequences

Only the existing least-privileged Jobs role can call the function. Web, Ingest, Admin, and `PUBLIC`
remain denied, runtime roles still cannot read private tables, and the scheduler gains no SQL or
caller-selected scope. The shared scoring mutex serializes concurrent backlog workers with refresh,
explicit finalization, and finalized-source retention work; the existing per-season lock continues
to serialize Ingest and terminal materialization.

No new personal, account, usage, security, or operational field is collected. The reused and new
indexes cover only already-mapped private date/source and public season-state keys. The selected
date and returned counts remain inside one Jobs call and are discarded by the application boundary.
Generic process output remains unchanged.

A compromised valid Jobs login can now repeatedly advance old known seasons, but cannot choose a
date, reopen a terminal season, accept late usage, modify a finalized projection, or reach another
database capability. PostgreSQL idempotency and one-season progress bound correctness; deployment
rate, replica count, capacity, credential/TLS, monitoring, and incident response remain required.

## Alternatives considered

- **Persist a backlog queue or run ledger:** deferred because it adds operational state, retention,
  multi-replica recovery, migration, and monitoring semantics.
- **Accept a start/end date or batch size:** rejected because deployment input would select scoring
  scope and could amplify work.
- **Finalize every week since a fixed epoch:** rejected because empty calendar history is not user
  state and would create unbounded synthetic rows.
- **Replace latest-season finalization with oldest-first recovery:** rejected because a large old
  backlog must not delay the ordinary latest terminal boundary.
- **Process multiple seasons in one database call:** rejected because one expensive historical
  materialization must remain the statement's maximum work unit until capacity is measured.

## Migration and rollback

Revision 0040 is forward-only and adds one partial index, one function, and one Jobs grant. It adds
no table, column, public contract, dependency, or durable scheduler state. The manifest checksum is
the review record; applying the file remains an explicit migration-controller action against a
selected database, never a side effect of starting the website.

Operational rollback is to disable or stop the default-off scheduler and stop invoking the new
one-shot command. The new function and partial index may remain unused. After any shared
application, repair through a reviewed forward migration rather than editing revision 0040 or adding
a destructive down script. Already finalized seasons remain terminal.

## Verification

Repository evidence includes:

- checksum and migration-shape gates over the forty-revision manifest;
- isolated PostgreSQL cases for empty, no-data open, data-backed missing, current-week, role-denial,
  supporting-index, and missing-mutex behavior;
- an observed two-worker blocker-chain race proving two calls serialize and finalize exactly the two
  oldest data-backed seasons;
- exact Jobs command, query, result-shape, hostile-input, connection, and generic-output tests at
  100% coverage;
- scheduler UTC catalog, maximum-18 collection, ordering, non-overlap, shutdown, and 100% coverage
  tests;
- the emitted eighteen-command least-privileged PostgreSQL integration; and
- fixed-clock startup/timer/lifecycle plus pinned-Linux controlled backlog denial, later-job
  continuation, active-finalization `SIGKILL`, restart retry, a later repeated restart, native-timer
  active-refresh, and active-finalization OS-signal scheduler integrations with an exact historical
  terminal-state oracle.

These are local synthetic results. They prove controlled failure/crash containment, later-job
continuation, successful restart retry, a later repeated restart, three graceful post-startup
`SIGTERM` settlements, one abrupt active-call `SIGKILL` exit, one native host-timer recurring
callback, and active-call signal settlement. They do not prove partial-write recovery, automatic
privilege repair, deployed cadence, production Jobs login/TLS, single-replica policy, representative
backlog size, capacity, monitoring, alert ownership, real-user recovery, or deployment.

## References

- [Default-off local Jobs scheduler](0063-default-off-local-jobs-scheduler.md)
- [Community season grace and immutable finalization](0008-community-season-grace-and-finalization.md)
- [Finalized source-day retention cleanup](0062-finalized-source-day-retention-cleanup.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
