# Profile deletion failure rehearsal runbook

This checked public runbook covers one narrow incident class: a profile-deletion request or the
bounded primary purge did not reach its expected clean-slate state. It preserves the immediate
authority lock-down, separates snapshot blocking from other purge failures and terminal-job
retention, and permits only one reviewed deployment-owned recovery attempt after the cause is
understood.

It is prerequisite guidance, not an executable deployment workflow. It does not inspect or change a
shared database, create monitoring, send notification, schedule Jobs, invalidate a cache, expire a
backup, replay a deletion marker, or prove that a real profile was deleted. Environment names,
identifiers, timestamps, counts, database state, errors, credentials, and incident details stay in
the protected incident system.

## Scope and evidence boundary

The request transaction requires an authenticated session, exact typed handle, and consumed fresh
passkey challenge. On success, the profile transition trigger hides the profile and fixes its
deletion-request time. The same transaction expires pending or approved pairing, revokes active
device keys and connector installations, unlinks AgentAccounts, revokes active sessions and
passkeys, revokes any active recovery authority, and creates one `pending` profile-deletion job.
Unused recovery codes cannot start recovery after the profile leaves `active`; profile deletion
later removes profile-owned authentication rows through their reviewed foreign keys. The HTTP
boundary returns 204 and clears every authentication, recovery, AgentAccount, device, installation,
and session cookie only after the transaction reports success.

The request transaction does not physically purge profile data. Neither the HTTP request nor Web
startup runs the physical purge.

The Jobs-only primary purge selects at most ten oldest `pending` jobs whose profiles remain
`deletion_pending`. The purge refuses a profile while its handle remains in a published snapshot for
a non-finalized season. This keeps a live public response from retaining the handle after the
private profile disappears; the checked scheduler orders snapshot refresh before purge. For an
eligible candidate, one transaction removes profile-attributed ranking, usage, pairing, invite, and
profile state, verifies the profile delete changed exactly one row, then changes the protected job
to `completed` with a server-computed 30-day retention deadline. Web, Ingest, and Admin have no
execution grant for the primary purge or terminal cleanup.

The separate terminal cleanup can delete only a `completed` job after its server-computed retention
expiry; it is retention cleanup, not a purge retry or completion oracle. The retained terminal row
still contains the opaque profile UUID and must remain protected personal data until cleanup.

The deletion job has only `pending` and `completed` states; it has no lease, attempt counter, error
field, caller-selected cutoff, or per-job backoff. An enabled local scheduler can scan a still
pending job on a later hourly cycle, but its cadence and slot state exist only in one process. Do
not describe that as durable missed-slot recovery, an individually controlled retry, deployed
cadence, or monitoring.

## Roles and protected record

Assign incident command, privacy/deletion, Web/Auth, Jobs, database, security, and
user-communication owners in a protected record before touching a shared environment. A person may
fill multiple roles only when the incident commander records that decision. Database and Jobs
operators use only environment-owned, least-privileged identities through reviewed controllers; they
never substitute an interactive owner, superuser, Web, Ingest, Admin, or widened Jobs login.

Keep the affected environment, profile/job references, times, aggregate state, query/result details,
database errors, hostnames, certificates, and credentials out of this repository, public issues,
pull requests, chat, and shell history. Public communication, if required, is a separately reviewed
sanitized summary.

## Preflight

- [ ] VR-DELETE-01: Assign incident, privacy/deletion, Web/Auth, Jobs, database, security, and
      communication owners in the protected record.
- [ ] VR-DELETE-02: Pin the exact reviewed commit, immutable service artifacts, seven-revision
      migration ledger, affected environment, and deployment-owned controllers privately.
- [ ] VR-DELETE-03: Classify the symptom as request failure, snapshot-blocked primary purge, other
      primary-purge failure, terminal-job cleanup failure, or cache/backup/restore risk; do not
      merge those states.
- [ ] VR-DELETE-04: Preserve redacted aggregate evidence and the original immutable artifacts before
      restart, retry, or repair.
- [ ] VR-DELETE-05: Prove protected routing, process settlement, database health, least privilege,
      verified TLS, and monitoring prerequisites exist; otherwise keep the incident contained.
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

The checked source bindings and disposable-database oracle cover the profile transition, exact
authority lock-down, pending-job trigger, maximum-ten batch, non-finalized published-snapshot block,
atomic profile/job settlement, 30-day terminal retention, forced RLS, and narrow Jobs grants. Web
tests cover the successful no-store 204 boundary and cookie clearing. Jobs tests cover the exact
commands, fixed batch sizes, adapter calls, and scheduler order. The Jobs PostgreSQL integration
invokes both commands through one disposable least-privileged login.

This remains local synthetic evidence. It proves no deployed process, protected oracle, alert,
durable retry controller, production credential/TLS path, representative capacity, user
notification, cache or backup deletion, stale-backup replay, or real-user outcome.

## Classify and contain

