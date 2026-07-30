# ADR 0068: Multi-agent token accounting and leaderboard

- Status: Superseded
- Date: 2026-07-21
- Decision owners: Product and Web/Auth, Ingest, Connector, and Database owners
- Supersedes: None while Proposed (if accepted, would partially supersede the Codex-only scope in
  ADR 0001 and ADR 0002)
- Superseded by: ADR 0076

## Context

The baseline plan describes an English/Russian pixel-art weekly leaderboard for **Codex** users: a
signed local connector reads a narrow token-activity response from the local Codex App Server and
submits bounded daily values, and public profiles appear as cars in a live weekly race.

The product direction now broadens:

1. The token leaderboard should be **agent-neutral**. It ranks token usage across many coding agents
   (initially Codex, Claude Code, opencode, Qwen Code, Cline, and Aider, with Kimi, Gemini CLI,
   Cursor, GitHub Copilot, Windsurf, and others recognized for future support), not Codex only.
   Connection should be simple and safe, and reported usage should be counted as honestly as a
   public client-reported service can.
2. The primary onboarding should remain simple: a thin, auditable local client reads only reviewed
   usage fields and submits one source's daily aggregate at a time. An MCP tool may be offered as an
   optional transport where an agent can expose the same reviewed usage aggregate, but MCP itself
   does not define token telemetry and cannot be the universal meter.
3. Vibe Racing remains one focused product surface: the weekly token leaderboard. Its racing
   presentation visualizes the server-derived sum of counted tokens across all supported agents. The
   agent/provider label does not change the total or the rank.

The existing security foundation (identity, passkeys, restricted recovery, source/device lifecycle,
isolated database roles and forced RLS, the bounded Ingest verification kernel, the Jobs runner and
default-off scheduler, the reviewed migration runner, deletion and retention, the fail-closed enable
gates, and the repository/CI/supply-chain policy) is reusable. The Codex-specific connector and the
single-provider scoring framing are the parts that must generalize.

A durable decision is required because this changes public contracts, the trust model, the
compatibility surface, and the set of trust boundaries, all of which are ADR review triggers under
[ADR README](README.md) and [security invariants](../architecture/SECURITY_INVARIANTS.md).

This record fixes the strategic direction and accounting semantics only. Each subsystem below
receives its own focused ADR before implementation: the multi-agent sync contract and readers,
optional MCP transport, provider verification, and token-total leaderboard presentation. This ADR
does not claim any of that code exists; implementation status remains separate in
[IMPLEMENTATION_STATUS.md](../IMPLEMENTATION_STATUS.md).

## Decision

Adopt the following direction, building on the existing foundation rather than restarting:

### 1. Agent-neutral token leaderboard

- Generalize the opaque Community source. The existing `CodexSource` concept becomes an
  **AgentSource**: an opaque, user-declared Community source attributed to one **agent provider**
  from a closed, reviewed supported enum (initially `codex`, `claude-code`, `opencode`, `qwen-code`,
  `cline`, `aider`; `kimi`, `gemini-cli`, `cursor`, `github-copilot`, and `windsurf` are recognized
  but not yet supported, awaiting a working reader). A provider enters the supported enum only with
  a reviewed bounded reader; additions follow the compatibility policy and an ADR when semantics
  change.
- The source remains opaque and self-declared. It is **not** represented as a verified provider
  account identity (extends VR-SOURCE-001). The public source count and Community label remain.
- Generalize the sync contract. `ConnectorSyncV1` becomes a multi-agent **UsageSyncV1** carrying one
  bounded `dailyTokenTotal` per date. The provider is not client-writable in a sync request: after
  device-signature verification, the server derives it from the immutable AgentSource reached
  through that device's source binding. A provider field in the body is rejected as unknown rather
  than trusted or reconciled. Provider-shaped raw fields do not cross the reader boundary. The
  server continues to compute dates, totals, ranks, trust tier, and season state; clients cannot set
  derived fields (VR-INGEST-001 unchanged).
- The public metric is `weeklyTokenTotal`: the direct integer sum of the profile's accepted daily
  token totals across every supported agent. No logarithm, active-day bonus, streak, price,
  currency, provider, model, cache, or cost multiplier changes that sum. Switching agents does not
  reset or partition a participant's rank.
