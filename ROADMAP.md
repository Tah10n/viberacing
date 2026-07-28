# Vibe Racing roadmap

This roadmap implements the clean pre-release architecture accepted in
[ADR 0076](docs/decisions/0076-clean-agent-account-provider-reported-token-ranking.md). Current
proof is tracked in [IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md). No row below implies
a released connector, deployed service, production database, supported provider, or real-user
result.

## Stage 0 — Clean architecture contract

- Accept AgentAccount as the accounting principal.
- Reject anonymous identity and legacy compatibility.
- Fix exact direct-token, UTC, deduplication, trust, atomic-Ingest, privacy, snapshot, and release
  invariants.
- Update threat, abuse, and privacy maps.

## Stage 1 — Clean database bootstrap

- Replace all 43 pre-release revisions with one small reviewed bootstrap catalog.
- Preserve owner separation, forced RLS, narrow runtime roles, exact procedures, restore, migration
  serialization, and cleanup evidence.
- Prove empty-database creation and delete the old catalog, old manifest, and count assertions.

## Stage 2 — Identity, AgentAccounts, installations, and batch pairing

- Keep one immutable GitHub numeric ID per profile and required primary passkey.
- Add provider/accounting registries, multiple same-provider AgentAccounts, installations,
  independent account-scoped devices, create/attach/skip batch transactions, one-assertion approval,
  and fallback code.
- Prove concurrency, IDOR, replay, terminal cleanup, and no device/account multiplication.

## Stage 3 — Atomic usage accounting

- Add exact decimal-string `UsageSyncV1`, immutable observations, one AgentAccount/day cumulative
  total, PostgreSQL-clock UTC/backfill, monotonic updates, replay, long-lived idempotency, dirty
  outbox, and audit.
- Prove invalid body/signature leaves zero persistent state and every accepted mutation is one
  transaction.

## Stage 4 — Direct seasons and snapshots

- Use only `provider_reported_tokens_v1`.
- Sum exact unique AgentAccount/day totals and share ranks for equal totals.
- Build immutable pages, top-32 race payload, and profile summaries from the dirty outbox.
- Prove 10,000-profile scale, last-good preservation, finalization, visibility, ETag, 304, shared
  cache, and private `no-store`.

## Stage 5 — Final contracts, Edge, and Ingest

- Keep only the final ten V1 schemas and four public routes.
- Remove every `/v1/community/*` route, score contract, generated artifact, and wrapper.
- Enforce exact Edge framing/HMAC and Ingest verification order before the atomic transaction.

## Stage 6 — Thin multi-agent connector

- Add one installation identity, bounded built-in readers, automatic discovery, privacy-only output
  types, sentinel fixtures, and account-scoped native-store keys.
- Support only providers with exact local schema/accounting evidence; keep the rest recognized or
  disabled with precise gaps.
- Implement connect, sync, status, doctor, account lifecycle, disconnect, and forget-local.

## Stage 7 — GitHub-first Web product

- Minimize join to invite if configured, GitHub OAuth plus PKCE, handle, primary passkey, connect.
- Implement one-passkey batch approval and ranking-first private dashboard.
- Replace public live calculation with semantic snapshot leaderboard/profile routes and one lazy
  top-32 race payload.
- Remove simulator, Source labels, points/logarithm language, and pre-value cosmetic choices.

## Stage 8 — Jobs, operations, and release preparation

- Run only fixed reviewed refresh/finalization/retention/deletion commands with default-off
  scheduling, no overlap, bounded settlement, and restart-safe state.
- Update migration, restore, containment, deletion, snapshot failure, and connector release
  runbooks.
- Add secretless CI plus protected Windows/macOS/Linux package declarations, checksums, SBOM,
  provenance, signing policy, and clean-machine lifecycle gates without claiming hosted success.

## Stage 9 — Final evidence and review

- Run focused, full development, release, history, dependency, Rust, Docker/PostgreSQL, scale,
  packaging, staged-public, and diff checks.
- Review every tracked and untracked file, generated artifact, role/grant, route, schema, reader
  support claim, EN/RU string, and evidence statement.
- Fix all findings before completion.

## Explicitly deferred

- optional MCP submission;
- any Verified provider without a real reviewed server-side integration;
- subjective provider/model/price normalization;
- rewards, prizes, authorization, or valuable rank privileges;
- production data migration or legacy protocol/history compatibility;
- public beta, deployment, monitoring, capacity, signing, or official connector claims without
  external hosted evidence.
