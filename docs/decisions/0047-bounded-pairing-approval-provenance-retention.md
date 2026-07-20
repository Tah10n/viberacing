# ADR 0047: Bounded pairing approval-provenance retention

- Status: Accepted (local scheduler catalog; deployment pending)
- Date: 2026-07-18
- Decision owners: Web/Auth, Jobs, Database, Security, Privacy, and Operations
- Supersedes: None
- Superseded by: None

## Context

An activated pairing preserves the approved profile and source, the activated device identifier, and
the exact browser session and passkey that approved it. The durable profile/source/device binding is
still needed for source-bound device authority, but retaining both approval references forever also
retains expired session rows through restrictive foreign keys. That prevents the bounded session
cleanup from removing otherwise unusable verifier digests and authentication metadata.

This slice must keep a useful approval-investigation window, retain the activated device binding,
redact only the two exact approval references, serialize with authentication cleanup, pairing
cleanup, and primary profile purge, and preserve the least-privileged Jobs boundary. It must not
delete pairing or device history, weaken current authorization, accept an operator-selected cutoff,
schedule work, purge backups, or claim deployed retention.

## Decision

Revision 0034 extends the pairing update trigger with one exact transition: an already `activated`
row may change `approved_by_session_id` and `approved_by_passkey_id` together from non-null to null
while every approval, activation, pending-authority, profile, source, device, and timestamp field
remains unchanged. Partial redaction, redaction before activation, and redaction combined with any
other binding change remain integrity failures.

The revision adds an ordered partial index on `(activated_at, pairing_id)` and grants only
`viberacing_jobs` the new `redact_aged_pairing_approval_provenance(integer)` function. One
invocation:

- accepts an exact batch from 1 through 1000;
- locks `auth_retention_cleanup` and `pairing_retention_cleanup` in their shared alphabetical
  profile-purge order before capturing PostgreSQL server time;
- derives a fixed cutoff of 180 days before that server time, with no caller-selected timestamp;
- selects only activated rows at or before the cutoff whose two approval references are present;
- processes candidates in activation-time/identifier order with `FOR UPDATE SKIP LOCKED`;
- repeats the state, cutoff, and both-reference predicates in the update;
- nulls only the session and passkey approval references; and
- returns only `redacted_pairings`.

The approved profile/source and activated device binding remain exact. The pairing transaction,
pending device key reference, device row, source, profile, passkey row, approval and activation
times, and cryptographic transaction material are not deleted or rewritten. A later invocation of
the independent session cleanup may remove an expired session once no rotation predecessor or
remaining pairing reference retains it.

ADR 0014's one-shot Jobs boundary gains the exact `redact-aged-pairing-approval-provenance` command.
It always supplies 1000, performs the same per-checkout login/role/search-path probe, executes one
fixed parameterized query, validates one exact result row, holds the client through settlement,
destroys it on failure, and emits only the existing generic completion or failure sentence. No
caller chooses SQL, pairing, profile, source, device, session, passkey, cutoff, result column, or
batch size.

## Security and privacy consequences

After at least 180 days, eligible redaction removes the exact database links from an activated
pairing to its approving browser session and passkey. This lets the separate session cleanup remove
an expired verifier digest and session metadata once no other retained reference needs it. It adds
no collected field, identifier, browser value, log, cache, export, dependency, role, or maintenance
mutex. The aggregate count is transient and is never printed, logged, cached, exported, or stored.

The fixed retention window is finite approval attribution, not a change to device authority. Current
authorization continues to derive from the active source-bound device record and from fresh Web/Auth
proofs. The retained pairing still proves which profile/source/device binding was activated and
when, but it no longer identifies the approving session or passkey after the cutoff. Investigations
that require that exact reference must occur within the window or rely on separately governed audit
evidence.

Locking both existing mutexes prevents session cleanup from deleting a referenced row while
redaction settles and preserves the established profile-purge order. There is no new lock class or
reverse profile/device lock order. Jobs receives no table access and cannot select, delete, approve,
activate, revoke, or otherwise administer a pairing or device.

Residual risk remains: activated pairing/device records and cryptographic transaction metadata,
referenced passkeys and device keys, tombstones, caches, backups, and restore replay still need
separate retention evidence. ADR 0048 separately deletes only aged unreferenced revoked passkeys,
and ADR 0050 separately bounds fixed pairing-rate-window reset. ADR 0063 supplies a default-off
in-memory local catalog, sequential execution, no-overlap lifecycle, fixed-clock core composition,
directly injected repeated-timer execution and lifecycle settlement, and real-clock emitted-process
terminal-marker evidence. There is no host-timer delivery, deployed OS-signal routing, emitted-child
controller settlement before forced termination, wall-clock recurring process callback, deployed
cadence, durable missed-slot recovery, monitoring, capacity result, production Jobs login/TLS
connection, backup purge, or deployed retention proof.

