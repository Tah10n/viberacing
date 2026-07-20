# ADR 0032: Bounded authentication retention cleanup

- Status: Accepted (local scheduler catalog; deployment pending)
- Date: 2026-07-17
- Decision owners: Web/Auth, Jobs, Database, Security, Privacy, and Operations
- Supersedes: None
- Superseded by: None

## Context

Authentication and recovery expiry already remove authority from unused, consumed, and terminal
rows. Every challenge consumer checks expiry and one-time state, and restricted recovery requires an
unexpired active authority. Expiry alone does not physically remove challenge digests, context and
credential provenance, terminal recovery authorities, or the already scrubbed used recovery-code row
that created an authority. Anonymous login and recovery attempts could therefore grow Security state
indefinitely even though old rows can no longer authorize an action.

The database already has separate Jobs-only cleanup for ingest and pairing state, and ADR 0014
forbids generic Jobs SQL. This slice needs the smallest bounded deletion capability for expired
authentication state without deleting live ceremonies, unused recovery codes, sessions, passkeys,
audit evidence, pairing/device provenance, or profile state. It must also preserve the established
recovery lock order and must not claim a scheduler, deployed retention policy, or production Jobs
login/TLS path.

## Decision

Revision 0023 adds one owner-only maintenance mutex named `auth_retention_cleanup`, replaces the two
partial expiry indexes with full `(expires_at, id)` indexes, and grants only `viberacing_jobs` the
new `cleanup_expired_auth_state(integer)` function.

One invocation:

- accepts an exact batch from 1 through 1000 and captures server time only after its private mutex;
- deletes at most that many expired authentication challenges, ordered by expiry and ID, regardless
  of whether each row is unused or consumed;
- independently selects at most that many expired restricted recovery authorities;
- locks every selected authority's profile in stable ID order before locking authority or recovery-
  code rows, matching recovery start, rotation, completion, and profile-deletion serialization;
- skips child rows involved in another transition and rechecks immutable binding plus expiry before
  deletion;
- deletes each selected authority and, when still present, only its exact used recovery-code row
  whose verifier was already scrubbed; and
- returns only `deleted_challenges`, `deleted_recovery_authorities`, and
  `deleted_used_recovery_codes`.

The challenge and authority classes are independently batch-bounded so a large backlog in one does
not prevent progress in the other. A used code may already have been removed by recovery rotation or
completion, so its count may be lower than the authority count but can never exceed it. Live
challenges and authorities, unused codes with verifier material, profiles, sessions, passkeys,
sources, devices, pairings, deletion state, and audit rows are never candidates.

Any missing mutex, invalid batch, lock timeout, integrity failure, changed binding, or closed result
shape produces the existing generic failure and rolls back the invocation. The full expiry indexes
make physical deletion deterministic for consumed and terminal rows; authorization still depends on
exact primary-key/digest predicates and expiry checks.

ADR 0014's one-shot Jobs boundary gains `cleanup-expired-auth-state`, always with the fixed maximum
batch of 1000. The same one-client pool, per-checkout login/role/search-path probe, fixed prepared
query, exact one-row result mapper, destructive release on failure, and non-reflective CLI output
remain unchanged. No caller chooses SQL, cutoff, state, identifier, result column, or batch size.

## Security and privacy consequences

Physical cleanup reduces retained challenge, context, credential-provenance, keyed recovery-
authority, and used-code identifiers after their authority has expired. It collects no new user
field and adds only one fixed non-personal mutex row. Returned counts are transient, not printed,
logged, cached, exported, or stored.

The profile-first child-lock order closes the authority-to-code versus code-to-authority deadlock
path with concurrent recovery start or rotation. `SKIP LOCKED` may make less than maximum progress
under a live child transition; a later invocation re-evaluates the row. The private mutex prevents
overlap between cleanup workers, while profile locks serialize cleanup with recovery and deletion
without granting Jobs any direct table access.

Residual risk remains: ADR 0063 supplies a default-off in-memory local catalog, sequential
execution, no-overlap lifecycle, fixed-clock core composition, directly injected repeated-timer
execution and lifecycle settlement, real-clock emitted-process terminal-marker evidence, and later
native-timer plus OS-signal settlement paths. Those later paths prove one local recurring callback,
not controller settlement in the separately forcibly ended startup child, deployed OS-signal routing
or orchestrator grace, deployed cadence, durable missed-slot recovery, monitoring, capacity result,
production Jobs login/TLS connection, backup-expiry proof, or deployed retention policy. ADR 0042
now covers eligible expired sessions, ADR 0045 covers terminal deletion jobs, and ADR 0048 covers
aged unreferenced revoked passkeys; pairing-referenced session provenance, tombstones, referenced
passkey provenance, and any future expiring class still require separate reviewed rules. ADR 0050
now separately covers fixed pairing-rate-window reset. Recovery also still needs distributed attempt
controls and deployment-owned pepper/timing evidence.

