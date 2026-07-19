# ADR 0048: Bounded revoked-passkey retention cleanup

- Status: Accepted (database capability and local one-shot command implemented; scheduling pending)
- Date: 2026-07-18
- Decision owners: Web/Auth, Jobs, Database, Security, Privacy, and Operations
- Supersedes: None
- Superseded by: None

## Context

Vibe Racing retains the exact passkey used by browser sessions, critical-action challenges, and
pairing approval. That provenance must not disappear while a restrictive reference exists. However,
the public database also caps each profile at 32 retained passkey rows, and recovery completion
fails closed at that ceiling. Retaining an old revoked credential forever after every provenance
reference has expired would eventually prevent replacement-passkey recovery and keep credential ID,
public-key, label, usage, and lifecycle data without an active security purpose.

This slice must preserve active credentials and every referenced historical credential, keep a
useful incident window after revocation, serialize with existing authentication/pairing retention
and profile purge, and expose only one bounded least-privileged Jobs operation. It must not weaken
the retained-record ceiling, let Jobs select a profile or credential, delete active authority,
cascade a reference, choose a cutoff, schedule work, purge backups, or claim deployed retention.

## Decision

Revision 0035 adds an ordered partial index on `(revoked_at, passkey_id)` for revoked credentials
and grants only `viberacing_jobs` the new `cleanup_aged_revoked_passkeys(integer)` function. One
invocation:

- accepts an exact batch from 1 through 1000;
- locks `auth_retention_cleanup` and `pairing_retention_cleanup` in the established alphabetical
  profile-purge order before capturing PostgreSQL server time;
- derives a fixed cutoff of 180 days before that server time, with no caller-selected timestamp;
- selects only `revoked` rows whose `revoked_at` is at or before the cutoff;
- requires the row to have no `sessions.authenticated_by_passkey_id`,
  `auth_challenges.verified_by_passkey_id`, `auth_challenges.authorized_passkey_id`, or
  `pairing_transactions.approved_by_passkey_id` reference;
- processes candidates in revocation-time/identifier order with `FOR UPDATE SKIP LOCKED`;
- repeats the state, cutoff, and all four absence predicates in the delete; and
- returns only `deleted_passkeys`.

Restrictive foreign keys remain a final fail-closed backstop. The function does not lock profile
rows after passkey rows and therefore does not reverse the Web/Auth profile-before-credential order.
Runtime registration, login, step-up, revocation, and recovery procedures remain unavailable to Jobs
and continue to own active credential transitions.

An eligible delete removes the whole unreferenced passkey row, including its credential ID, COSE
public key, label, counters, flags, and lifecycle timestamps. It leaves the profile, current active
passkeys, sessions/challenges/pairings that refer to other credentials, active source-bound devices,
and bounded profile-level audit references unchanged. Once cleanup reduces a profile below the
32-row ceiling, the existing add/recovery procedures can create a replacement key through their
unchanged fresh-proof and atomic-transition contracts.

ADR 0014's one-shot Jobs boundary gains the exact `cleanup-aged-revoked-passkeys` command. It always
supplies 1000, performs the same per-checkout login/role/search-path probe, executes one fixed
parameterized query, validates one exact result row, holds the client through settlement, destroys
it on failure, and emits only the existing generic completion or failure sentence. No caller chooses
SQL, profile, passkey, credential, cutoff, result column, or batch size.

## Security and privacy consequences

At least 180 days of revoked-credential history remains, and any exact session, challenge, or
pairing reference extends retention automatically. This preserves authorization and investigation
evidence without treating an unreferenced revoked public key or user label as permanent data. An
active credential is never eligible, and deletion cannot reactivate, replace, authenticate, approve,
or revoke anything.

Locking both existing mutexes prevents the independently scheduled authentication, session, pairing,
approval-provenance, or profile-purge capabilities from removing a reference halfway through
candidate admission. There is no new lock class or reverse profile/passkey order. The observed
worker race proves separate one-row invocations serialize and delete two aged rows once while
preserving recent and active controls.

The cleanup frees a bounded availability ceiling but does not raise it or create recovery authority.
Recovery still requires one-time Argon2id verification, exact restricted authority, replacement
WebAuthn proof, and atomic session creation. Jobs receives no table access and cannot read
credential material or select the affected profile.

