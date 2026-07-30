# Roadmap

This roadmap follows
[ADR 0076](docs/decisions/0076-clean-agent-account-provider-reported-token-ranking.md). The
[implementation ledger](docs/IMPLEMENTATION_STATUS.md) is authoritative for evidence. No item
implies a supported provider, released connector, deployed service, production database, or
real-user result.

## Local clean foundation

## Stage 1 — Clean database bootstrap

Status: implemented locally; external database evidence pending.

- AgentAccount is the accounting principal; immutable GitHub numeric ID is the sole profile
  identity.
- Anonymous ownership and the unreleased source/score compatibility surface are absent.
- The database is a seven-revision empty bootstrap with forced RLS, narrow roles, exact procedures,
  migration serialization, deletion, retention, and current-snapshot restore evidence.

## Stage 3 — Atomic usage accounting

Status: implemented locally; hosted Edge/Ingest evidence pending.

- Multiple same-provider AgentAccounts, installations, independent account-scoped devices, batch
  create/attach/skip, one-assertion approval, and fallback code exist locally.
- `UsageSyncV1` uses exact decimal strings, PostgreSQL-clock UTC/backfill, replay-first durable
  admission, long-lived idempotency, cumulative multi-device accounting, ranking events, and
  coalesced dirty work in one atomic transaction.
- `provider_reported_tokens_v1` uses exact weekly sums, shared ranks, immutable pages/profile
  summaries, last-good publication, and finalization.
- The canonical manifest contains 18 schemas, four policies, and seven operations. The sole usage
  route is `POST /v1/usage`; public reads are snapshot-only.
- Edge, Ingest, Web, Jobs, Scheduler, Migration, and their independent default-off decisions have
  local deterministic/disposable evidence.

## Stage 6 — Thin multi-agent connector

Status: implemented as an unreleased provider-neutral local connector; supported provider and
release evidence pending.

- The provider-neutral connector implements native credentials, batch connect, sync, status, doctor,
  account lifecycle, disconnect, and forget-local.
- The GitHub-first Web product implements the synthetic public experience and local enrollment,
  account, pairing, deletion, and CarRecipe slices.
- Checked migration, restore, containment, deletion, staging-preparation, publication, and
  release-candidate procedures exist.

## Stage 9 — Final evidence and review

Status: in progress until the complete focused/release/PostgreSQL/Rust/platform matrix and final
tracked/untracked review pass on the final commit.

## Next: supported provider evidence

- Perform one explicitly authorized clean-machine real-account Codex read against the exact admitted
  version without leaking prohibited data.
- Prove one same-artifact composed connect → browser batch review → fresh-passkey approval →
  persisted credentials → first/repeat sync → exact account/day → published snapshot result.
- Revalidate immutable accounting semantics, account-domain/overlap behavior, privacy sentinels,
  drift rejection, and failure cleanup.
- Promote provider/revision state only in the same reviewed change that contains the complete
  evidence and explicit support declaration.
- Apply the same evidence bar independently to any additional provider.

## Next: connector release evidence

- Run protected builds for the declared Windows/macOS/Linux target matrix.
- Produce and verify checksums, SPDX SBOMs, provenance/attestations, and platform-native signatures
  where applicable.
- Prove clean-machine install, credential-store behavior, update, rollback, uninstall, and
  server-revocation lifecycle per supported target.
- Publish no official package until the supported provider/platform/version matrix is exact.

## Next: hosted staging evidence

- Provision certificate-compatible PostgreSQL and four distinct least-privileged logins.
- Run the checked one-shot migration and record the seven-row ledger, 35 forced-RLS tables, grants,
  TLS, lock, and cleanup.
- Deploy Web closed, then validate snapshot reads separately.
- Deploy Ingest and Edge closed with real protected secret delivery and all rate-limit bindings;
  prove direct-origin non-mutation before any coordinated synthetic usage enablement.
- Start exactly one Jobs scheduler and prove cadence, signals, monitoring, failure/retry, and
  containment.
- Rehearse backup/restore, deletion, stale-backup handling, incident closure/recovery, rollback, and
  capacity with redacted evidence.

## Next: participant beta readiness

- Complete the Admin issuer/authorization/audit host or choose another reviewed invite path.
- Verify real GitHub OAuth, WebAuthn authenticators, protected cookies/secrets, distributed recovery
  attempt controls, notifications, and operational retention/deletion.
- Add monitored abuse controls and a real private conduct/reporting channel before opening external
  participation.
- Keep rankings reward-free and Community-labeled; never make rank an authorization or valuable
  benefit.

## Public source publication

Status: public source-only baseline published; external participation closed.

- Maintainer identity, matching CODEOWNERS, private vulnerability reporting, restricted
  interactions, and the active protected `main` ruleset have readback evidence.
- The published baseline completed hosted CI; every later revision still needs its own reviewed PR,
  required checks, history/staged-public/publication gates, and hosted policy readback.
- External-account vulnerability-report submission/notification and a private conduct channel remain
  unproven. Do not open participation until both have reviewed evidence.

## Explicitly deferred

- optional MCP submission;
- any Verified tier without a reviewed server-side provider integration;
- provider/model/price normalization;
- rewards, prizes, authorization, or valuable rank privileges;
- production data migration or legacy protocol/history compatibility; and
- deployment, capacity, monitoring, signing, public beta, or official connector claims without the
  corresponding external evidence.
