# Isolated current-snapshot restore rehearsal runbook

## Scope and evidence boundary

This is the checked operator contract for rehearsing restoration of one current synthetic snapshot
into an isolated staging-shaped target. The repository-owned integration creates bounded archives
only inside its disposable PostgreSQL container, replaces only that run's database twice, verifies
the exact clean bootstrap ledger, AgentAccount/accounting state, finalized immutable snapshot, and
security boundary after each restore, then removes the container, network, and storage. Starting
Web, Ingest, Jobs, the local site, or the migration process does not create or restore a backup.

No repository command restores a shared staging or production database. A deployment-owned backup
and restore controller, protected credentials, trust material, encrypted storage, retention policy,
monitoring, and incident record remain external prerequisites. No production or real-user restore is
authorized by this document.

The local integration proves reproducibility for its current synthetic state only. It does not prove
external backup creation, encryption, access policy, point-in-time recovery, cluster-role recovery,
representative scale, RPO/RTO, stale-backup deletion replay, or service resumption.

## Authority and prerequisites

Assign separate backup, restore, database, privacy/deletion, and incident owners before opening the
rehearsal. The same person may fill more than one role only when the protected change approval
explicitly permits it. The restore controller must use a deployment-owned least-privileged identity
whose target and archive selection are fixed by the approved change; it must not use a Web, Ingest,
Jobs, Admin, migration, application-owner, or interactive superuser credential.

Keep every hostname, account, certificate, archive locator, digest, encryption-key reference,
timestamp, and incident detail in the protected change system. Do not paste a connection string,
password, trust material, archive content, database row, or raw database error into a shell command,
transcript, issue, pull request, chat, or tracked file.

The target must be isolated from public routing and every runtime service. Its storage, network,
credentials, and restore authority must be disposable or explicitly quarantined after the rehearsal.
The protected plan must define who can destroy the target and how completion is proven.

## Preflight

- [ ] VR-RESTORE-01: Pin the exact reviewed commit, immutable service artifacts, and backup workflow
      identity in the protected change record.
- [ ] VR-RESTORE-02: Assign backup, restore, database, privacy/deletion, and incident owners before
      the rehearsal window opens.
- [ ] VR-RESTORE-03: Prove the target is isolated, receives no public traffic, and shares no runtime
      credential or storage with another environment.
- [ ] VR-RESTORE-04: Classify the selected archive as a current synthetic snapshot and record its
      creation, retention, encryption, and expiry evidence privately.
- [ ] VR-RESTORE-05: Prove the restore controller can select only the approved archive and exact
      empty target through protected configuration.
- [ ] VR-RESTORE-06: Verify the pinned migration ledger, service compatibility matrix, database
      version, DNS name, trust material, and TLS policy privately.
- [ ] VR-RESTORE-07: Confirm protected monitoring, an append-only operator record, containment, and
      target-destruction authority are available before execution.
- [ ] VR-RESTORE-08: Record an explicit go or no-go decision after every repository-owned local gate
      below succeeds.

Any archive that may contain real-user state, may predate a deletion, or cannot be classified from
protected evidence is outside this rehearsal. Stop before target creation; do not infer safety from
an archive filename, age, successful decrypt, or successful database-tool exit.

## Local evidence

Run these repository-owned gates from a clean checkout of the pinned commit. The integration owns a
uniquely named Compose project, publishes no host port, uses only its `postgres-test` service and
`tmpfs` storage, and removes the complete project afterward.

```text
pnpm run check:restore-runbook
pnpm run test:database-check
pnpm run check:database
pnpm run test:database:integration
```

The local archive budget is 64 MiB and each canonical schema or data buffer is bounded to 32 MiB.
The current oracle requires the exact seven-row clean migration ledger, all 35 private tables with
forced RLS, three bounded archives and two current-snapshot restores, SHA-256/length-identical
canonical data, a byte-stable canonical restored schema, the same finalized snapshot identity and
payload after both restores, and the complete identity/auth/provider/grant/legacy-object semantic
oracle after each restore. Dump content is never emitted; bounded buffers are overwritten after
hashing.

A successful local result is prerequisite evidence only. It does not select, decrypt, copy, or
restore any deployment archive and does not authorize a staging or production action.

## Isolate and restore

