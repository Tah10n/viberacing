# Database guidance

Read the root guidance, `database/README.md`, ADR 0076, security invariants, threat/abuse model,
privacy map, and applicable migration/restore/deletion runbook before editing this directory.

## Boundary

The database is a clean seven-revision empty-database bootstrap. There is no production or
compatibility population. Do not recreate removed pre-release tables, procedures, routes, wrappers,
dual writes, cutovers, or backfills.

After any revision is intentionally used in a shared environment, it is immutable. Repair is a new
reviewed forward revision.

## Roles and private state

- `viberacing_owner` is the sole schema/table/function owner.
- Runtime groups are `NOLOGIN` and receive no private table or sequence privileges.
- All private tables enable and force RLS with owner-only policies.
- Runtime capability exists only through reviewed, parameterized `SECURITY DEFINER` functions with
  fixed `pg_catalog, pg_temp` search paths.
- Deployment logins are external, distinct, `NOINHERIT`, non-owner, and members of exactly one
  group.
- Probe login identity, memberships, search path, capability, and verified TLS before role
  assumption; reset before reuse.

Never widen grants or disable RLS to make an integration pass.

## Identity and authority

- Use immutable positive numeric GitHub ID as the profile identity key.
- Preserve OAuth convergence and handle immutability/uniqueness rules.
- Database challenges consume already verified application proofs; SQL does not perform WebAuthn.
- Session, passkey, recovery, pairing, device, and critical-action authority remain purpose-bound,
  single-use, and time-bounded.
- Profile deletion lock-down must revoke sessions, recovery, installations, AgentAccounts, devices,
  and pending authority before returning.

## AgentAccount and accounting

- AgentAccount is the counted domain. Installation/device multiplicity cannot multiply usage.
- Provider, immutable account key, accounting revision, scope, and trust tier are server-owned.
- Labels are private metadata and never identity.
- Batch pairing is all-or-nothing under one exact ordered passkey decision.
- Device authority is AgentAccount-scoped and independently revocable.
- Token strings parse directly to `numeric(30,0)`; never introduce floating point.
- PostgreSQL clock owns UTC date/backfill/season rules.
- Consume durable origin replay before device lookup and idempotency.
- Any rejected request must roll back nonce, idempotency, observation, account/day, ranking event,
  and dirty-season state together.
- Cumulative device/account/day replacement must not double count multiple devices.

## Ranking and public projection

- Only `provider_reported_tokens_v1` is competitive.
- Rank is descending exact weekly total; equal totals share rank.
- Provider/account/device/install/model/price/streak/CarRecipe/display order cannot affect rank.
- Build complete immutable pages/profile summaries before atomically publishing a pointer.
- Preserve last-good publication on refresh failure.
- Finalized snapshots are immutable.
- Public functions read snapshots only and expose no raw usage, private IDs/labels, exact receipt
  times, or internal state.

## Retention, deletion, and restore

- Jobs functions take no arbitrary SQL/date/account/batch authority beyond their reviewed bounded
  contracts.
- Keep deletion purge bounded and block it while public snapshot safety is unresolved.
- Preserve the completed terminal deletion UUID for 30 days, then remove only through the reviewed
  cleanup capability.
- Backup/restore changes must preserve ledger/digests, provider defaults, RLS/grants, revoked
  authority, deletion terminal state, and finalized snapshots.
- Current-snapshot restore evidence is not stale-backup replay, production backup, or RPO/RTO proof.

## Verification

Update `database/migrations/manifest.json` after an intentional revision edit, then run:

```text
pnpm run check:database
pnpm run test:database-check
pnpm run test:database:integration
pnpm run test:migrate:postgres-integration
```

Add or update runbook/checker tests when migration, restore, retention, or deletion behavior
changes. PostgreSQL tests must cover positive and negative state, roles/grants, concurrency, exact
stored values, no-partial-mutation failure, and cleanup. Use synthetic data only.
