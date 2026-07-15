# ADR 0002: Opaque multi-source profiles with one profile cap

- Status: Accepted (database aggregation implemented; services/public projection pending)
- Date: 2026-07-14
- Decision owners: Product, Pairing, Ingest, Scoring, and Database
- Supersedes: None
- Superseded by: None

## Context

Some users operate several Codex accounts or devices and want one Vibe Racing profile. The available
design evidence does not include a documented immutable Codex account ID. Account email may be
absent or mutable and is prohibited from leaving the local machine. Preventing a user-controlled
client from declaring the same real account twice is therefore not a defensible promise.

Multiple devices for one account must not multiply the same source/date, while intentionally
separate declared sources should contribute to the profile under one bounded scoring curve.

## Decision

Represent each user-declared account grouping as an opaque `CodexSource`. During pairing, a current
GitHub session plus fresh passkey chooses either a new source or an existing source. Every
persistent device key binds to exactly one source.

Enforce public fail-safe ceilings of 32 lifetime source records and 64 active plus unexpired
approved device authorities per profile. Deployments may apply lower private fair-use and rate
limits; those limits must not change score authority or imply verified account identity.

For one source/date, device snapshots update one current value and never sum. Separate active
sources sum into `profileDailyTokens`, after which the daily score cap is applied once per profile.
The public season projection includes the number of contributing sources.

Do not read, hash, transmit, store, or use account email. Do not describe a source as a verified
OpenAI account identity or claim global uniqueness.

## Security and privacy consequences

Source duplication remains possible, but cannot multiply score beyond the single profile cap or gain
authority. Cross-source submission is an authorization defect even when both sources belong to one
profile. Source state transitions are server-side, constrained, reasoned where exceptional, and
audited.

The public ceilings bound storage and authority fan-out but do not prevent a user from duplicating
one real account across opaque sources. Edge rate limiting, cleanup, profile-level scoring caps, and
abuse response remain independent controls.

The source ID is opaque Account/Security data. Public output exposes only a contributing count, not
source identifiers, device details, account email, exact per-source usage, or exact sync time.

## Alternatives considered

- **One source per profile:** simpler, but excludes legitimate multi-account use and encourages
  multiple public profiles.
- **Deduplicate by email hash:** rejected because the field is not a stable universal identifier,
  would add linkability, and a modified client can lie.
- **Sum every device:** rejected because same-account multi-device sync would multiply usage.
- **Cap each source separately:** rejected because creating sources would multiply the profile's
  maximum score.
- **Unlimited uncapped sum:** rejected for abuse and infrastructure cost.

## Migration and rollback

Begin with source-aware tables and contracts even if the first vertical slice exposes one source.
Adding source aggregation later must not reinterpret a device ID as an account ID.

If multi-source creation must be paused, disable only new-source creation; existing source-bound
devices, profile cap, visibility, revoke, unlink, and deletion remain. Never merge sources
automatically from inferred personal data.

## Verification

- Property tests for same-source device dedup, distinct-source sum, and one profile cap.
- Signature/database tests for device-to-source binding and cross-source denial.
- Pairing database tests for new/existing choice, post-approval competing-profile denial, replay,
  immutable activation, and the 32-source/64-authority ceilings. This slice is implemented in
  revision 0003.
- Cross-connection tests hold the relevant profile row, release two approvals together, and prove
  one closed loser at each public ceiling. Expired approvals do not consume live-authority slots.
- Revision 0004 adds exact-session private inventory, source pause/reactivation/unlink, device
  revoke, stale-authority invalidation, and cross-connection pause/approval plus unlink/activation
  races. Every current race observes its tagged contenders in the holder's blocker chain before
  release.
- Revision 0007 enforces exact device/source binding, one monotonic current value per source/date,
  whole-snapshot decrease quarantine, paused/revoked/deleting rejection, and exact retry. Observed
  races prove concurrent retries create one snapshot and two same-source devices converge on one
  value rather than sum.
- Revision 0009 sums current eligible distinct sources into one profile/day total, applies the daily
  cap once, exposes only the contributing count in private derived season state, excludes
  quarantined sources, and proves idempotent serialized refreshes. The Jobs service, public
  projection, finalization, and capacity evidence remain pending.
- UI/API assertions for opaque wording and public source count without identifiers.
- Privacy tests proving account email has no connector egress, schema, log, fixture, or support
  path.

## References

- [Project plan](../PROJECT_PLAN.md#multi-account-and-multi-device-model)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
- [Source duplication abuse case](../security/ABUSE_CASES.md#vr-abuse-source-duplication-duplicate-declared-codex-sources)