- Per-profile ceilings (at most 32 lifetime sources, 64 active plus unexpired approved device
  authorities) remain public fail-safe ceilings. Request, entry, source, and numeric bounds remain
  anti-abuse controls, but there is no engagement-shaped scoring cap. An intermediate or public
  total outside the JSON safe-integer range is quarantined rather than wrapped, saturated, or
  displayed as an inexact value.

### 2. Canonical token accounting

Each provider uses a different tokenizer and may expose different usage fields. There is no honest
provider-neutral conversion to equal compute, money, energy, or work. The product therefore counts
**provider-reported tokens**, not normalized cost or standardized effort, and says so publicly.

Every supported reader has one reviewed, versioned mapping to `dailyTokenTotal`:

1. Prefer the provider's documented aggregate total when it exists.
2. Otherwise sum only documented, disjoint input/output components.
3. Never add a nested breakdown to a total that already includes it.
4. Deduplicate cumulative snapshots and repeated records before daily aggregation.
5. Reject an unknown or ambiguous schema; do not estimate from text, characters, prices, model
   names, or another provider's tokenizer.
6. Discard component fields after deriving the one integer total. Only that total enters
   `UsageSyncV1`.

The `UsageSyncV1` contract version and season metric version pin the accepted reader/accounting
revision for each provider. A semantic mapping change starts at a season boundary under a new
version; it never changes an open season mid-flight or reinterprets finalized source/day values.

The reviewed semantics that motivate the rule are:

- OpenAI Responses exposes `total_tokens`; `cached_tokens` is an input-token detail and
  `reasoning_tokens` is an output-token detail. Use `total_tokens` once.
- Anthropic Messages documents total input as
  `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`; add `output_tokens` once
  because these are documented disjoint components.
- Google Gemini exposes `totalTokenCount` as the aggregate across prompt, candidate, and thought
  tokens; cached-content and thought fields are details and are not added again.

These examples do not automatically approve a local reader. The reader still needs fixtures for the
exact local schema and agent version it parses. The immutable AgentSource provider selects the
reviewed reader/accounting compatibility entry on both client and server. Source creation seals that
provider under profile authority; sync cannot relabel it. Changing local reader configuration cannot
change the server-owned provider or make a mismatched/unsupported mapping admissible.

### 3. Hybrid honesty tiers

- Keep the two-tier model from ADR 0001 and make it multi-provider:
  - **Community** — self-reported usage from the thin client, an optional native connector, or an
    optional MCP transport, explicitly labeled "self-reported, not verified".
  - **Verified** — usage the server obtains directly from a provider's server-verifiable usage API
    with the user's OAuth consent, where such an API exists. Verified remains a disabled
    server-owned state until each provider integration is implemented, reviewed, and enabled
    server-side. If this ADR is accepted, **VR-TRUST-002 would be amended** from its current
    OpenAI-only scope to per-provider: each provider's Verified path would remain independently
    disabled until its own integration ships. While this ADR is Proposed, the active invariant in
    [SECURITY_INVARIANTS.md](../architecture/SECURITY_INVARIANTS.md) remains authoritative.
- A Community record can never be relabeled Verified by client assertion or heuristic. Verified
  ingestion stays unreachable until its provider ADR and integration ship.
- Because most agents expose no server-verifiable usage endpoint, the honest framing is explicit:
  Community rankings are bounded and labeled, not trusted; Verified is opportunistic per provider.

### 4. Thin client primary; MCP optional

- The **thin, auditable local client** from ADR 0069 is the primary Community path. A provider is
  supported only after its bounded reader proves the canonical accounting rules above against
  checked fixtures.
- An **MCP (Model Context Protocol) server** may be added as an optional agent-native submission
  transport. MCP tools define arbitrary input/output schemas; the protocol does not standardize
  provider usage discovery or token accounting. An MCP client may submit only the same `UsageSyncV1`
  total produced by a reviewed supported integration. MCP compatibility alone never makes an agent
  supported and never supplies a provider multiplier.
- MCP connection does **not** bypass pairing authority. Binding an MCP-reported AgentSource to a
  profile still requires the existing pairing approval with a fresh passkey step-up (VR-AUTH-001,
  VR-DEVICE-001, VR-DEVICE-002 unchanged).
