# ADR 0061: Bounded abandoned-enrollment retention cleanup

- Status: Accepted
- Date: 2026-07-18
- Decision owners: Web/Auth, Database, Jobs, Security, Privacy, and Operations
- Supersedes: None
- Superseded by: None

## Context

Invite enrollment atomically creates one private `enrolling` profile, redeems the exact invite, and
creates a pending browser session. Initial WebAuthn registration then uses that session plus a
one-time challenge to create the first passkey and activate the profile. ADR 0060 can stop new and
continuing enrollment work at local UI, HTTP, and service boundaries, but it deliberately does not
delete already-created database state.

The existing authentication cleanup can remove expired challenges and independently eligible
sessions. The invite cleanup intentionally preserves every redeemed invite as enrollment provenance.
Consequently, a user who leaves before initial passkey activation can leave an `enrolling` profile
and redeemed invite indefinitely even after all browser and challenge authority has expired. Reusing
the invite cleanup would either preserve that orphan forever or weaken its redeemed-provenance
invariant. Reusing primary deletion would invent a user-requested deletion job, tombstone, or
notification contract that never occurred.

The cleanup must not race a valid initial passkey registration, remove an active profile, make a
redeemed invite reusable, or turn a malformed `enrolling` row with post-activation authority into an
unreviewed broad profile purge. It must remain bounded, least-privileged, non-reflective, and honest
about the absence of a scheduler, production login, monitoring, backup policy, or deployment.

## Decision

Revision 0038 adds `viberacing_api.cleanup_abandoned_enrollments(integer)`. Only `viberacing_jobs`
may execute it. The requested batch is an integer from 1 through 1000; null, zero, fractional
application input, or a database value outside that range fails closed. The function pins
`pg_catalog,pg_temp`, a five-second lock timeout, and a 30-second statement timeout.

The function locks the existing private `auth_retention_cleanup` and `profile_deletion_purge` mutex
rows in that stable alphabetical order before capturing one server timestamp. Both rows must exist.
It adds no caller-selected lock key or eighth maintenance-lock row.

A profile is eligible only when all of these predicates hold at the captured server time:

- its exact state is `enrolling`;
- an exact `redeemed` invite points to it;
- every associated session retains exact `enrollment` authentication and has `expires_at` strictly
  before the captured time;
- every associated authentication challenge retains exact `passkey_registration` purpose and has
  `expires_at` strictly before the captured time;
- no passkey, recovery code, recovery authority, Codex source, or deletion job points to it; and
- no season entry, finalized freshness projection, active CarRecipe, or pending CarRecipe proposal
  points to it.

Those shape predicates fail closed on non-enrollment, post-activation, deletion, scoring, or recipe
state even if an owner-side error left the profile state unchanged. Terminal session/challenge state
alone does not accelerate deletion: every retained row is conservatively preserved until its expiry
is strictly before the captured time.

Candidates use a partial `(created_at, profile_id)` index, are selected oldest-first one at a time,
and use `FOR UPDATE ... SKIP LOCKED`. Every eligibility predicate is repeated in the `DELETE` after
the exact profile row is locked. A concurrent initial-passkey transaction already holding the
session/profile row therefore remains authoritative and cleanup completes without waiting on or
deleting that profile. A cleanup transaction that obtains the row first can only do so after all
retained session/challenge authority has expired.

Deleting the profile atomically uses existing foreign-key policy to delete its exact redeemed
invite, expired sessions, and expired authentication challenges. Existing audit events remain and
their profile link becomes null through `ON DELETE SET NULL`. The function creates no deletion job,
tombstone, replacement invite, audit payload, log, metric, notification, or reusable identifier. The
consumed invite is permanently removed, not restored to `active` or made reusable.

The local Jobs runner adds one exact `cleanup-abandoned-enrollments` command. It always requests the
fixed maximum batch, performs the existing exact least-privileged runtime probe, calls only the new
prepared function, accepts one closed nonnegative count no greater than the requested batch,
discards that count, and prints only the existing generic completion or failure sentence. Jobs now
expose exactly sixteen reviewed one-shot capabilities.

This decision changes no public JSON Schema, OpenAPI operation, cookie, OAuth scope, WebAuthn
ceremony, browser route, source/device contract, scoring rule, connector command, public response,
or maintenance-lock row inventory.

Revision 0039 later repeats the same eligibility boundary with an additional
`NOT EXISTS finalized_season_profile_freshness` predicate. This preserves a malformed `enrolling`
profile that has finalization-derived state instead of broadening its cascade through the new direct
profile foreign key. It does not change this command, grant, batch, or normal canonical result.

## Security and privacy consequences

The slice bounds otherwise indefinite retention of a private pre-activation identity binding,
redeemed invite verifier row, and expired browser/authentication state. It preserves live or
equal-boundary authority, active profiles, every non-enrollment challenge, and any post-activation,
recovery, source, deletion, scoring, recipe, or missing-invite drift, plus every audit record.
Profile, invite, session, and challenge identifiers remain inside PostgreSQL; the application
receives and discards only one aggregate count.

