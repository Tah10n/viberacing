# ADR 0049: Bounded revoked-device retention cleanup

- Status: Accepted (local scheduler catalog; deployment pending)
- Date: 2026-07-18
- Decision owners: Pairing, Ingest, Jobs, Database, Security, Privacy, and Operations
- Supersedes: None
- Superseded by: None

## Context

An activated pairing retains its poll and code verifier digests, challenge, bounded device metadata,
profile/source binding, and the exact device-key row that became authority. The device row retains
the Ed25519 public key, user label, connector/platform metadata, source binding, and lifecycle
timestamps. Revocation removes submission authority immediately, but retaining every revoked device
and activated pairing forever would keep identifier and security metadata without a bounded end.

Deletion cannot be based on revocation age alone. Recent device history remains useful for incident
review; pairing approval session/passkey attribution has its own 180-day boundary; an authorization
challenge can still point to the pairing; and nonce or raw usage-snapshot rows can still point to
the device. This slice must delete only an already minimized pair, preserve every live or referenced
row, avoid implicit cascades, serialize with existing retention and profile purge, and expose one
bounded least-privileged Jobs operation. It must not let Jobs select a profile, source, device,
pairing, cutoff, or SQL; delete active authority or raw evidence; schedule work; purge backups; or
claim deployed retention.

## Decision

Revision 0036 adds an ordered partial index on `(revoked_at, device_key_id)` for revoked device rows
and grants only `viberacing_jobs` the new `cleanup_aged_revoked_devices(integer)` function. One
invocation:

- accepts an exact batch from 1 through 1000;
- locks `ingest_retention_cleanup` and `pairing_retention_cleanup` in the established alphabetical
  profile-purge order before capturing PostgreSQL server time;
- derives one fixed cutoff of 180 days before that server time, with no caller-selected timestamp;
- joins an exact `revoked` device at or before the cutoff to its `activated` pairing, which must
  also have activated at or before the cutoff;
- requires both pairing approval references to have already been redacted and requires no
  `auth_challenges.authorized_pairing_id`, `device_nonces.device_key_id`, or
  `usage_snapshots.device_key_id` reference;
- processes candidates oldest-first with `FOR UPDATE OF` both rows and `SKIP LOCKED`;
- deletes the exact pairing first and the exact device second, repeats every authoritative state,
  cutoff, binding, and absence predicate, and requires exactly one affected row at each step; and
- returns only equal `deleted_pairings` and `deleted_device_keys` counts.

Any changed reference or state fails the operation and rolls back both deletes. The explicit absence
checks prevent the pairing's challenge foreign key and the device's nonce/snapshot foreign keys from
turning their configured cascades into retention policy. Restrictive pairing/device foreign keys
remain a final fail-closed backstop. Runtime pairing activation, device revocation, Ingest
verification, and source lifecycle procedures remain unavailable to Jobs and continue to own
authority transitions.

An eligible delete removes the minimized activated pairing, including its verifier digests,
challenge, device metadata, and binding identifiers, then removes the revoked device row, including
its public key, label, connector/platform metadata, and lifecycle timestamps. It leaves the profile,
source, active and recent devices, retained referenced history, and derived Community source/day and
season values unchanged. Raw nonce or snapshot evidence must first expire through its independently
reviewed retention capability; cleanup never deletes that evidence as a side effect.

ADR 0014's one-shot Jobs boundary gains the exact `cleanup-aged-revoked-devices` command. It always
supplies 1000, performs the same per-checkout login/role/search-path probe, executes one fixed
parameterized query, validates one exact result row and both equal bounded counts, holds the client
through settlement, destroys it on failure, and emits only the existing generic completion or
failure sentence. No caller chooses SQL, profile, source, device, pairing, cutoff, result column, or
batch size.

## Security and privacy consequences

The pair remains until at least 180 days have elapsed from both activation and revocation, and any
retained approval provenance, authorization challenge, nonce, or raw snapshot extends retention
automatically. Active devices, recently revoked devices, pending/approved pairings, and activated
pairs with remaining evidence are never eligible. Deletion cannot reactivate, approve, sign, submit,
revoke, unlink, or mutate a score.

Locking both existing mutexes prevents independently scheduled Ingest, pairing, provenance, or
profile-purge cleanup from changing required evidence halfway through admission. There is no new
lock class. Exact row locks plus repeated predicates protect concurrent runtime changes, and the
observed worker race proves separate one-row invocations serialize and delete two aged minimized
pairs once while preserving recent and active controls.

Jobs receives no table access and cannot read public keys, verifier material, labels, source IDs, or
usage. Its result exposes only two aggregate counts that must be equal and no affected identifier.
The cleanup reduces retained Security and Account metadata without treating client-submitted usage
as verified or changing derived Community history.

