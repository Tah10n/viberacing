# ADR 0008: Community season grace and immutable finalization

- Status: Accepted (local scheduler; corrections/deployment pending)
- Date: 2026-07-15
- Decision owners: Product, Ingest, Jobs, Database, Security, and Privacy
- Supersedes: None
- Superseded by: None

## Context

Community scores use ISO Monday-through-Sunday seasons, but an upload can arrive after the local
Codex activity date it reports. The project therefore needs one public, deterministic grace policy
that tolerates ordinary delayed sync without letting client time reopen history. Jobs also needs an
idempotent terminal transition: a retry, concurrent upload, or scoring refresh must never silently
rewrite a result that has already become durable.

The connector's `observedAt` and each `codexReportedDate` are untrusted input. Only a timestamp
captured by the server-side database procedure can decide whether a season still accepts score
state. At revision 0010, the database-only foundation had no correction authority, public score
read, scheduler, or service from which a hidden operational exception could be inferred.

## Decision

A Community season begins Monday 00:00 UTC and contains the seven reported dates through Sunday. Its
grace deadline is Wednesday 00:00 UTC immediately following that week: 48 hours after the next
Monday begins. This duration is public product policy, not a protected anti-abuse threshold.

The Ingest submission procedure derives every affected ISO season from the submitted dates, obtains
those season gates, and then captures millisecond `receivedAt` from PostgreSQL `clock_timestamp()`.
That post-lock server timestamp defines database acceptance and the inclusive deadline comparison: a
receipt at or after the grace deadline is closed. Refresh and finalization capture their decision
time at the same post-lock boundary. Client `observedAt`, clock skew, retries, lock-wait duration,
and future or historical reported dates cannot extend the window.

A payload is atomic across all submitted dates. If any entry belongs to a closed or already
finalized season, the complete snapshot is retained with outcome `quarantined` and reason
`season_closed`, but it updates no accepted `source_day_values`. Normal 30-day raw-snapshot
retention still applies. An exact retry returns `duplicate` without adding replay or snapshot state.

Open-season refresh and finalization share one private Jobs mutex and the same per-season advisory
lock namespace as Ingest. Locks are acquired in the canonical order
`season → profile → source → device`; multiple seasons are locked in ascending order. This prevents
scoring from observing a partial submission and prevents the profile foreign-key checks used during
materialization from deadlocking with Ingest.

Jobs may refresh only before the grace deadline. At or after the deadline, one Jobs-only procedure
atomically materializes the latest accepted eligible source/day state and moves the season from
`open` to `finalized`. It records the immutable score version, exact deadline, refresh timestamp,
and finalization timestamp. A retry returns the existing terminal timestamp and current surviving
profile-row count without recomputing or reopening the season. Finalizing a no-data week records one
empty terminal season so later submissions cannot create accepted historical state. Empty terminal
growth is bounded to the ISO weeks reachable from the contract's `20xx` date format (`1999-12-27`
through `2099-12-28`); Jobs fails closed outside that calendar.

Database triggers reject updates or deletion of finalized season metadata, weekly entries, and daily
scores. The sole deletion exception is the existing profile-purge cascade: personal score rows may
disappear with their profile, while the non-personal season definition and terminal state remain.
This is deletion compliance, not a scoring correction. No runtime role can directly access the
private tables.

There is no correction capability in this decision. Any post-finalization correction must use a
separately authorized, reasoned, user-visible, and audited design in a later ADR and migration. It
must not turn the current Jobs procedure or migration owner into a silent history editor.

## Security and privacy consequences

Server time now enforces VR-INGEST-002 at the database boundary. A late, replayed, or client-dated
payload cannot affect accepted state or a terminal projection. Atomic snapshot quarantine avoids a
mixed outcome whose accepted subset would be difficult to explain or retry safely. The shared lock
order makes finalization and submission serializable at the affected season boundary without
granting Ingest any scoring-table access.

Retaining a late raw snapshot helps diagnose compatibility and deadline disputes, but it retains
private usage evidence until the existing 30-day cleanup boundary runs. ADR 0063 supplies a
default-off in-memory local catalog plus fixed-clock core composition, directly injected
repeated-timer execution and lifecycle settlement, real-clock emitted-process restart and
post-startup signal settlement, and later native-timer plus active-call OS-signal paths. Those
emitted paths prove one local recurring callback, four graceful local emitted signal paths, two
abrupt active-call crash paths, and one controlled uncommitted post-insert transaction rollback, not
deployed OS-signal routing or controller/orchestrator grace, a deployed cleanup cadence, monitoring,
deletion-worker operation, backup policy, or production retention evidence. Those remain required
before real-user ingestion.