- [ ] VR-DELETE-07: Treat an absent successful request result as unknown lock-down; do not claim the
      profile or authority changed until the protected atomic request oracle confirms it.
- [ ] VR-DELETE-08: For a confirmed request, require one aggregate oracle to confirm
      `deletion_pending`, hidden public state, revoked sessions/passkeys/recovery authority/device
      keys/installations, unlinked AgentAccounts, expired pairing, and one `pending` deletion job
      without exposing row data.
- [ ] VR-DELETE-09: Preserve that lock-down throughout the incident; never unhide, reactivate,
      relink, recreate recovery authority, mint a session, or issue a replacement credential.
- [ ] VR-DELETE-10: If request lock-down is absent or inconsistent, use the checked
      capability-containment runbook and deployment controls to prevent affected authority or public
      state from being used while the root cause is investigated.
- [ ] VR-DELETE-11: Stop new scheduler cycles and settle the active Jobs call through the reviewed
      deployment controller when corruption, repeated failure, role drift, or uncertain state could
      make another purge unsafe.

Changing a local environment file does not stop a running Web or Jobs process. The checked
[capability-containment runbook](CAPABILITY_CONTAINMENT_RUNBOOK.md) preserves profile deletion and
other defensive actions by default, but a deletion incident can require the deployment controller to
close broader routing or settle Jobs. Do not invent an individual deletion kill switch.

## Diagnose without mutation

- [ ] VR-DELETE-12: Use a protected read-only aggregate oracle to distinguish `pending`,
      snapshot-blocked, `completed`, missing, and malformed state without returning a profile,
      handle, UUID, digest, timestamp, or row.
- [ ] VR-DELETE-13: Verify the seven-row ledger, exact function ownership/grants, forced RLS,
      `profile_purge` and `deletion_job_cleanup` mutexes, published-snapshot state, Jobs login
      probe, TLS, database read-write state, and resource saturation before considering a retry.
- [ ] VR-DELETE-14: Treat any observed third deletion-job state, per-job lease/backoff metadata,
      caller-selected cutoff, or claimed durable automatic retry as unsupported and hand it to
      incident command.
- [ ] VR-DELETE-15: Diagnose terminal-job retention separately; cleanup cannot complete or repair a
      `pending` primary purge and must not run early to erase evidence.
- [ ] VR-DELETE-16: Classify cache invalidation, backup expiry, deletion-marker policy, and
      stale-backup replay as open external work; do not infer them from primary-database success.

Do not read or edit private tables interactively. Do not run raw SQL, `psql`, a Jobs package
command, or a scheduler entry point from this public runbook. The protected read-only oracle and
deployment controller must own target selection, fixed query/function choice, authentication, output
minimization, audit, deadlines, and cleanup.

Snapshot-blocked is a safe non-purge result, not permission to delete or edit snapshot rows. Verify
that the current published response no longer contains the hidden handle through the reviewed
refresh path, then let the next explicitly approved bounded purge rescan server-selected jobs.

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

The retry is a new bounded scan of server-selected pending jobs, not a resume of an application
lease. A failed purge transaction leaves the previously committed request lock-down and `pending`
job available for diagnosis. Do not loop, edit the job or profile, change credentials, widen role
membership, extend timeouts, remove a published pointer, drop constraints, delete mutexes, or switch
to an owner session to make the call succeed.

## Verify and retain

- [ ] VR-DELETE-21: After a reported success, require one protected aggregate oracle to prove the
      exact profile and reachable personal rows are absent and the matching protected job alone is
      terminal `completed` with the exact 30-day retention deadline.
- [ ] VR-DELETE-22: Recheck runtime-role denials, forced RLS, both deletion mutexes,
      published-snapshot consistency, database/session cleanup, scheduler settlement, and absence of
      unexpected mutation outside the approved batch.
- [ ] VR-DELETE-23: Retain the protected terminal UUID row until its fixed 30-day server-time
      deadline; terminal cleanup remains a separate bounded Jobs action and never proves user-data
      deletion.
- [ ] VR-DELETE-24: Keep cache, backup, deletion-marker, restore-replay, notification,
      legal-retention, and monitoring gaps open with named owners and deadlines; do not call the
      broader deletion complete.

Follow the [current-snapshot restore rehearsal boundary](CURRENT_SNAPSHOT_RESTORE_RUNBOOK.md): the
local current-snapshot round trip proves database consistency only. Any archive that may predate
deletion remains outside supported recovery until a keyed deletion-marker authority, replay
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
- Do not edit job/profile state, timestamps, snapshots, foreign keys, constraints, mutexes, grants,
  RLS, batch size, cutoffs, timeouts, or migration history during recovery.
- Do not invoke terminal cleanup as a primary-purge retry or remove recent terminal evidence.
- Do not restore deleted data, re-enable authority, or rebuild a profile from audit/job material.
- Do not claim automatic durable retry, deployed cadence, monitoring, notification, cache/backup
  deletion, deletion-marker replay, resurrection protection, capacity, staging readiness, production
  readiness, or deployment from this local checked runbook.
