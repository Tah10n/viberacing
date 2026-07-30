# Clean database bootstrap

## Status

This directory is the first-release empty-database bootstrap for the agent-neutral
`provider_reported_tokens_v1` platform. The unreleased 43-step Codex/score history was removed
because no shared or production database used it. There is no revision 0044, compatibility wrapper,
data cutover, or legacy backfill.

This directory contains 7 SQL-first revisions. `manifest.json` is their sole ordered inventory and
SHA-256 source. A revision is logical rather than artificially small:

1. `0001_roles_schemas_and_identity.sql` — non-login roles, private/API schemas, exact ledger,
   immutable numeric GitHub identity, profile lifecycle, default-deny grants, and forced RLS.
2. `0002_authentication_passkeys_and_recovery.sql` — optional invites, sessions, passkeys,
   challenges, recovery, login, private profile controls, and immediate deletion lock-down.
3. `0003_agent_accounts_installations_and_pairing.sql` — closed provider registry, immutable
   accounting revisions, multiple AgentAccounts per profile, installation identity, account-scoped
   device keys, bounded batch pairing, one-assertion approval, fallback-code admission, and
   lifecycle controls.
4. `0004_usage_ingest_replay_and_idempotency.sql` — origin/device replay, immutable observations,
   long-lived idempotency, exact `numeric(30,0)` account/day totals, coalesced dirty-season work,
   and hash-chained ranking events in one atomic submission.
5. `0005_seasons_ranking_and_snapshots.sql` — UTC Monday-Sunday seasons, exact weekly profile and
   provider sums, shared ranks, deterministic display order, immutable pages/profile summaries,
   last-good publication pointers, bounded refresh retry, and finalization.
6. `0006_retention_deletion_admin_and_audit.sql` — bounded retention, profile-deletion jobs and
   purge, terminal evidence cleanup, Admin invitation/audit state, and the closed Jobs catalog.
7. `0007_car_recipes.sql` — closed CarRecipe proposal, activation, rejection, expiry, and public
   active-recipe projection.

All seven revisions run in explicit transactions under the fixed migration advisory lock and insert
one exact ledger row. Once any revision reaches a shared environment it is immutable; repair is a
new reviewed forward revision. There is no generic down migration.

## Data and trust model

- One positive immutable `github_user_id` creates at most one profile. Anonymous profiles do not
  exist.
- One profile may own multiple providers and multiple AgentAccounts for the same provider.
- One AgentAccount may have multiple independent device keys. Cumulative account/day replacement
  prevents devices from summing the same domain twice.
- Provider, accounting revision, scope, backfill window, trust tier, and season are server-owned.
- Competitive scope is only non-overlapping `agent_account`. Ambiguous aggregate domains fail
  closed.
- Community totals are self-reported. No database row turns them into provider-verified usage.
- Codex is `recognized`, not `supported`, and its revision is disabled for new accounts by default.
  Disposable tests explicitly promote it to exercise pairing and ingestion. All other catalog
  providers remain recognized with no enabled accounting revision.

## Capability boundary

`viberacing_private` is owner-only. All 36 private tables enable and force row-level security with
an owner-only policy. Runtime roles have no private table or sequence grants. They receive only
schema usage and explicit execution of reviewed `SECURITY DEFINER` procedures whose search path is
`pg_catalog, pg_temp`.

| Role                | Capability boundary                                                                  |
| ------------------- | ------------------------------------------------------------------------------------ |
| `viberacing_owner`  | Reviewed migrations and procedure implementations only                               |
| `viberacing_web`    | Identity/auth, private account, pairing approval, lifecycle, CarRecipe, public reads |
| `viberacing_ingest` | Device/material lookup and one atomic usage submission                               |
| `viberacing_jobs`   | Thirteen fixed season/snapshot/retention/deletion maintenance functions              |
| `viberacing_admin`  | One bounded invitation plus committed audit capability                               |
| `PUBLIC`            | None                                                                                 |

Deployment login principals and passwords are environment-owned and absent from tracked SQL. The
migration login must be a distinct `NOINHERIT` member of only `viberacing_owner`; each runtime login
must have exactly one runtime group and never owner membership.

## Important invariants

- Profile creation and concurrent OAuth convergence are keyed by numeric GitHub ID, not handle.
- WebAuthn verification is application work; PostgreSQL consumes only exact bounded challenges after
  verification.
- Pairing candidates bind provider/reader/revision/scope/account key to the signed manifest.
- A single fresh passkey assertion settles the whole bounded candidate batch atomically.
- Invalid signature/body/date/replay/idempotency input leaves no partial persistent usage state.
- Exact decimal strings are parsed only by PostgreSQL and never pass through JavaScript `Number`.
- Rank depends only on exact weekly token total. Equal totals share rank; display order uses stable
  public tie breakers.
- Public Web procedures read immutable snapshots only and never aggregate raw usage.
- Refresh failure preserves the last-good pointer; finalized snapshots are immutable.
- Profile deletion hides the profile and revokes browser, recovery, installation, AgentAccount, and
  device authority before Jobs can physically purge it.

## Migration and verification workflow

1. Read the root and database `AGENTS.md`, accepted ADRs, threat/abuse model, privacy map, and
   applicable runbook.
2. Change the smallest logical revision; do not recreate pre-release history.
3. Preserve bounded lock/statement time, exact role, fixed search path, forced RLS, and narrow
   grants.
4. Update the revision digest in `manifest.json`.
5. Add positive, negative, race, grant, restore, and failure-path evidence.
6. Run:

```text
corepack pnpm run test:database-check
corepack pnpm run check:database
corepack pnpm run test:database:integration
corepack pnpm run test:migrate:postgres-integration
```

The default-off migration runner loads only the exact manifest, revalidates every digest, probes one
narrow verified-TLS login, takes the fixed session lock, rereads an exact ledger prefix, applies
only missing reviewed bodies, and requires the complete seven-row ledger. It accepts no selected
path, SQL, revision, repair, or rollback.

Docker-backed gates use disposable Compose projects and synthetic data. They prove clean creation,
forced RLS, narrow grants, identity/auth semantics, batch pairing, exact-decimal multi-device
accounting, 10,001-profile snapshot scale, retention/deletion behavior, controller convergence, and
two current-snapshot restores preserving a completed deletion, independent revoked-device state, and
one finalized snapshot locally. They do not prove production credentials, a deployed TLS route,
staging rollout, stale-backup deletion replay, monitoring, representative capacity, RPO/RTO, or
deployment.