The 48-hour window deliberately favors ordinary delayed sync over immediate leaderboard closure. It
does not verify Community input, make a score authoritative OpenAI data, or justify prizes, money,
authorization, or another valuable benefit. A compromised Ingest service can still submit plausible
data under a valid device binding; rate limits, signature verification, origin proof, anomaly
policy, and operational response remain application and deployment requirements.

Affected invariants are VR-TRUST-001, VR-INGEST-001, VR-INGEST-002, VR-ABUSE-001, VR-DATA-001,
VR-DELETE-001, and VR-PUBLIC-001. The primary attacker stories are VR-ABUSE-USAGE-FORGERY,
VR-ABUSE-SEASON-RACE, VR-ABUSE-DATABASE-CROSS-ROLE, and VR-ABUSE-RESOURCE-EXHAUSTION.

## Alternatives considered

- **Finalize at Sunday midnight with no grace:** rejected because normal delayed or offline sync
  would be discarded immediately and users would have no predictable recovery window.
- **Use a seven-day grace period:** rejected for the initial Community product because it keeps one
  weekly result mutable for another full season without current operational evidence that this is
  necessary. A duration change is product and compatibility policy and requires a superseding ADR.
- **Use connector `observedAt` or reported activity dates:** rejected because a client controls both
  and could reopen history by backdating or replaying a payload.
- **Accept only the still-open entries from a mixed payload:** rejected because partial acceptance
  complicates signing, idempotency, user explanation, and monotonic source-state semantics.
- **Silently drop late payloads:** rejected because bounded quarantined evidence is safer for
  compatibility diagnosis and exact retry behavior.
- **Allow Jobs to recompute a finalized row:** rejected because the same authority that performs
  routine scheduling would become an unaudited history-edit capability.
- **Create a correction table now:** rejected because correction authorization, visibility,
  retention, and operational ownership are not yet designed.

## Migration and rollback

Revision 0010 adds the exact grace deadline and terminal state to private seasons, replaces the
refresh and submission procedures with server-deadline and shared-lock behavior, adds a Jobs-only
finalization procedure, and enforces finalized projection immutability with profile-purge
compatibility. It adds no network endpoint, public read, scheduler, service credential, correction
path, or deployment.

The migration is forward-only. Before a shared environment exists, a disposable database can be
rebuilt from the checksum manifest. After deployment, repair defects with a reviewed forward
migration. A future incident response can stop a finalization scheduler or disable Ingest, but must
not move a finalized season back to `open`, extend an existing deadline, or grant a runtime role
table access.

Changing the 48-hour policy for future seasons requires a new versioned decision and compatibility
plan. Existing season definitions and finalized projections remain unchanged. Disabling a future
application scheduler leaves database state safe and retryable.

## Verification

Current PostgreSQL evidence covers:

- exact grace calculation and the millisecond immediately before versus exactly at the inclusive
  deadline;
- post-season-lock server timestamps for Ingest, refresh, and finalization so lock waits cannot
  backdate a decision;
- early-finalization and out-of-range failure without partial season state, terminal
  materialization, exact retry, no-data closure, and refresh denial after finalization;
- late whole-snapshot quarantine, raw-evidence retention, no accepted source/day mutation, and
  duplicate retry after closure;
- direct owner-level mutation, cross-season move, and deletion denial for finalized metadata, weekly
  entries, and daily scores, while profile purge removes personal rows without reopening the season;
- a five-second lock bound and 30-second statement deadline on Ingest, refresh, and finalization;
- Jobs-only finalization plus explicit Web, Ingest, and Admin denials;
- an observed cross-connection finalization-versus-late-Ingest race that originally exposed a lock
  inversion, now proves the canonical lock order, and converges on one terminal projection while the
  late payload remains quarantined; and
- an observed opposing-order multi-season Ingest race that proves both callers acquire ascending
  season locks rather than forming an `A → B` / `B → A` advisory-lock cycle.

At this decision's verification point, the repository still lacked the Ingest service, Ed25519
verification, edge/origin proof, rate limits, Jobs scheduler, corrections, monitoring, capacity
evidence, purge, and deployment. Later revisions add local bounded slices, including ADR 0063's
default-off scheduler, but database finalization, projection, and local routes are not launch
evidence.

## References

- [Community trust tier](0001-community-trust-tier.md)
- [Opaque multi-source aggregation](0002-opaque-multi-source-aggregation.md)
- [Service and database isolation](0004-edge-service-and-database-isolation.md)
- [Public Community score projection](0009-public-community-score-projection.md)
- [Project plan](../PROJECT_PLAN.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Data flow](../architecture/DATA_FLOW.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
- [Database capability boundary](../../database/README.md)
