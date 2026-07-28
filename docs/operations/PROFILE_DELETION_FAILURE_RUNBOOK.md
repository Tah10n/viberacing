# Profile deletion failure rehearsal runbook

> **Clean-slate transition hold:** ADR 0076 replaces source/device ownership with
> installation/AgentAccount/account-scoped-device authority and replaces live public ranking with
> immutable snapshots. The current procedure below describes old local baseline evidence only.
> Shared or staging use remains closed until the clean request, purge, snapshot removal, restore,
> cache, and credential oracles are implemented and this runbook is rebound to them.

This checked public runbook covers one narrow incident class: a profile-deletion request or the
bounded primary purge did not reach its expected state. It preserves the immediate authority
lock-down, separates request failure from purge failure and terminal-job retention, and permits only
a reviewed deployment-owned retry after the root cause is understood.

It is prerequisite guidance, not an executable deployment workflow. It does not inspect or change a
shared database, create monitoring, send notification, schedule Jobs, invalidate a cache, expire a
backup, replay a deletion marker, or prove that a real profile was deleted. All environment names,
identifiers, timestamps, counts, database state, errors, credentials, and incident details stay in
the protected incident system.

## Scope and evidence boundary

The current request transaction requires an authenticated session, exact typed handle, and consumed
fresh passkey challenge. On success it changes the profile to `deletion_pending`, hides it, revokes
active sessions, passkeys, and source-bound device keys, removes recovery codes and authentication
challenges, unlinks active/paused/quarantined sources, cancels approved pairing, creates one opaque
`queued` deletion job, and appends the request audit event atomically. The HTTP boundary returns 204
and clears its authentication cookies only after that transaction reports success. Neither the HTTP
request nor Web startup runs the physical purge.

The Jobs-only primary purge selects at most ten due `queued` or `retry_wait` jobs under the fixed
five deletion-intersecting private maintenance mutexes. It marks one job `purged`, clears
lease/error state, deletes the exact `deletion_pending` profile, and exposes both changes only if
the whole database transaction commits. Web, Ingest, and Admin cannot invoke it. The separate
terminal cleanup can delete only a profile-free `purged` job after at least 30 days; it is retention
cleanup, not a purge retry or completion oracle.

The schema contains `running`, `retry_wait`, attempt, lease, and error fields, and the purge accepts
a due `retry_wait` row. No repository-owned controller currently claims, leases, transitions, backs
off, or requeues a failed deletion job. Do not describe those schema fields or the hourly local
scheduler as automatic retry, durable missed-slot recovery, deployed cadence, or monitoring.

## Roles and protected record

Assign incident command, privacy/deletion, Web/Auth, Jobs, database, security, and
user-communication owners in a protected record before touching a shared environment. A person may
fill multiple roles only when the incident commander records that decision. The database and Jobs
operators use only environment-owned, least-privileged identities through reviewed controllers; they
never substitute an interactive owner, superuser, Web, Ingest, Admin, or widened Jobs login.

Keep the affected environment, profile/job references, times, aggregate state, query/result details,
database errors, hostnames, certificates, and credentials out of this repository, public issues,
pull requests, chat, and shell history. Public communication, if required, is a separately reviewed
sanitized summary.

## Preflight

- [ ] VR-DELETE-01: Assign incident, privacy/deletion, Web/Auth, Jobs, database, security, and
      communication owners in the protected record.
- [ ] VR-DELETE-02: Pin the exact reviewed commit, immutable service artifacts, migration ledger,
      affected environment, and deployment-owned controllers privately.
- [ ] VR-DELETE-03: Classify the symptom as request failure, queued primary-purge failure,
      terminal-job cleanup failure, or cache/backup/restore risk; do not merge those states.
- [ ] VR-DELETE-04: Preserve redacted aggregate evidence and the original immutable artifacts before
      restart, retry, or repair.
- [ ] VR-DELETE-05: Prove protected routing, process-settlement, database-health, least-privilege,
      verified-TLS, and monitoring prerequisites exist; otherwise keep the incident contained.