Residual risk remains: other retained source/profile history, tombstones, caches, backups, and
restore replay still need separate policies and evidence. ADR 0050 now separately bounds fixed
pairing-rate-window reset. ADR 0063 supplies a default-off in-memory local catalog, sequential
execution, no-overlap lifecycle, fixed-clock core composition, directly injected repeated-timer
execution and lifecycle settlement, real-clock emitted-process restart and post-startup signal
settlement, one local native-timer callback, and three pinned-Linux OS-signal settlement paths.
There is no deployed OS-signal routing or controller/orchestrator grace, deployed cadence, durable
missed-slot recovery, monitoring, capacity result, production Jobs login/TLS connection, backup
purge, or deployed retention proof.

Affected invariants are VR-DEVICE-001, VR-DATA-001, and VR-DELETE-001. Primary attacker stories are
VR-ABUSE-DEVICE-KEY-THEFT, VR-ABUSE-DATABASE-ROLE, VR-ABUSE-DELETE-RESURRECTION, and
VR-ABUSE-RESOURCE-EXHAUSTION.

## Alternatives considered

- **Retain revoked devices and activated pairings forever:** rejected because authority is gone and
  unreferenced key, verifier, label, and binding metadata would grow without a bounded purpose.
- **Delete a device immediately on revocation:** rejected because recent incident evidence and
  independently retained pairing, challenge, nonce, or snapshot references remain relevant.
- **Cascade challenges, nonces, or snapshots:** rejected because this capability must not silently
  redefine authentication or raw-ingest retention.
- **Keep the pairing while deleting only its device key:** rejected because the exact pending-key
  binding is restrictive and the remaining pairing would retain most of the minimized private
  transaction metadata without an authority consumer.
- **Redact the public key or pairing verifiers in place:** rejected for this version because it adds
  new lifecycle states and partial-row semantics while an unreferenced pair has no exact consumer.
- **Accept a CLI cutoff or batch:** rejected because fixed server time and a reviewed maximum
  prevent operator-selected deletion scope.
- **Add another maintenance mutex:** rejected because the affected raw and pairing references are
  already serialized by the existing Ingest and pairing locks, and profile purge already defines
  their shared order.

## Migration and rollback

Revision 0036 is forward-only and runs in one transaction under the migration advisory lock, the
non-login owner, a five-second migration lock timeout, and a 30-second statement timeout. It adds
one partial index, creates and grants one Jobs-only function, and records its immutable manifest
digest. It changes no row shape, foreign key, role membership, maintenance-lock inventory, existing
public procedure signature, or external system.

Before a shared environment, rollback discards and rebuilds the disposable database and removes the
local command. After release, repair requires another reviewed forward migration; do not edit
revision 0036. Stopping a future schedule cannot restore deleted pairing or device rows, and
rollback must not widen Jobs table access or introduce cascading cleanup.

## Verification

Acceptance evidence recorded for this decision includes:

- static validation of 37 contiguous immutable migration revisions and the exact checksum ledger;
- real PostgreSQL scenarios for oldest-first and exact-cutoff batches, recent and active
  preservation, approval-provenance/challenge/nonce/snapshot blockers, idempotency, invalid batches,
  both missing-mutex cases, supporting index, atomic rollback, and exact role grants;
- an observed two-worker race in which separate one-row batches serialize, both aged minimized pairs
  and devices are deleted once, and recent plus active controls remain;
- the complete isolated PostgreSQL suite with 27 tables, 38 observed lock-wait races, 12 direct
  relation denials, and 64 cross-capability denials;
- 242 focused Jobs tests with 100% statement, branch, function, and line coverage plus strict lint,
  type checking, and build; and
- a separate disposable PostgreSQL integration that runs all fifteen built Jobs commands through a
  narrow login, rejects a deliberately widened login before mutation, preserves generic output,
  deletes one aged minimized revoked-device pair, and checks exact stored state.

All fixtures are synthetic. ADR 0063 separately proves the default-off scheduler against a fake
runner and clock, exercises this cleanup after provenance/session/passkey cleanup in a fixed-clock
production-core/PostgreSQL cycle, and directly invokes the production interval handler for a
repeated fixed-clock cycle and the lifecycle handler after an active runner call starts. These
layers do not prove the later ADR 0063 evidence by themselves. Those restart/post-startup,
native-timer, and active-call OS-signal gates prove one local recurring callback and three local
emitted signal paths, but the combined evidence still does not prove deployed signal routing or
controller/orchestrator grace, production cadence/login/TLS, monitoring, cache or backup purge,
restore replay, capacity, real-user retention, or deployment.

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
- [Bounded expired-session retention cleanup](0042-bounded-expired-session-retention-cleanup.md)
- [Bounded pairing approval-provenance retention](0047-bounded-pairing-approval-provenance-retention.md)
- [Bounded revoked-passkey retention cleanup](0048-bounded-revoked-passkey-retention-cleanup.md)
- [Bounded pairing rate-window retention reset](0050-bounded-pairing-rate-window-retention-reset.md)