- The optional MCP server is a transport over the existing bounded Ingest verification kernel and
  pairing applications; it reuses request verification, replay protection, source binding, and
  admission. It does not widen the set of fields a device may set.
- Native connectors, including the existing Rust connector for Codex, remain optional precision
  paths when a documented local surface is better than file reading.

### 5. Racing presentation of token rank

- The weekly token leaderboard remains the sole public ranking surface. Its cars, track, and
  position changes visualize the server-derived rank of each profile's `weeklyTokenTotal`.
- The presentation is provider-neutral: the same rank and car are used whether the total came from
  one agent or many. Provider contribution details remain private account data and are not a second
  public ranking surface.
- Existing CarRecipe contracts and deterministic pixel assets remain cosmetic. They cannot change
  token totals, trust tier, rank, authorization, or another participant's state (VR-CAR-001
  unchanged).
- EN/RU copy must call the metric **provider-reported token usage**, preserve the Community
  disclaimer, and explain that tokenizers differ. Visual racing language must not imply equal
  compute/cost, provider verification, unique-human identity, or valuable reward.
- Equal `weeklyTokenTotal` values share rank. Source count, provider, model, active days, streak,
  and CarRecipe are not tie breakers. Deterministic display order inside a shared rank has no
  competitive meaning.

### 6. Build on the existing foundation

- Reuse identity/passkeys/recovery, source/device lifecycle, isolated roles and forced RLS, the
  Ingest kernel and adapters, the Jobs runner and scheduler, the migration runner, deletion and
  retention, the fail-closed enable gates, and the repository/CI/supply-chain policy.
- Generalize, do not rewrite: the source table gains an immutable provider dimension; the sync
  contract gains a canonical daily total while the server derives provider from the verified
  source/device binding; the new `community_tokens_v1` metric replaces the engagement-shaped formula
  only for seasons created after cutover.

### 7. Sequencing

Delivery proceeds in this order, each step gated and default-off until reviewed:

1. Define `community_tokens_v1`, generalize the data model/contracts, and ship the thin client with
   the first reviewed readers, keeping Codex as the first compatibility path.
2. Migrate new seasons and the public contract to direct `weeklyTokenTotal` while preserving
   finalized legacy `community_v1` seasons.
3. Optionally add the MCP submission transport for integrations that can produce the exact same
   canonical usage contract.
4. Add the Verified tier for the first provider(s) with a server-verifiable usage API.

## Security and privacy consequences

New trust boundaries (to be added to [THREAT_MODEL.md](../security/THREAT_MODEL.md)):

- **Agent local storage ↔ thin client reader ↔ Ingest.** Untrusted side: mixed-content local files,
  databases, and provider-shaped usage fields. Trusted decision point: an exact-version bounded
  reader that emits only one canonical daily total. Principal failures: sensitive-content leakage,
  double counting, cumulative-snapshot replay, unsupported schema guessing, symlink/path escape,
  oversized input.
- **Optional MCP agent ↔ MCP server ↔ Ingest.** Untrusted side: arbitrary MCP-compatible agents and
  the entire reported payload. Trusted decision point: pairing-bound source authority plus the
  existing Ingest verification kernel. Principal failures: forgery, replay, cross-profile
  submission, an agent submitting for a source it does not own, unsupported accounting semantics,
  oversized input, floods.
- **Web/Auth ↔ provider usage API (Verified tier).** Untrusted side: provider OAuth callback and
  usage responses. Trusted decision point: minimal-scope OAuth, exact redirect, server-side usage
  fetch. Principal failures: token misuse, provider spoofing, over-scope, cross-account linking.

Planned data-map changes:

- Add the closed provider identifier only to AgentSource. `UsageSyncV1` carries no client-writable
  provider; Ingest derives it from the verified device/source binding.
- Add public `weeklyTokenTotal` only for an explicitly public participating profile. Exact daily,
  source, provider, and component values remain private.
- Add only the minimal pairing/source metadata needed by the MCP transport.
- Provider OAuth material remains Secret and server-only under each focused Verified integration.

Proposed new invariants (non-authoritative until this ADR is Accepted and the active invariant table
is changed through its review policy):

