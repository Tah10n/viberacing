# Staging migration and forward-recovery runbook

## Scope and evidence boundary

**Clean-slate transition hold.**
[ADR 0076](../decisions/0076-clean-agent-account-provider-reported-token-ranking.md) supersedes the
unreleased 43-revision catalog. No production database or user population exists, so that catalog is
design evidence only and must not be promoted, backfilled, wrapped, or followed by revision 0044.
The clean bootstrap manifest, roles, restore evidence, and migration-runner tests have landed as
local synthetic evidence. They do not authorize staging execution. This runbook remains closed until
the protected prerequisites, exact change record, target, owners, and go/no-go decision below are
satisfied. A former old-schema integration result is historical baseline evidence, not permission to
preserve the old ledger.

This is the checked operator contract for applying the repository-owned PostgreSQL migration catalog
to an isolated staging environment. Migration files are authored, reviewed, hashed, and committed
before execution. Starting Web, Ingest, Jobs, or the local site does not apply migrations. Only the
separate default-off `@viberacing/migrate` process can apply the reviewed catalog.

The local checker proves that this document remains bound to the current commands, exact enablement
decision, generic success output, and forward-only policy. The disposable database tests prove
catalog integrity, restore reproducibility, least-privileged role admission, verified TLS,
controller serialization, and exact final state. They do not prove protected staging credentials,
deployment topology, service compatibility, monitoring, backup ownership, incident response, or
recovery. No production deployment is authorized by this document.

## Authority and prerequisites

The migration process uses one distinct NOINHERIT login that may set only the NOLOGIN
`viberacing_owner` role after the runner's closed probe. It must never use a Web, Ingest, Jobs,
Admin, owner-login, or superuser credential. Production-shaped staging requires a DNS database name,
certificate-verifying TLS, protected trust material, and the exact reviewed role bootstrap.

`VIBERACING_MIGRATIONS_ENABLED` must be the exact string `true` only in the one-shot deployment job.
Absent, false, malformed, and unreadable values remain disabled before catalog or protected
configuration access. Do not paste protected configuration into a shell command, transcript, issue,
or tracked file. The deployment controller injects it without echo, and the operator records only
redacted evidence in a protected change system.

Before execution, assign separate deployment, database, incident, and forward-recovery owners. The
same person may fill more than one role only when the private change approval explicitly permits it.
No name, account, hostname, certificate, secret reference, or incident detail belongs in this public
runbook.

## Preflight

- [ ] VR-MIG-01: Pin the exact reviewed commit and immutable build artifact in the protected change
      record.
- [ ] VR-MIG-02: Assign deployment, database, incident, and forward-recovery owners before the
      window opens.
- [ ] VR-MIG-03: Record the isolated staging target and prove the migration-controller replica count
      is exactly one.
- [ ] VR-MIG-04: Prove a current backup can restore into an isolated target and record its expiry
      privately.
- [ ] VR-MIG-05: Verify the candidate service matrix targets the exact clean-bootstrap schema and
      starts with every capability closed.
- [ ] VR-MIG-06: Verify the narrow login, owner membership, DNS name, trust material, and TLS policy
      privately.
- [ ] VR-MIG-07: Confirm protected monitoring and an append-only operator record are available
      before execution.
- [ ] VR-MIG-08: Record an explicit go or no-go decision after every local gate below succeeds.

The repository's checked synthetic prerequisite is documented in the
[isolated current-snapshot restore rehearsal runbook](CURRENT_SNAPSHOT_RESTORE_RUNBOOK.md). It
neither supplies a staging backup nor authorizes a shared, production, pre-deletion, or real-user
restore.

Run these repository-owned gates from a clean checkout of the pinned commit. The two PostgreSQL
integrations require their documented disposable Docker environment and remove it afterward.

```text
pnpm run check:migration-runbook
pnpm run check:database
pnpm run build:migrate
pnpm run check:migrate-entrypoint
pnpm run test:database:integration
pnpm run test:migrate:postgres-integration
```

A green local result is prerequisite evidence only. Any catalog, manifest, lockfile, generated
artifact, role-bootstrap, or command drift returns the change to review; operators do not repair it
inside the deployment window.

