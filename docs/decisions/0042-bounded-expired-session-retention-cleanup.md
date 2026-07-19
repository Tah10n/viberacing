# ADR 0042: Bounded expired-session retention cleanup

- Status: Accepted (database capability and local one-shot command implemented; scheduling pending)
- Date: 2026-07-18
- Decision owners: Web/Auth, Jobs, Database, Security, Privacy, and Operations
- Supersedes: None
- Superseded by: None

## Context

Browser-session expiry already ends authority because every authentication procedure requires an
exact active verifier whose `expires_at` is not in the past. Expiry alone does not remove the stored
verifier digest, passkey provenance, rotation link, pairing-attempt window, or session-bound
challenge rows. Repeated enrollment, login, and rotation could therefore retain Security state long
after it can authorize a request.

Physical deletion is not a simple expiry query. A rotated predecessor deliberately references its
replacement with `ON DELETE RESTRICT`, approved pairing transactions retain the exact approving
session as immutable security provenance, and session deletion cascades its bound authentication
challenges. The existing authentication cleanup and primary profile purge already serialize through
the private `auth_retention_cleanup` mutex. This slice must make bounded progress without weakening
those references, racing a live transition, or claiming a complete device-history policy.

## Decision

Revision 0030 replaces the active-only session expiry index with a full `(expires_at, session_id)`
index and adds a supporting partial index for non-null pairing approval session references. It
grants only `viberacing_jobs` the new `cleanup_expired_sessions(integer)` function.

One invocation:

- accepts an exact batch from 1 through 1000 and captures server time only after locking the
  existing private `auth_retention_cleanup` mutex;
- repeatedly selects the oldest expired session that is not the replacement target of another
  retained session and is not referenced by pairing approval provenance;
- locks the candidate with `FOR UPDATE SKIP LOCKED`, so an in-flight authentication or rotation
  transition settles without cleanup waiting beyond its fixed database deadline;
- repeats the expiry, rotation-reference, and pairing-reference predicates in the exact delete;
- cascades only challenges bound to the deleted session, because that session can no longer
  authorize their consumption;
- re-evaluates the candidate set after each delete so one call can remove a predecessor and then its
  now-unreferenced expired replacement while counting both against the same batch; and
- returns only `deleted_sessions`.

The function does not delete or mutate a live session, pairing, passkey, profile, source, device,
recovery row, audit event, or maintenance row. A pairing-referenced session remains retained even
after expiry. Non-activated pairing cleanup can later remove its own expired transaction, after
which a later session-cleanup call may delete the session. Activated pairing provenance remains
until a separate reviewed device-history retention policy permits a narrower representation or
deletion.

ADR 0047 supplies that narrower representation for the two exact approval references only: after at
least 180 days it may redact the session/passkey links while preserving the activated
profile/source/device binding and the pairing, device, and passkey rows. A later invocation of this
session cleanup can then remove an otherwise eligible expired session.

ADR 0014's local runner gains the exact `cleanup-expired-sessions` command. It always supplies the
fixed batch of 1000, probes the same least-privileged Jobs login and search path, issues one fixed
parameterized call, validates one exact count row, holds the client through settlement, destroys it
on failure, and emits only the existing generic completion or failure sentence. No caller selects a
cutoff, state, session, pairing, SQL fragment, result column, or batch size.

## Security and privacy consequences

Eligible deletion removes expired session-verifier digests, exact session/passkey bindings,
pairing-attempt counters, rotation links, and now-unusable session challenges. It adds no collected
field, identifier, log, cache, export, browser value, dependency, role, or new maintenance mutex.
The returned count remains transient and is never printed or retained by the local runner.

Sharing the authentication mutex prevents session challenge cascades from overlapping authentication
cleanup and preserves the existing profile-purge lock order. Candidate row locks protect against
concurrent possession, rotation, revoke, passkey, and deletion work. Retaining referenced rows is a
deliberate fail-closed tradeoff: cleanup does not erase immutable evidence merely to make a storage
claim, but those verifier digests and identifiers remain stored until the related history policy is
implemented or the profile is purged.