- **VR-TOKEN-001** — `community_tokens_v1` ranks the exact direct sum of accepted canonical token
  totals. A reader uses one documented aggregate or documented disjoint components, never counts a
  nested cache/reasoning/thought breakdown twice, and never applies a provider/model/cost
  multiplier. The server derives provider/accounting revision from the immutable AgentSource rather
  than a client field. Unknown or mismatched semantics fail closed.
- **VR-MCP-001** — The MCP server is a bounded transport over the existing pairing and Ingest
  verification path, not a usage meter; it cannot create profile authority, widen device scope, set
  derived fields, or make an unsupported agent supported, and an MCP-reported source binds to a
  profile only through passkey-approved pairing.
- **VR-PROVIDER-001** — Verified usage is obtained only through a reviewed provider API with minimal
  OAuth scope; a Community record can never become Verified by client assertion, and provider
  credentials/tokens never enter logs, fixtures, or the public repository.

Affected existing invariants and documents:

- VR-SOURCE-001 extends to a provider-attributed but still opaque AgentSource.
- VR-CODEX-001/002 remain true for the Codex connector; thin-client readers and the optional MCP
  path add similarly bounded surfaces that must not transmit prompts, conversations, repositories,
  credentials, or email.
- VR-INGEST-001/002 remain: the server computes derived fields and controls deadlines regardless of
  transport (connector, MCP, or provider API).
- VR-ABUSE-001 continues to bound the implemented `community_v1` score. The focused
  `community_tokens_v1` ADR must amend it so anti-abuse bounds quarantine invalid totals without
  transforming admitted totals into engagement scores.
- VR-CAR-001 remains the closed cosmetic contract for the leaderboard's racing presentation.
- The compatibility matrix, public API reference, threat model, abuse cases, and privacy data map
  must be updated as each subsystem ADR ships.

Residual risk that is accepted, not solved:

- A computer owner can still fabricate Community usage from any agent. Neither a thin reader,
  signature, nor MCP proves honest local execution. Containment is explicit: bounded, labeled,
  reward-free, source-count visible, anomalous input quarantined, and no claim that different
  provider tokenizers represent equal compute or cost.

## Alternatives considered

- **Codex-only leaderboard (status quo).** Rejected: the product direction explicitly broadens to
  multiple agents.
- **MCP as the universal meter.** Rejected: MCP standardizes tool invocation, not provider usage
  telemetry. Accepting arbitrary agent-declared field semantics would be simpler to integrate but
  less comparable and easier to double count.
- **Per-agent native connectors only.** Considered for tighter control and potentially more accurate
  local reads. Rejected as the sole path because it scales poorly across many agents; retained as an
  optional precision path alongside the thin client.
- **Cost-, model-, character-, or tokenizer-normalized points.** Rejected. Price weighting drifts
  over time and changes the product into a spend ranking; character normalization would require
  reading prohibited content; model/provider coefficients are subjective and easy to manipulate.
  Direct provider-reported tokens are less ambitious but auditable.
- **Logarithmic score and active-day bonus.** Rejected for the new metric because they can rank a
  participant with fewer tokens above one with more tokens. The implemented legacy formula remains
  only for historical compatibility.
- **Verified-only counting.** Considered for honesty. Rejected because most agents expose no
  server-verifiable usage endpoint, which would make the leaderboard nearly empty; adopted instead
  as the opportunistic upper tier of a hybrid.
- **Neutral non-racing presentation.** Considered. Rejected because the existing racing
  presentation, CarRecipe contract, EN/RU themes, and deterministic renderer already provide a
  coherent identity for visualizing rank without changing the scoring or trust model.
- **Fresh rewrite.** Rejected: the security foundation is sound and largely reusable; generalizing
  it preserves verified work and avoids re-introducing risk.

## Migration and rollback

- This is a planning decision; no stored data changes yet. Subsystem ADRs define their own migration
  and rollback.
- The source table's immutable provider dimension and the `UsageSyncV1` contract are additive.
  Existing Codex sources map to provider `codex`; source creation writes one reviewed enum value,
  and submission resolves it only through the verified device/source binding. Existing
  `ConnectorSyncV1` remains accepted during a bounded compatibility window before deprecation, with
  generated-contract drift checks enforcing the transition.
