# Capability containment and recovery rehearsal runbook

## Scope and evidence boundary

This is the checked operator prerequisite for containing one or more Vibe Racing capabilities after
a security, privacy, integrity, or reliability incident. It binds the ten repository-owned
default-off decisions to protected triage, process replacement, verification, and recovery of one
capability at a time. It is not a deployed control plane, dynamic kill switch, private reporting
channel, monitoring backend, incident exercise, or proof that an external service was contained.

The ten decisions are `VIBERACING_MIGRATIONS_ENABLED`, `VIBERACING_JOBS_SCHEDULER_ENABLED`,
`VIBERACING_INGEST_ENABLED`, `VIBERACING_USAGE_SYNC_ENABLED`, `VIBERACING_PUBLIC_RANKING_ENABLED`,
`VIBERACING_TOKEN_RANKING_ENABLED`, `VIBERACING_PAIRING_ENABLED`,
`VIBERACING_SOURCE_CREATION_ENABLED`, `VIBERACING_CAR_PROPOSALS_ENABLED`, and
`VIBERACING_ENROLLMENT_ENABLED`. Every decision admits only the exact string `true`; absence,
`false`, alternate case, another type, or unreadable state fails closed.

The local checker binds six Web decisions to 21 exact module-load points: three legacy
public-ranking, one direct-token-ranking, four pairing, three source-creation, four
CarRecipe-proposal, and six enrollment modules.

The tracked public environment keeps nine runtime decisions false and does not contain migration
enablement. Editing that file is never an incident action. A deployment-owned controller must change
protected environment state, replace or stop the affected processes, manage routing and caches, and
write only redacted evidence to a protected append-only record.

## Authority and prerequisites

Assign an incident commander plus separate security, service, data/deletion, and communications
owners before containment. The same person may fill more than one role only when the protected
incident policy explicitly permits it. No public issue, pull request, commit, chat, or local shell
history is the protected incident system.

Containment requires independently authenticated authority over deployment configuration, process
replacement, routing, cache invalidation, credential revocation, and target isolation. Repository
access or a passing local verifier grants none of that authority. Follow the private reporting
boundary in [SECURITY.md](../../SECURITY.md); private vulnerability reporting is not enabled or
verified in the current repository state.

## Preflight

- [ ] VR-CONTAIN-01: Pin the exact reviewed commit, immutable artifacts, deployed topology, and
      affected environment in the protected incident record.
- [ ] VR-CONTAIN-02: Assign incident commander, security, service, data/deletion, and communications
      owners before changing capability state.
- [ ] VR-CONTAIN-03: Classify affected capabilities, attacker persistence, user-data exposure,
      deletion risk, credential scope, and public impact using only minimized protected evidence.
- [ ] VR-CONTAIN-04: Prove the controller can replace or stop every affected process and can close
      its public and direct-origin routes without relying on application success.
- [ ] VR-CONTAIN-05: Confirm credential/key revocation, cache invalidation, database isolation, and
      rollback authority are available through separately reviewed protected workflows.
- [ ] VR-CONTAIN-06: Identify which returning login, recovery, logout, visibility, deletion,
      passkey, device, and source-security actions must remain reachable or receive a protected
      manual fallback.

Do not delay emergency edge or platform containment merely to run repository tests. If exploitation
is active, close external routing and revoke compromised authority first through the approved
controller, then collect local prerequisite evidence from a clean checkout.

## Local evidence

Run these repository-owned gates from a clean checkout of the pinned commit. They prove exact local
defaults, fail-closed resolver behavior, route/service tests, startup latches, and deterministic
verification only. They do not inspect, change, or observe deployed capability state.

```text
pnpm run check:containment-runbook
pnpm run check:config
pnpm run test:config-check
pnpm run test:web:coverage
pnpm run test:ingest-host:coverage
pnpm run test:jobs-scheduler:coverage
pnpm run test:migrate:coverage
pnpm run verify:release:node
```

A successful local result is prerequisite evidence only. It does not prove controller access,
process replacement, edge denial, cache purge, session invalidation, credential rotation,
monitoring, user notification, production containment, or recovery.

## Contain

- [ ] VR-CONTAIN-07: Freeze new releases and keep migration enablement absent before changing any
      runtime capability.
- [ ] VR-CONTAIN-08: Stop the Jobs scheduler when database integrity, deletion, scoring,
      finalization, retention, or privileged Jobs authority is in scope.
- [ ] VR-CONTAIN-09: Remove enablement for each affected capability through protected configuration;
      do not patch the application to invert, bypass, or merge independent decisions.
- [ ] VR-CONTAIN-10: Replace every affected Web worker because enrollment, pairing, source creation,
      CarRecipe proposals, legacy public ranking, and direct-token ranking resolve their decisions
      at module evaluation.