- [ ] VR-DELETE-06: Record an explicit go or no-go only after every repository-owned local gate
      below succeeds from the pinned clean checkout.

## Repository-owned local evidence

Run only these repository-owned gates against their synthetic fixtures and disposable PostgreSQL
resources. They do not accept a deployment target and must never be repointed at shared, staging, or
production data.

```text
pnpm run check:deletion-failure-runbook
pnpm run test:deletion-failure-runbook-check
pnpm run test:database-check
pnpm run check:database
pnpm run test:web:coverage
pnpm run test:jobs:coverage
pnpm run test:jobs-scheduler:coverage
pnpm run test:database:integration
pnpm run test:jobs:postgres-integration
pnpm run verify:release:node
```

The database evidence covers the request state machine, maximum-ten due-job selection, exact role
denials, state-drift rollback, mutex failure, atomic job/profile settlement, terminal retention, and
observed worker races. The Jobs integration invokes the fixed `purge-profile-deletions` and
`cleanup-terminal-deletion-jobs` commands against one disposable least-privileged login. The
scheduler evidence is local and exact-default-off. None proves a deployed process, alert, retry
controller, production credential/TLS path, representative capacity, user notification, cache or
backup deletion, stale-backup replay, or real-user outcome.

## Classify and contain

- [ ] VR-DELETE-07: Treat an absent successful request result as unknown lock-down; do not claim the
      profile is hidden or authority is revoked until the protected atomic request oracle confirms
      it.
- [ ] VR-DELETE-08: For a confirmed successful request, require one aggregate oracle to confirm
      `deletion_pending`, hidden profile, revoked active authority, unlinked sources, cancelled
      approved pairing, and one non-terminal job without exposing row data.
- [ ] VR-DELETE-09: Preserve that lock-down throughout the incident; never unhide, reactivate,
      relink, recreate recovery authority, mint a session, or issue a replacement credential.
- [ ] VR-DELETE-10: If request lock-down is absent or inconsistent, use the checked capability
      containment runbook and deployment controls to prevent affected authority or public state from
      being used while the root cause is investigated.
- [ ] VR-DELETE-11: Stop new scheduler cycles and settle the active Jobs call through the reviewed
      deployment controller when corruption, repeated failure, role drift, or uncertain state could
      make another purge unsafe.

Changing a local environment file does not stop a running Web or Jobs process. The checked
[capability containment runbook](CAPABILITY_CONTAINMENT_RUNBOOK.md) preserves profile deletion and
other defensive actions by default, but a deletion incident can require the deployment controller to
close broader routing or settle Jobs. Do not improvise an individual deletion kill switch that the
repository does not implement.

## Diagnose without mutation

- [ ] VR-DELETE-12: Use a protected read-only aggregate oracle to distinguish due `queued`, due
      `retry_wait`, future, `purged`, missing, linked, and malformed state without returning a
      profile, handle, digest, job identifier, timestamp, error code, or row.
- [ ] VR-DELETE-13: Verify the pinned ledger, exact function ownership/grants, forced RLS, the fixed
      five deletion-intersecting maintenance mutexes, Jobs login probe, TLS, database read-write
      state, and resource saturation before considering a retry.
- [ ] VR-DELETE-14: Treat any observed `running` job, unreviewed state transition, caller-selected
      backoff, or claimed automatic retry as unsupported and hand it to incident command.
- [ ] VR-DELETE-15: Diagnose terminal-job retention separately; cleanup cannot complete or repair a
      non-terminal primary purge and must not run early to erase evidence.
- [ ] VR-DELETE-16: Classify cache invalidation, backup expiry, tombstone policy, and stale-backup
      deletion replay as open external work; do not infer them from primary-database success.

Do not read or edit private tables interactively. Do not run raw SQL, `psql`, a Jobs package
command, or a scheduler entry point from this public runbook. The protected read-only oracle and
deployment controller must own target selection, fixed query/function choice, authentication, output
minimization, audit, deadlines, and cleanup.

## Retry the bounded purge

