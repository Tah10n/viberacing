# ADR 0001: Community-only launch and disabled Verified tier

- Status: Accepted (Community ingest DB implemented; service and scoring pending)
- Date: 2026-07-14
- Decision owners: Product, Web, Ingest, and Scoring
- Supersedes: None
- Superseded by: None

## Context

The planned connector runs on a participant-controlled computer. Request signatures can identify a
registered device, but they cannot prove that the local Codex process or submitted usage is honest.
The current upstream contract does not provide a documented immutable account identifier that would
let Vibe Racing prove global Codex account uniqueness.

A competitive-looking race can create a misleading expectation of verified global ranking, and any
prize or privilege would create a strong incentive to falsify client data.

## Decision

Launch only a visibly labeled **Community** league based on self-reported local-device data. It
ranks participating Vibe Racing profiles, not all Codex users. Community score never grants money,
prizes, authorization, access, moderation power, or another valuable benefit.

Keep a separate `Verified` trust state server-owned, disabled, and impossible for clients or normal
admin actions to populate. Enabling it requires a new ADR and a server-verifiable OpenAI usage and
identity source.

Raw tokens are not a tie breaker. Shared score and active-day results share rank; deterministic
display order has no competitive meaning.

## Security and privacy consequences

The design accepts plausible self-fabrication while containing its value. Every race/profile surface
needs the Community disclaimer, and APIs must not accept client trust tier, score, rank, season, or
moderation fields. [VR-TRUST-001](../architecture/SECURITY_INVARIANTS.md) and VR-TRUST-002 are
normative.

Abuse controls can quarantine or rate-limit records, but heuristics must not be marketed as
verification. If a future feature attaches value to score, the current severity model and accepted
risk become invalid before that feature ships.

## Alternatives considered

- **Claim verified local Codex usage:** rejected because a modified client can fabricate the source
  and the service cannot prove account uniqueness.
- **Hash or blind account email:** rejected because email can be absent or mutable, adds privacy and
  cryptographic surface, and still does not make a client honest.
- **No leaderboard until upstream verification exists:** safer for integrity, but rejects the core
  playful Community product. The reward-free disclaimer and cap make the residual risk acceptable.
- **Use raw totals as tie breaker:** rejected because it increases privacy exposure and cheating
  value.

## Migration and rollback

The Community label and no-benefit rule are launch invariants. If integrity harms outweigh product
value, disable public ranking independently while retaining private profile controls and deletion.
Do not silently relabel existing Community records Verified.

A future Verified tier uses separate ingestion, provenance, tables/procedures or strictly separated
trust columns, public copy, and migration. Existing Community seasons remain Community permanently.

## Verification

- Copy assertions across EN/RU race, profile, onboarding, API reference, and metadata.
- Contract tests reject client-set trust, score, rank, and season fields.
- Revision 0007 stores only source-bound Community input and server outcomes; no client field or
  runtime role can populate Verified trust, score, rank, season, or moderation state.
- Feature/config tests prove Verified ingestion is unreachable by default and in production.
- Architecture tests prove no reward, authorization, or privilege reads Community score.
- Security review repeats before any incentive or upstream verification change.

## References

- [Project plan](../PROJECT_PLAN.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Usage forgery abuse case](../security/ABUSE_CASES.md#vr-abuse-usage-forgery-fabricated-or-inflated-token-buckets)