## Apply

- [ ] VR-MIG-09: Open the protected change record and confirm the pinned commit, target, owners, and
      window.
- [ ] VR-MIG-10: Inject the exact enable value and namespaced database configuration through the
      controller.
- [ ] VR-MIG-11: Start one argument-free migration process and retain only its bounded aggregate
      result.
- [ ] VR-MIG-12: Remove enablement after settlement and prove that no migration process or session
      remains.

The deployment controller runs the already-built package with no arguments. This package-manager
form is illustrative; local integration launches the emitted entry point directly, and a protected
deployment must use its reviewed immutable artifact rather than install during the change window.

```text
pnpm --filter @viberacing/migrate start
```

Success is exit code zero with exactly `Vibe Racing migrations completed.` on standard output and no
standard error. Disabled or failed output is not success. Do not loop, automatically retry, pass an
argument, start a raw SQL client, widen the login, or start a second controller after any failure.
The advisory lock contains accidental overlap; it is defense in depth, not permission for a
multi-controller rollout.

## Verify

- [ ] VR-MIG-13: Require the protected ledger oracle to equal the pinned contiguous manifest
      exactly.
- [ ] VR-MIG-14: Verify owner, forced-RLS, runtime-role, TLS, connection, and advisory-lock
      invariants.
- [ ] VR-MIG-15: Run the approved candidate-service smoke matrix before opening any traffic.

Verification uses deployment-owned read-only oracles and redacted aggregate results. It must not
print SQL bodies, database errors, identifiers, stored rows, credentials, certificate material, or
configuration. A process success sentence without the ledger, role, candidate-service compatibility,
and resource-cleanup checks is incomplete evidence.

## Forward recovery

- [ ] VR-MIG-16: On any failure, stop new controllers, preserve the protected record, and contain
      affected routes.
- [ ] VR-MIG-17: Classify the exact committed ledger prefix and approve either a service rollback or
      forward fix.
- [ ] VR-MIG-18: Re-run the complete verification matrix and hand off residual risk before closing
      the incident.

Every migration owns an atomic transaction, but an earlier migration may have committed before a
later catalog entry fails. Inspect the ledger only through the protected oracle. Never assume that a
nonzero process exit means no schema change.

Database recovery is forward-only after shared application. Preserve every applied file, digest, and
ledger row. Prefer disabling the affected capability and deploying a newly reviewed additive repair.
Roll back application code only when the recorded compatibility matrix proves that the committed
schema still supports it. A restore is an incident decision after the approved isolated restore
procedure, not a generic response to a migration error.

Stale-backup deletion replay is not implemented, so this runbook cannot authorize real-user
production restore or claim resurrection protection. If a staging restore would cross data or
authority boundaries that the current synthetic drill does not cover, stop and require a new
reviewed recovery design.

## Incident handoff

The protected incident record contains the pinned commit and artifact identity, redacted target,
controller count, owner assignments, timestamps, exit class, ledger prefix, invariant results,
service smoke result, containment decision, and forward-fix or application-rollback reference. It
must not contain a password, connection string, raw SQL error, stored row, certificate key, or user
data.

Public communication, if required, is a separately reviewed sanitized summary. Do not copy the
protected record into a public issue, pull request, chat, or repository artifact. The handoff stays
open until monitoring is stable, all temporary authority is removed, and every residual risk has an
owner and deadline.

## Prohibited actions

- After an intentional environment has been created from the final clean catalog, do not edit,
  reorder, remove, or replace an applied migration or its manifest digest. The one pre-release
  clean-slate replacement happens before such an environment exists and is verified by rebuilding
  only empty disposable databases.
- Do not add a down migration, generic destructive rollback, ledger rewrite, or manual schema
  repair.
- Do not run the migration catalog through a runtime service, interactive owner session, or
  superuser.
- Do not disable certificate verification, substitute a loopback exception, or accept an IP name in
  staging.
- Do not retry automatically, increase timeouts during an incident, or widen role membership to make
  progress.
- Do not expose protected configuration or private operational evidence in logs or public
  collaboration.
- Do not promote to production until separate staging evidence and a production-specific approval
  exist.