- [ ] VR-CONTAIN-11: Drain or stop every affected Ingest host before removing its startup
      enablement; changing environment state does not stop an already-running listener.
- [ ] VR-CONTAIN-12: Stop every affected scheduler or migration process; their startup latches do
      not revoke authority already held by a running process.
- [ ] VR-CONTAIN-13: Close public and direct-origin routing, invalidate relevant caches, and verify
      that no old enabled worker remains addressable before treating configuration as contained.
- [ ] VR-CONTAIN-14: Rotate or revoke a compromised credential, key, session, device, or artifact
      only through its separately approved workflow and verify that old authority is denied.

Source creation and CarRecipe proposal mutation remain independently containable from pairing.
Enrollment remains independently containable from returning login and recovery. Legacy public
ranking and direct-token ranking remain independently containable from each other; closing either is
not evidence that private data or ingestion is contained. Ingest, Jobs, and migrations require their
own process and database-session verification. Usage Sync remains independently containable from the
legacy Community sync route. Removing its protected value requires replacing both the Ingest host,
which resolves it at startup, and the Edge worker; it does not terminate an already-running process
or prove that an old route is unreachable.

## Preserve security and deletion paths

- [ ] VR-CONTAIN-15: Preserve returning login, recovery, logout, profile hide/delete, passkey
      revoke, device revoke, source pause/unlink, and proposal rejection unless that exact path is
      compromised.
- [ ] VR-CONTAIN-16: When a security or deletion path is compromised, close it narrowly, document a
      protected manual fallback, and prevent the broader Web surface from implying the action
      succeeded.
- [ ] VR-CONTAIN-17: Keep deletion-pending profiles hidden and ingestion authority revoked; do not
      re-enable a capability to repair backup, tombstone, cache, or deletion state.

The local gates are admission decisions, not notification, cache purge, backup replay, mass revoke,
or user-support systems. Those capabilities remain separate launch and incident-response gates.

## Verify containment

- [ ] VR-CONTAIN-18: Verify every affected route, listener, scheduler, migration process, database
      session, and old artifact through an external protected oracle rather than configuration state
      alone.
- [ ] VR-CONTAIN-19: Record only timestamps, pinned revisions/artifacts, capability names, coarse
      outcomes, opaque request references, and bounded aggregate counts needed for response.
- [ ] VR-CONTAIN-20: Exclude credentials, keys, cookies, raw requests, database rows/errors, exact
      usage, handles, device material, hostnames, private paths, and reporter or user data from
      public output and this repository.

Any reachable old worker, live privileged session, unexpected mutation, non-generic disabled
response, missing deletion protection, or evidence mismatch leaves containment failed and recovery
closed.

## Recover one capability at a time

- [ ] VR-CONTAIN-21: Require a reviewed root-cause fix, clean immutable artifact, restored protected
      dependencies, and explicit incident-commander approval before recovery.
- [ ] VR-CONTAIN-22: Recover only one capability in one environment at a time through a new process,
      then verify routing, caches, authorization, data invariants, and monitoring before continuing.
- [ ] VR-CONTAIN-23: Return immediately to containment on any mismatch; do not widen another
      capability to make the failed one appear healthy.

Recovery must preserve independent decisions. Enabling pairing does not authorize source creation;
enabling account pages does not authorize enrollment or CarRecipe mutation; enabling public reads
does not authorize direct-token ranking or Ingest; enabling direct-token ranking does not authorize
legacy public ranking or Ingest; enabling Ingest does not authorize Usage Sync; enabling Jobs does
not authorize migrations. A local green build is not a go-live decision.

## Failure and incident handoff

- [ ] VR-CONTAIN-24: Keep failed capabilities and routes closed, remove temporary authority, assign
      every residual risk and follow-up, and retain only the protected redacted timeline before
      handing off or closing the incident.

Public communication, reporter coordination, legal notification, and user support require their own
authorized owners and sanitized review. Do not copy a protected record into the repository. The
incident remains open while any old artifact, route, session, credential, unexplained mutation,
deletion risk, or unowned follow-up remains.

## Prohibited actions

- Do not edit tracked configuration, application conditions, tests, or database grants as an
  emergency substitute for the deployment controller.
- Do not treat removal of an environment value as termination of a running process or replacement of
  a module-loaded Web decision.
- Do not disable the entire account/security surface when the affected capability has a narrower
  independent boundary.
- Do not start migrations, cleanup, scoring, finalization, restore, or deletion repair merely to
  test incident authority.
- Do not run raw database, cache, credential-store, key-rotation, or artifact-publication commands
  from this public runbook.
- Do not print or retain protected configuration, tokens, keys, cookies, request bodies, database
  content, user data, reporter details, hostnames, or private incident evidence.
- Do not claim a deployed dynamic kill switch, private reporting channel, monitoring, containment,
  recovery, staging readiness, production readiness, or deployment from this local rehearsal.