Residual risk remains: retained pairing/device transaction history, revoked device keys, fixed
pairing-rate windows, tombstones, caches, backups, and restore replay still need separate policies
and evidence. There is no scheduler, cadence, overlap/retry policy, monitoring, capacity result,
production Jobs login/TLS connection, backup purge, or deployed retention proof.

Affected invariants are VR-AUTH-002, VR-AUTH-003, VR-DATA-001, and VR-DELETE-001. Primary attacker
stories are VR-ABUSE-AUTH-TAKEOVER, VR-ABUSE-DATABASE-ROLE, VR-ABUSE-DELETE-RESURRECTION, and
VR-ABUSE-RESOURCE-EXHAUSTION.

## Alternatives considered

- **Retain revoked passkeys forever:** rejected because unreferenced credential material can
  permanently exhaust the recovery/addition ceiling without preserving usable provenance.
- **Raise or remove the 32-row ceiling:** rejected because it converts an availability issue into
  unbounded credential growth and weakens the public database safety contract.
- **Delete every revoked passkey immediately:** rejected because recent session, challenge, pairing,
  and incident provenance remains security-relevant.
- **Cascade or null restrictive references:** rejected because cleanup must never rewrite or erase
  exact authority history to make a credential eligible.
- **Redact key material but retain an archived row:** rejected for this version because it requires
  a new lifecycle state and changes every retained-row-counting procedure while an unreferenced row
  has no remaining exact consumer.
- **Accept a CLI cutoff or batch:** rejected because fixed server time and a reviewed maximum
  prevent operator-selected deletion scope.
- **Lock profile rows after candidate passkeys:** rejected because Web/Auth credential operations
  acquire profile authority first; the cleanup needs no profile mutation and must not introduce the
  reverse order.

## Migration and rollback

Revision 0035 is forward-only and runs in one transaction under the migration advisory lock, the
non-login owner, a five-second migration lock timeout, and a 30-second statement timeout. It adds
one partial index, creates and grants one Jobs-only function, and records its immutable manifest
digest. It changes no row shape, foreign key, role membership, maintenance-lock inventory, existing
public procedure signature, or external system.

Before a shared environment, rollback discards and rebuilds the disposable database and removes the
local command. After release, repair requires another reviewed forward migration; do not edit
revision 0035. Stopping a future schedule cannot restore deleted credential rows, and rollback must
not widen Jobs table access or the retained-record ceiling.

## Verification

Acceptance evidence recorded for this decision includes:

- static validation of 35 contiguous immutable migration revisions and the exact checksum ledger;
- real PostgreSQL scenarios for oldest-first batches, the exact 180-day server cutoff, recent and
  active preservation, every restrictive session/challenge/pairing reference, idempotency, invalid
  batches, both missing-mutex cases, supporting index, and exact role grants;
- a recovery scenario that first fails atomically at 32 retained rows, deletes only 31 old
  unreferenced revoked rows, then succeeds with the unchanged replacement-passkey contract;
- an observed two-worker race in which separate one-row batches serialize, both aged credentials are
  deleted once, and recent plus active credentials remain;
- the complete isolated PostgreSQL suite with 27 tables, 35 observed lock-wait races, 12 direct
  relation denials, and 58 cross-capability denials;
- 216 focused Jobs tests with 100% statement, branch, function, and line coverage plus strict lint,
  type checking, and build; and
- a separate disposable PostgreSQL integration that runs all thirteen built Jobs commands through a
  narrow login, rejects a deliberately widened login before mutation, preserves generic output,
  deletes one aged unreferenced revoked passkey, and checks exact stored state.

All fixtures are synthetic. This evidence proves no scheduler, production cadence/login/TLS,
monitoring, cache or backup purge, restore replay, capacity, real-user retention, or deployment.

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
- [Restricted recovery authority](0007-restricted-recovery-authority.md)
- [Bounded Community maintenance runner](0014-bounded-community-maintenance-job-runner.md)
- [Bounded authentication retention cleanup](0032-bounded-auth-retention-cleanup.md)
- [Bounded expired-session retention cleanup](0042-bounded-expired-session-retention-cleanup.md)
- [Bounded pairing approval-provenance retention](0047-bounded-pairing-approval-provenance-retention.md)