- [ ] VR-RESTORE-09: Open the protected change record and reconfirm the pinned archive, empty
      target, owners, controller identity, and window.
- [ ] VR-RESTORE-10: Hold public routing and every Web, Ingest, Jobs, scheduler, and migration
      process disabled for the isolated target.
- [ ] VR-RESTORE-11: Invoke the reviewed deployment-owned restore workflow once with no interactive
      archive, database, role, SQL, or filesystem override.
- [ ] VR-RESTORE-12: Keep the restored target isolated and prevent automatic migration, job,
      application, or traffic startup after database-tool settlement.
- [ ] VR-RESTORE-13: Remove restore authority after settlement and prove no controller, database
      session, temporary credential, or untracked archive copy remains.

Do not run raw `pg_dump`, `pg_restore`, a database-drop client, or `psql` from this public runbook.
Their exact deployment flags, authentication, encryption, storage, audit, and cleanup policy must
belong to the reviewed protected controller. A zero exit from that controller is not sufficient
verification.

## Verify

- [ ] VR-RESTORE-14: Require the protected ledger oracle to equal the pinned contiguous migration
      manifest exactly before any service smoke.
- [ ] VR-RESTORE-15: Verify database ownership, forced RLS, runtime-role grants and denials, TLS,
      connection cleanup, and absence of unexpected schemas or extensions.
- [ ] VR-RESTORE-16: Compare protected canonical schema and data digest/length oracles with the
      approved source without exposing either dump.
- [ ] VR-RESTORE-17: Run the approved candidate and deployed-service read/write denial matrix while
      routing remains closed.
- [ ] VR-RESTORE-18: Record actual duration and residual risk without claiming an RPO, RTO,
      capacity, or recovery objective that this rehearsal did not prove.

The verification record contains only redacted aggregate results. It must not retain a dump,
connection string, raw SQL, database error, row, identifier, key, certificate material, hostname, or
user data. Any mismatch leaves the target quarantined and the rehearsal failed.

## Stale-backup and deletion boundary

Stale-backup deletion replay is not implemented. The current database contains an unused table shape
for future keyed deletion tombstones, but the deletion request and purge deliberately do not invent
an unkeyed marker. The local restore drill has no pre-deletion archive or external marker source and
therefore cannot prove that a deleted profile remains deleted after restoring older state.

- [ ] VR-RESTORE-19: Stop before service startup whenever the archive could predate a profile
      deletion or the protected deletion-marker oracle is absent, incomplete, or unverified.

Do not delete an expired tombstone, shorten backup retention, or treat current-snapshot equality as
resurrection protection. A future stale-backup exercise requires a separately reviewed keyed marker
authority, replay procedure, cache and credential invalidation, privacy-map update, and destructive
test proving that deleted identity, session, passkey, installation, device, AgentAccount, and public
state do not return.

## Failure and incident handoff

- [ ] VR-RESTORE-20: On any failure, keep routing closed, quarantine or destroy the restored target,
      remove temporary authority, and hand the protected record to the assigned incident owner.

Do not retry automatically or switch archives, targets, credentials, flags, timeouts, or database
versions inside the rehearsal window. Preserve only the protected aggregate evidence needed to
classify the failure. If a protected value or dump may have escaped its boundary, stop normal
cleanup, follow the approved credential/key and incident process, and do not copy details into a
public issue.

The handoff remains open until the restored target is destroyed or explicitly retained in isolation,
all temporary authority is removed, monitoring is stable, and every residual risk has an owner and
deadline. Public communication, if required, is a separately reviewed sanitized summary.

## Prohibited actions

- Do not point repository-owned local commands at a shared, staging, or production database.
- Do not restore real-user data until stale-backup deletion replay and the production privacy policy
  are implemented and independently verified.
- Do not make the restored target routable before every ledger, RLS, grant, denial, compatibility,
  deletion, and resource-cleanup oracle passes.
- Do not substitute an interactive owner or superuser session for the reviewed restore controller.
- Do not disable certificate verification, accept an IP name, reuse a runtime credential, or widen
  role membership to make progress.
- Do not print, export, retain, or publish an archive, canonical dump, protected digest, credential,
  database error, row, hostname, or incident detail.
- Do not claim backup durability, encryption, RPO/RTO, deletion replay, recovery, staging readiness,
  production readiness, or deployment from this local synthetic rehearsal.