- [ ] VR-DELETE-17: Require a reviewed root-cause fix or documented transient cause, stable database
      health, clean immutable artifact, exact narrow Jobs authority, and incident-commander
      approval.
- [ ] VR-DELETE-18: Invoke the deployment-owned one-shot Jobs workflow once with its fixed primary
      purge command, maximum-ten server-selected batch, no profile/job selector, and no
      caller-chosen SQL, batch, cutoff, timeout, lock, or retry count.
- [ ] VR-DELETE-19: Permit only one active purge caller for the recovery attempt; do not overlap a
      manual workflow with the scheduler or another operator.
- [ ] VR-DELETE-20: Treat the generic process result as transport evidence only; require the
      protected aggregate database oracle before declaring a profile purged.

The retry is a new bounded call, not a resume of an application lease. A failed transaction leaves
the previously committed request lock-down and non-terminal job available for diagnosis; it does not
justify editing `attempt_count`, `available_at`, `last_error_code`, state, lease material, profile
state, or foreign-key rows. Do not loop, change credentials, widen role membership, extend timeouts,
drop constraints, delete mutexes, or switch to an owner session to make the call succeed.

## Verify and retain

- [ ] VR-DELETE-21: After a reported success, require one protected aggregate oracle to prove the
      exact profile is absent, its personal rows cannot be reached, and the matching job alone is
      profile-free, terminal `purged`, lease-free, error-free, and completed.
- [ ] VR-DELETE-22: Recheck runtime-role denials, forced RLS, maintenance mutexes, database/session
      cleanup, scheduler settlement, and absence of unexpected mutation outside the approved batch.
- [ ] VR-DELETE-23: Retain the opaque terminal job for at least the fixed 30-day server-time window;
      terminal cleanup remains a separate bounded Jobs action and never proves user-data deletion.
- [ ] VR-DELETE-24: Keep cache, backup, tombstone, restore-replay, notification, legal-retention,
      and monitoring gaps open with named owners and deadlines; do not call the broader deletion
      complete.

The current database has an unused tombstone table shape, but the request and purge intentionally do
not populate it. Follow the
[current-snapshot restore rehearsal boundary](CURRENT_SNAPSHOT_RESTORE_RUNBOOK.md): any archive that
may predate deletion remains outside supported recovery until a keyed marker authority, replay
procedure, destructive resurrection test, cache/credential invalidation, and disclosed retention
policy exist.

## Failure and incident handoff

- [ ] VR-DELETE-25: On any retry or verification mismatch, stop further attempts, keep authority and
      routing contained, settle Jobs, remove temporary authority, and hand the protected evidence to
      incident command.
- [ ] VR-DELETE-26: Close the rehearsal only after every temporary process/session/credential is
      gone, monitoring is stable, affected authority remains closed or deletion is exactly verified,
      and every residual risk has an owner and deadline.

There is no repository-owned user-notification system or private support channel. The communication
owner must use an approved external process without exposing whether an account, handle, job, or
incident exists. A failed or delayed purge must never be hidden behind a successful-request message
or a terminal-cleanup count.

## Prohibited actions

- Do not run repository-owned local evidence against shared, staging, production, or real-user data.
- Do not disclose identifiers, digests, exact counts, timestamps, errors, database rows,
  credentials, hostnames, certificates, paths, or affected-user information.
- Do not use Web, Ingest, Admin, owner, superuser, or a widened Jobs identity for purge or
  diagnosis.
- Do not edit queue/profile state, timestamps, retry metadata, leases, foreign keys, constraints,
  mutexes, grants, RLS, batch size, cutoffs, timeouts, or migration history during recovery.
- Do not invoke terminal cleanup as a primary-purge retry or remove recent terminal evidence.
- Do not restore deleted data, re-enable authority, or rebuild a profile from audit/job material.
- Do not claim automatic retry, deployed cadence, monitoring, notification, cache/backup deletion,
  tombstone replay, resurrection protection, capacity, staging readiness, production readiness, or
  deployment from this local checked runbook.