Residual risk remains: there is no scheduler, cadence, overlap/retry policy, monitoring, capacity
result, production Jobs login/TLS connection, backup-expiry proof, or deployed retention policy.
Recent activated pairing-referenced sessions, tombstones, historical pairing/passkey/device rows,
and fixed pairing-rate windows still need separate reviewed retention or reset evidence. ADR 0045
separately bounds terminal deletion-job retention; ADR 0047 bounds the exact approval references
after 180 days without deleting device history.

Affected invariants are VR-AUTH-001, VR-AUTH-002, VR-DATA-001, and VR-DELETE-001. Primary attacker
stories are VR-ABUSE-AUTH-TAKEOVER, VR-ABUSE-DATABASE-ROLE, VR-ABUSE-DELETE-RESURRECTION, and
VR-ABUSE-RESOURCE-EXHAUSTION.

## Alternatives considered

- **Delete every expired session in one statement:** rejected because a replacement target or
  pairing approval reference would either abort the whole batch or require weakening deliberate
  `RESTRICT` provenance.
- **Null pairing approval references during cleanup:** rejected because approval session/passkey
  binding is immutable and a device-history retention decision has not established what evidence may
  be discarded.
- **Delete a replacement before its rotated predecessor:** rejected because the predecessor is the
  retained proof of rotation and intentionally restricts that order.
- **Add another maintenance mutex:** rejected because session deletion cascades authentication
  challenges and must already serialize with authentication cleanup and profile purge.
- **Fold session deletion into `cleanup_expired_auth_state`:** rejected because changing that
  function's fixed return type would break the reviewed database/adapter contract and obscure the
  independent session batch.
- **Expose a cutoff, state, or batch on the CLI:** rejected because PostgreSQL server time and the
  fixed reviewed maximum are authoritative and prevent operator-selected deletion scope.

## Migration and rollback

Revision 0030 is forward-only and runs in one transaction under the migration advisory lock, the
non-login owner, a five-second migration lock timeout, and a 30-second statement timeout. It
replaces one index, adds one supporting index, creates and grants one function, and records its
immutable manifest digest. It changes no row shape, foreign key, trigger, role membership, or
existing procedure signature.

Before a shared environment, rollback discards and rebuilds the disposable database and removes the
local command. After release, repair requires another reviewed forward migration; do not edit
revision 0030. Stopping a future schedule cannot restore deleted expired sessions or challenges, and
rollback must not detach pairing provenance or widen Jobs table access.

## Verification

Acceptance evidence recorded for this decision includes:

- static validation of 30 contiguous immutable migration revisions and the exact checksum ledger;
- real PostgreSQL scenarios for oldest-first bounds, active/revoked/rotated deletion, one-call
  rotation-chain progress, challenge cascade, idempotency, live-session and activated-pairing
  provenance preservation, invalid batches, missing mutex, supporting indexes, and exact role
  grants;
- an observed two-worker race in which the second session cleanup waits on the shared private auth
  mutex, both one-row batches settle, and live authority remains;
- the complete isolated PostgreSQL suite with 27 tables, 30 observed lock-wait races, 12 direct
  relation denials, and 43 cross-capability denials; and
- 156 focused Jobs tests plus strict lint and type checking for the command, fixed query, closed
  result, hostile input, and one-capability dispatch paths.

The SQL evidence uses only synthetic rows in a portless ephemeral PostgreSQL project. Focused Jobs
tests use an injected pool; the shared opt-in Jobs integration additionally proves this emitted
command through one disposable narrow login and exact stored state. Neither proves a scheduler,
production cadence/login/TLS, monitoring, backup purge, capacity, or deployment.

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
- [Bounded pairing retention cleanup](0029-bounded-pairing-retention-cleanup.md)
- [Bounded authentication retention cleanup](0032-bounded-auth-retention-cleanup.md)
- [Bounded pairing approval-provenance retention](0047-bounded-pairing-approval-provenance-retention.md)