Affected invariants are VR-AUTH-001, VR-AUTH-002, VR-AUTH-003, VR-DATA-001, and VR-DELETE-001.
Primary attacker stories are VR-ABUSE-AUTH-TAKEOVER, VR-ABUSE-RECOVERY-ORACLE,
VR-ABUSE-DATABASE-ROLE, VR-ABUSE-DELETE-RESURRECTION, and VR-ABUSE-RESOURCE-EXHAUSTION.

## Alternatives considered

- **Delete every terminal authentication row:** rejected because terminal state and expiry are
  separate; a recently consumed challenge can still be required for atomic action provenance until
  its short expiry ends.
- **Delete all recovery codes for an expired authority:** rejected because unused codes remain
  independent one-time recovery credentials. Cleanup may remove only the exact already used and
  scrubbed source row.
- **Lock authorities before codes:** rejected because recovery start locks the profile and code
  before revoking old authorities, creating an avoidable cross-capability deadlock graph.
- **Skip profile locks and rely on expiry predicates:** rejected because row predicates prevent
  stale authorization but do not establish a safe order against recovery rotation, completion, or
  profile deletion.
- **Combine authentication cleanup with pairing or ingest cleanup:** rejected because the data
  classes, lock graph, cadence, result contract, and incident controls are independent.
- **Expose a cutoff or batch on the CLI:** rejected because PostgreSQL server time and the reviewed
  maximum are authoritative and remove operator-controlled deletion scope.

## Migration and rollback

Revision 0023 is forward-only and runs in one transaction under the migration advisory lock, the
non-login owner, a five-second migration lock timeout, and a 30-second statement timeout. It extends
the closed maintenance-mutex enum, replaces two indexes, creates and grants one function, and
records its immutable manifest digest.

Before a shared environment, rollback discards and rebuilds the disposable database and removes the
local command. After release, repair requires another reviewed forward migration; do not edit
revision 0023. Stopping a future schedule cannot restore expired rows already deleted, and rollback
must not widen Jobs table access or substitute owner SQL.

## Verification

Acceptance evidence recorded for this decision included:

- static migration/checksum validation across 23 immutable revisions;
- real PostgreSQL scenarios for independent batch bounds, unused/consumed challenge deletion,
  active/revoked authority deletion, idempotency, live-state and unused-code preservation, invalid
  batches, missing mutex, full expiry indexes, and exact role grants;
- an observed two-worker race in which separate one-row batches serialize and preserve live state;
- an observed recovery-start versus cleanup race proving both contenders wait on the profile order,
  the old expired authority/code are deleted, and the new live authority remains;
- the complete isolated PostgreSQL suite with 25 tables, 25 observed lock-wait races, 12 relation
  denials, and 34 cross-capability checks; and
- 120 focused Jobs tests with 100% statement, branch, function, and line coverage plus strict lint,
  type checking, and production build.

The SQL evidence uses synthetic rows in a portless ephemeral PostgreSQL project. Focused Jobs tests
use an injected pool; the shared opt-in Jobs integration additionally proves this emitted command
through one disposable narrow login, generic output, and exact stored state. ADR 0063 separately
proves the default-off scheduler against a fake runner and clock, composes its production core with
the real runner and disposable PostgreSQL under fixed injected UTC time, and directly invokes the
production interval handler for a repeated fixed-clock cycle and the lifecycle handler after an
active runner call starts. Later ADR 0063 native-timer and OS-signal gates prove one local recurring
callback and graceful settlement, but these layers still do not prove controller settlement in the
separately forcibly ended startup child, deployed signal routing or orchestrator grace, production
cadence/login/TLS, monitoring, backup purge, capacity, or deployment.

## References

- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
- [Database capability boundary](../../database/README.md)
- [Jobs boundary](../../apps/jobs/README.md)
- [Restricted recovery authority](0007-restricted-recovery-authority.md)
- [Bounded Community maintenance runner](0014-bounded-community-maintenance-job-runner.md)
- [Bounded pairing retention cleanup](0029-bounded-pairing-retention-cleanup.md)
- [Bounded revoked-passkey retention cleanup](0048-bounded-revoked-passkey-retention-cleanup.md)