Affected invariants are VR-AUTH-001, VR-DEVICE-001, VR-DATA-001, and VR-DELETE-001. Primary attacker
stories are VR-ABUSE-AUTH-TAKEOVER, VR-ABUSE-DATABASE-ROLE, VR-ABUSE-DELETE-RESURRECTION, and
VR-ABUSE-RESOURCE-EXHAUSTION.

## Alternatives considered

- **Retain exact session/passkey approval references indefinitely:** rejected because expired
  verifier and authentication metadata would remain solely to preserve unbounded attribution.
- **Delete the activated pairing or device row:** rejected because the source-bound device binding
  is active authority and the pairing/device history needs its own reviewed lifecycle.
- **Redact immediately after activation:** rejected because it removes useful short-term incident
  and approval evidence without a demonstrated minimization need.
- **Redact only the session reference:** rejected because partial provenance is ambiguous, still
  retains the passkey row, and violates the closed two-reference shape.
- **Accept a CLI cutoff or batch:** rejected because fixed server time and a reviewed maximum
  prevent operator-selected redaction scope.
- **Create a separate mutex:** rejected because this operation must serialize with both existing
  session/authentication and pairing/profile-purge work in their established order.
- **Delete sessions inside the redaction function:** rejected because the independent session
  cleanup owns rotation ordering, challenge cascade, and its own bounded result contract.

## Migration and rollback

Revision 0034 is forward-only and runs in one transaction under the migration advisory lock, the
non-login owner, a five-second migration lock timeout, and a 30-second statement timeout. It
replaces the pairing update function in place, adds one partial index, creates and grants one
Jobs-only function, and records its immutable manifest digest. It changes no row shape, foreign key,
role membership, maintenance-lock inventory, existing public procedure signature, or external
system.

Before a shared environment, rollback discards and rebuilds the disposable database and removes the
local command. After release, repair requires another reviewed forward migration; do not edit
revision 0034. Stopping a future schedule cannot restore redacted approval references, and rollback
must not widen Jobs table access or detach the active device binding.

## Verification

Acceptance evidence recorded for this decision includes:

- static validation of 34 contiguous immutable migration revisions and the exact checksum ledger;
- real PostgreSQL scenarios for oldest-first batches, the exact 180-day server cutoff,
  exact-boundary and recent preservation, partial/pre-activation/binding-change rejection,
  session-cleanup progress, active device/passkey/pairing preservation, idempotency, invalid
  batches, both missing-mutex cases, supporting index, and exact role grants;
- an observed two-worker race in which separate one-row batches serialize, both aged references are
  redacted once, and the recent reference plus all three device bindings remain;
- the complete isolated PostgreSQL suite with 27 tables, 34 observed lock-wait races, 12 direct
  relation denials, and 55 cross-capability denials;
- 204 focused Jobs tests with 100% statement, branch, function, and line coverage plus strict lint,
  type checking, and build; and
- a separate disposable PostgreSQL integration that runs all twelve built Jobs commands through a
  narrow login, rejects a deliberately widened login before mutation, preserves generic output,
  redacts one aged pairing, then removes its unreferenced expired session while retaining the
  pairing, active device, and passkey.

All fixtures are synthetic. ADR 0063 separately proves the default-off scheduler against a fake
runner and clock, proves this redaction precedes dependent session/passkey/device cleanup in a
fixed-clock production-core/PostgreSQL cycle, and directly invokes the production interval handler
for a repeated fixed-clock cycle and the lifecycle handler after an active runner call starts. These
layers do not prove host-timer delivery, deployed OS-signal routing, emitted-child controller
settlement before forced termination, wall-clock recurring process behavior, production
cadence/login/TLS, monitoring, cache or backup purge, restore replay, capacity, real-user retention,
or deployment.

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
- [Bounded expired-session retention cleanup](0042-bounded-expired-session-retention-cleanup.md)
- [Bounded revoked-passkey retention cleanup](0048-bounded-revoked-passkey-retention-cleanup.md)
- [Bounded revoked-device retention cleanup](0049-bounded-revoked-device-retention-cleanup.md)