The two existing mutexes serialize cleanup with authentication/session/invite retention and primary
profile deletion without adding a reverse lock order. Row locks protect initial passkey activation;
repeated predicates protect against committed state drift. The Jobs-only grant and existing login
probe prevent Web, Ingest, Admin, `PUBLIC`, or a widened Jobs login from invoking the capability.

This is not proof of account notification, legal erasure, cache purge, backup expiry, restore
replay, dynamic enrollment disablement, invite repair, production capacity, or a real retention
cadence. Until a protected scheduler and monitoring exist, eligible rows are removed only when an
operator deliberately invokes the local one-shot command. An immutable backup may retain encrypted
data until a separately disclosed expiry.

Affected invariants are VR-AUTH-001, VR-AUTH-002, VR-DATA-001, and VR-ABUSE-001. Primary attacker
stories are VR-ABUSE-IDENTITY-SYBIL, VR-ABUSE-AUTH-TAKEOVER, VR-ABUSE-DATABASE-ROLE,
VR-ABUSE-DELETE-RESURRECTION, and VR-ABUSE-RESOURCE-EXHAUSTION.

## Alternatives considered

- **Let session/invite cleanup compose implicitly:** rejected because redeemed invites and their
  parent profiles deliberately remain after those independent functions finish.
- **Reactivate or undo redemption of the invite:** rejected because a redeemed verifier is consumed
  provenance, not reusable enrollment authority.
- **Use the user-requested profile-deletion queue:** rejected because abandonment has no
  exact-handle/fresh-passkey request, deletion job, public-cache obligation, or reviewed tombstone.
- **Delete after a fixed profile age alone:** rejected because a still-live or rotated session and a
  still-live challenge remain valid enrollment authority regardless of profile creation time.
- **Treat only active sessions or unused challenges as live:** rejected because conservative expiry
  is simpler to audit and does not accelerate physical deletion from terminal-state interpretation.
- **Cascade any `enrolling` profile shape:** rejected because non-enrollment challenge, recovery,
  passkey, source, deletion, scoring, or recipe state is non-canonical and must fail closed for
  separate investigation.
- **Add a new maintenance mutex:** rejected because the cascade intersects the existing
  authentication and profile-purge capabilities and their stable lock order is sufficient.
- **Run automatically from Web or an enrollment switch:** rejected because request-serving roles
  must not receive Jobs deletion authority and a module-load gate is not a scheduler.

## Migration and rollback

Revision 0038 is an append-only migration. It adds one partial index, one owner-defined function,
one Jobs grant, and one schema-ledger row. Existing rows are not changed when the migration applies;
physical deletion requires a later explicit function call.

Before production scheduling, operators must decide and disclose cadence, capacity, alerts,
notification expectations, backup expiry, restore replay, and incident rollback. A deployment must
provision an exact Jobs-only login and TLS path rather than use the migration owner or tracked local
values.

Rollback first stops any scheduler and removes runtime invocation. In an unreleased disposable
database the schema can be rebuilt. After the migration reaches shared state, rollback is a new
reviewed forward migration that revokes the grant and removes the function/index only after no
caller depends on them. Deleted abandoned profiles and consumed invites cannot be reconstructed or
made reusable by schema rollback.

## Verification

Repository evidence covers:

- the exact direct profile foreign-key inventory and partial two-column oldest-first candidate
  index;
- batch 1, batch 1000 boundary, invalid bounds, idempotency, and exact aggregate result shape;
- atomic deletion of the exact profile, redeemed invite, expired session, and expired challenge;
- retained audit evidence with null profile linkage;
- preservation of a live session, live challenge, active profile, wrong-purpose challenge, recovery
  code/authority, passkey, source, deletion-job, score-entry, finalized freshness projection,
  active/pending recipe, and missing-redeemed-invite drift;
- missing authentication/profile-purge mutex failure and exact Jobs-only role grants;
- two cleanup workers serializing and deleting each eligible row once;
- an in-flight initial passkey activation committing while cleanup completes without waiting or
  deleting it;
- the fixed command parser, hostile input/result validation, prepared SQL, runtime probe, generic
  output, and destructive client release on failure;
- all sixteen built commands through a disposable least-privileged Jobs login plus a widened-login
  denial and exact stored-state assertions; and
- database manifest, lint, strict types, unit coverage, documentation, architecture, privacy, and
  public-data gates.

The tests do not prove a production scheduler, cadence, login/TLS credential, notification,
monitoring, alerting, capacity, cache/backup purge, restore replay, live enrollment workload, legal
retention policy, or deployment.

## References

- [Fail-closed enrollment enable gate](0060-fail-closed-enrollment-enable-gate.md)
- [Bounded authentication retention cleanup](0032-bounded-auth-retention-cleanup.md)
- [Bounded profile deletion purge](0034-bounded-profile-deletion-purge.md)
- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [Jobs workspace](../../apps/jobs/README.md)
- [Database workspace](../../database/README.md)
- [System context](../architecture/SYSTEM_CONTEXT.md)
- [Data flow](../architecture/DATA_FLOW.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
