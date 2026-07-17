# ADR 0029: Bounded pairing retention cleanup

- Status: Accepted (database capability and local one-shot command implemented; scheduling pending)
- Date: 2026-07-16
- Decision owners: Web/Auth, Jobs, Database, Security, Privacy, and Operations
- Supersedes: None
- Superseded by: None

## Context

Pairing expiry already removes all approval and activation authority: reads require an unexpired
`pending` or `approved` transaction, and an activated device has a separate source-bound key state.
Expiry alone does not remove the transaction, its keyed poll/code verifiers, challenge, display
metadata, approval provenance, approval challenge, or otherwise authority-free pending public-key
row. Cancelled transactions are also terminal but were outside the original partial expiry index. An
exposed anonymous start flow could therefore grow Security and Account state indefinitely and leave
permanent uniqueness entries even after every secret became unusable.

ADR 0028 requires physical cleanup before external pairing start. The existing Jobs process can
invoke only fixed reviewed procedures and has no generic SQL boundary. This change must add the
smallest deletion capability without touching activated devices, source history, audit evidence, or
other expiring identity classes and without claiming a scheduler, public retention policy, or live
database login.

## Decision

Revision 0013 adds one owner-only maintenance mutex named `pairing_retention_cleanup` and extends
the existing pairing expiry index to `(expires_at, pairing_id)` for exactly `pending`, `approved`,
and `cancelled` transactions. The `activated` state is deliberately absent.

The new `cleanup_expired_pairing_state(integer)` function is executable only by `viberacing_jobs`.
It:

- accepts an exact batch from 1 through 1000;
- waits at most five seconds for its private mutex and captures `clock_timestamp()` only after that
  wait;
- selects at most one deterministic oldest-first batch whose transaction is expired, non-activated,
  and still references a source-free, device-free `pending` key;
- locks both rows with `FOR UPDATE ... SKIP LOCKED`, so an in-flight approval or activation keeps
  its pair for a later invocation instead of creating a cross-capability lock cycle;
- deletes the transaction first, allowing its pairing-bound approval challenges to cascade, then
  deletes exactly the now-unreferenced pending key; and
- returns only `deleted_pairings` and `deleted_pending_keys`, each bounded by the requested batch
  and required by the Jobs mapper to be equal.

Any missing mutex, invalid batch, changed-row mismatch, lock failure, or integrity failure produces
the existing generic operation failure and rolls back the complete invocation. Live pending rows,
activated transaction/key provenance, sources, profiles, sessions, passkeys, audit rows, and active
or revoked device keys are not cleanup candidates. Expired approval of a newly declared source does
not delete that source: source lifecycle is explicit Account state, and another device may already
reference it.

ADR 0014's one-shot Jobs boundary gains one command, `cleanup-expired-pairing-state`, which always
supplies the fixed maximum batch of 1000. The pool still has one client, verifies the same exact
Jobs login/role/search path on every checkout, chooses one fixed prepared function call, validates
one exact row, holds the client through settlement, and prints only the existing stable success or
failure sentence. There is no caller-selected procedure, batch, SQL, state, identifier, cutoff, or
result column.

## Security and privacy consequences

The cleanup removes expired keyed verifiers, challenge material, pending public keys, pending labels
and platform/version metadata, approval provenance, and pairing-bound challenges. It collects no new
field and adds only one non-personal fixed mutex row. Deleted counts remain transient process values
and are neither printed nor retained.

The state and key predicates are repeated after row selection. Deleting the transaction before the
key preserves the immediate foreign key; exact changed-row checks turn unexpected drift into a full
rollback. `SKIP LOCKED` means cleanup can make less than batch-size progress under contention, which
is preferable to racing a live security transition. The separate private mutex prevents two Jobs
workers from selecting overlapping batches.

Residual risk remains: there is no scheduler, cadence, retry/overlap policy, alert, capacity result,
live Jobs login/TLS connection, backup-expiry proof, or deployed retention policy. ADR 0032 now
covers expired authentication challenges and restricted recovery authorities; expired sessions,
jobs, passkey provenance, and tombstones still need separate bounded cleanup. Anonymous pairing
start also still needs an HTTP contract, browser approval, connector client, distributed
edge/service limits, monitoring, and real-key custody.

Affected invariants are VR-DEVICE-001, VR-DATA-001, and VR-ABUSE-001. Primary attacker stories are
VR-ABUSE-PAIRING-GUESS, VR-ABUSE-DATABASE-ROLE, and VR-ABUSE-RESOURCE-EXHAUSTION.

## Alternatives considered

- **Delete every expired pairing row:** rejected because activated rows are durable device-binding
  provenance and their keys carry live or explicitly revoked authority.
- **Delete only `pending` and `approved`:** rejected because lifecycle and credential-protection
  operations intentionally create terminal `cancelled` rows that would otherwise remain forever.
- **Delete newly declared sources with expired approvals:** rejected because a source is explicit
  profile Account state and can already have another pending, active, revoked, or historical use.
- **Use an advisory lock supplied by the caller:** rejected because runtime callers could select or
  starve a public lock key. The fixed owner-only mutex row is already the reviewed Jobs pattern.
- **Wait for every locked pairing:** rejected because activation and source lifecycle have their own
  lock orders. Skipping a contended row keeps cleanup bounded and lets a later invocation
  re-evaluate the final state.
- **Expose batch size on the CLI:** rejected because the database maximum is the only reviewed local
  one-shot command and removes an operational tuning input.
- **Fold pairing deletion into ingest cleanup:** rejected because the state classes, lock graph,
  result contract, cadence, and incident controls are independent.

## Migration and rollback

Revision 0013 is forward-only and runs in one transaction under the migration advisory lock, the
non-login owner, a five-second migration lock timeout, and a 30-second statement timeout. It extends
the full existing maintenance-mutex enum, replaces the partial index, creates and grants one
function, and records its immutable manifest digest.

Before a shared environment, rollback discards and rebuilds the disposable database and removes the
local command together. After release, repair requires another reviewed forward migration; do not
edit revision 0013. Disabling the command or future scheduler does not restore deleted expired
secrets, and rollback must not widen Jobs table access or substitute owner SQL.

## Verification

Acceptance evidence recorded for this decision included:

- static migration/checksum validation across 23 immutable revisions;
- real PostgreSQL scenarios for oldest-first bounds, `pending`/`approved`/`cancelled` deletion,
  approval-challenge cascade, idempotency, live-pending and activated-row preservation, invalid
  batches, missing mutex, exact role grants, and the expanded partial index;
- an observed two-connection Jobs race in which the second cleanup waits on the first private mutex,
  both one-row batches settle, and live pending state remains;
- the complete isolated PostgreSQL suite with 25 tables, 25 observed lock-wait races, 12 relation
  denials, and 34 cross-capability checks; and
- 120 focused Jobs tests, including the pairing cleanup command/query/result path, plus strict lint
  and type checking.

The SQL evidence uses only synthetic rows in a portless ephemeral PostgreSQL project. Jobs tests use
an injected pool. They do not prove a Node-to-PostgreSQL login, scheduler, production retention
cadence, capacity, monitoring, backup purge, anonymous route, or deployment.

## References

- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
- [Database capability boundary](../../database/README.md)
- [Jobs boundary](../../apps/jobs/README.md)
- [Identity step-up and device authority](0003-identity-step-up-and-device-authority.md)
- [Bounded Community maintenance runner](0014-bounded-community-maintenance-job-runner.md)
- [Bounded pairing start composition](0028-bounded-pairing-start-composition.md)
- [Bounded authentication retention cleanup](0032-bounded-auth-retention-cleanup.md)