- Existing and finalized `community_v1` seasons keep their immutable `weeklyScore`; they are not
  rewritten. A cutover creates new seasons under `community_tokens_v1` and a versioned public
  contract exposing `weeklyTokenTotal`. Mixed metric versions are never compared in one rank.
- Each new capability (multi-agent sync, token-total public contract, optional MCP, and each
  Verified provider) ships behind its own exact default-off enable gate, consistent with the
  existing fail-closed gate pattern, so it can be disabled independently without affecting returning
  login, recovery, deletion, or existing Community ingest.
- Rollback of this direction is forward-fix or supersession: mark this ADR `Superseded` by a later
  ADR rather than rewriting it; disable the relevant gates; and keep the generalized contract
  backward-compatible with existing Codex data.

## Verification

Before each subsystem is called complete, its ADR must define positive, negative, compatibility,
concurrency, recovery, privacy, and operational evidence. At the direction level, the bar includes:

- Accounting: table-driven reader fixtures prove aggregate-vs-component semantics, cache and
  reasoning/thought fields are counted once, cumulative snapshots and replayed records are
  deduplicated, unknown schemas fail closed, and no sensitive local field reaches the payload.
- Multi-agent: provider enum confinement; `UsageSyncV1` reject-unknown and numeric-bound tests;
  explicit rejection of a client provider field; proof that Ingest derives the provider and
  accounting revision from the exact immutable AgentSource reached through the verified device
  binding; wrong-source, unsupported-revision, and attempted provider-relabel tests; backward
  compatibility with existing Codex sources and `ConnectorSyncV1`; one profile rank derived from the
  exact direct sum across every accepted provider.
- Metric migration: finalized `community_v1` rows remain byte-for-byte stable; a new season uses
  only `community_tokens_v1`; overflow is quarantined; equal totals share rank; no
  active-day/source/model tie breaker; the public value is a JSON safe integer; a reader mapping
  revision cannot change mid-season.
- MCP: pairing-required binding; an MCP client cannot submit for a source it does not own;
  cross-profile and replay denial; oversized-input and flood limits; no prompt/credential/email
  reflection in output or logs.
- Verified tier: minimal OAuth scope; exact redirect; server-side fetch; a Community record cannot
  be relabeled Verified; provider token never persisted in logs/fixtures/repository.
- Presentation: the public position, `weeklyTokenTotal`, and car are derived from the same canonical
  provider-independent ranking; a provider label or CarRecipe cannot change total/rank; EN/RU
  explains self-reporting and tokenizer differences; keyboard, screen-reader, contrast,
  reduced-motion, and table-view evidence remains.
- Cross-cutting: updated threat model boundaries, abuse cases, privacy data map classes, and
  security invariants; generated-contract and documentation drift checks pass.

## References

- [PROJECT_PLAN.md](../PROJECT_PLAN.md) — canonical plan updated by this direction.
- [ADR 0001](0001-community-trust-tier.md) — Community-only launch and disabled Verified tier.
- [ADR 0002](0002-opaque-multi-source-aggregation.md) — opaque multi-source profiles with one cap.
- [ADR 0005](0005-enum-only-car-recipe.md) — enum-only deterministic car customization.
- [SECURITY_INVARIANTS.md](../architecture/SECURITY_INVARIANTS.md) — invariants extended here.
- [THREAT_MODEL.md](../security/THREAT_MODEL.md), [ABUSE_CASES.md](../security/ABUSE_CASES.md),
  [PRIVACY_DATA_MAP.md](../security/PRIVACY_DATA_MAP.md) — updated alongside this direction.
- Official OpenAI Responses usage, Anthropic token-counting/cache, and Google Gemini `UsageMetadata`
  documentation, reviewed 2026-07-23 for aggregate/component semantics. Their documentation hosts
  are not all on the repository's reviewed external-link allowlist, so this ADR records the field
  semantics without adding links or weakening that policy.
- The Model Context Protocol (MCP) tools specification, reviewed 2026-07-23 for its arbitrary tool
  input/output schemas and absence of standardized token telemetry. Its documentation host is not
  yet on the reviewed external-link allowlist and is intentionally not hyperlinked until that policy
  review happens.
