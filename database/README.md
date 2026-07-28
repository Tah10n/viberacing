# Clean database bootstrap

## Status

This directory is the first-release, empty-database bootstrap for the agent-neutral
`provider_reported_tokens_v1` platform. The prior 43-step pre-release history has been removed. No
production or shared database used that history, so there is no data migration, backfill, cutover,
compatibility wrapper, or revision 0044.

The catalog is intentionally small and logical. It currently contains the identity, authentication,
agent-account/pairing, atomic usage-accounting, and snapshot-ranking layers. The remaining
first-release retention/Admin and CarRecipe layers are added to this same catalog as their
end-to-end slices land. The final inventory is bounded to seven revisions.

## Current catalog

- `0001_roles_schemas_and_identity.sql` creates the closed private/API schemas, exact migration
  ledger, GitHub-bound profile model, immutable numeric identity, profile lifecycle guards,
  forced-RLS policies, and default-deny grants.
- `0002_authentication_passkeys_and_recovery.sql` creates optional invite authority, bounded
  sessions, passkeys, WebAuthn challenges, recovery-code storage, GitHub profile open/create,
  initial-passkey activation, returning-passkey login, private profile/visibility controls, and
  immediate deletion lock-down.
- `0003_agent_accounts_installations_and_pairing.sql` creates the closed provider catalog, immutable
  accounting revisions and AgentAccounts, installation identity, independent account-scoped device
  keys, digest-bound batch pairing, one-assertion atomic decisions, bounded fallback-code attempts,
  activation, inventory, and lifecycle controls. Providers remain `recognized` until their reader
  evidence is complete.
- `0004_usage_ingest_replay_and_idempotency.sql` adds the non-mutating Ingest material read and one
  atomic Community submission procedure. Exact decimal strings become `numeric(30,0)` only in
  PostgreSQL; origin/device replay, long-lived idempotency, monotonic account/day totals, immutable
  observations, coalesced dirty-season work, and hash-chained ranking events settle together or roll
  back together.
- `0005_seasons_ranking_and_snapshots.sql` adds explicit UTC Monday-Sunday Community seasons, exact
  direct-token profile/provider totals, deterministic shared ranks and display order, immutable
  versioned pages/profile summaries, a last-good publication pointer, coalesced bounded retry,
  snapshot-only Web reads, and Jobs-only ensure/refresh/finalize capabilities. Season finalization
  is the authoritative direct-mutation closure; the checked scheduler is responsible for invoking it
  after the fixed 48-hour grace deadline.
- `manifest.json` is the sole ordered inventory and SHA-256 source used by the static checker and
  default-off migration runner.

Planned catalog names are architectural slots, not claims of current implementation:

1. roles, schemas, and identity;
2. authentication, passkeys, and recovery;
3. agent accounts, installations, devices, and batch pairing;
4. atomic usage, replay, idempotency, and ranking events;
5. seasons, direct-token ranking, and immutable snapshots;
6. retention, deletion, Admin, and audit maintenance;
7. CarRecipe persistence.

## Trust and capability boundary

`viberacing_private` is owner-only. Every private table enables and forces row-level security with
an owner-only policy. Runtime roles receive no table or sequence grants. They receive only `USAGE`
on `viberacing_api` and explicit execution of fixed `SECURITY DEFINER` procedures with
`search_path = pg_catalog, pg_temp`.

The cluster bootstrap creates these non-login, non-owner runtime groups:

| Role                | Current capability                                                                |
| ------------------- | --------------------------------------------------------------------------------- |
| `viberacing_owner`  | Owns reviewed schema and procedure implementations; migration runner only         |
| `viberacing_web`    | GitHub identity, passkey/session, private profile, visibility, and deletion calls |
| `viberacing_ingest` | Active-device material read and one atomic Community usage submission             |
| `viberacing_jobs`   | Ensure current season, refresh one dirty season, and finalize one due season      |
| `viberacing_admin`  | One bounded optional-invite issuance call                                         |
| `PUBLIC`            | None                                                                              |

Deployment login principals are environment-owned. They are not declared or given passwords in
tracked SQL. The protected migration login must be a narrow `NOINHERIT` member of only
`viberacing_owner`; runtime logins must each have exactly one runtime group and never owner
membership.

## Identity and authentication invariants

- `github_user_id` is positive, unique, and immutable. There is no anonymous profile state.
- A concurrent repeated OAuth completion converges on one profile for that numeric GitHub ID.
- Handle uniqueness is independent from identity; a collision fails without rebinding identity.
- New profiles remain hidden and `enrolling` until a verified initial passkey is registered.
- WebAuthn verification remains application work. Database calls only consume the exact bounded
  challenge after the application verifies RP ID, origin, challenge, context, signature, and user
  verification.
- Session and challenge verifiers are stored only as 32-byte keyed digests.
- Profile deletion immediately forces hidden state and revokes browser/passkey authority. Later
  catalog layers add installation/account revocation and bounded physical purge.
- Generic database procedure failures expose neither row existence nor protected values.

## Migration workflow

1. Read `AGENTS.md`, the accepted ADRs, threat/abuse model, privacy map, and relevant runbook.
2. Change only the next logical first-release layer. Do not recreate artificial historical steps.
3. Keep one explicit transaction, bounded lock/statement time, the fixed advisory lock, and
   `SET LOCAL ROLE viberacing_owner`.
4. Insert the exact revision/name ledger row, calculate SHA-256, and update the sole manifest.
5. Add semantic positive, negative, race, grant, RLS, restore, and failure-path evidence.
6. Run static checks, disposable PostgreSQL gates, the complete affected workspace gates, and a
   staged public-data/secret review.

The migration runner accepts no caller-selected path, SQL, revision, repair, or rollback. It loads
only `database/migrations/manifest.json` and the exact digest-bound inventory, probes the narrow
verified-TLS login, takes one session advisory lock, rereads an exact ledger prefix, applies missing
reviewed bodies, and requires the complete ledger. Concurrent controllers therefore converge without
making migration SQL broadly idempotent.

Focused commands:

```text
corepack pnpm run test:database-check
corepack pnpm run check:database
corepack pnpm run test:database:integration
corepack pnpm run test:migrate:postgres-integration
```

The PostgreSQL tests own disposable Compose projects and ephemeral storage. They prove clean
creation, forced RLS, narrow grants, identity/auth semantics, concurrent GitHub convergence,
exact-decimal accounting, deterministic multi-account ranking, snapshot failure recovery,
current-snapshot restore, and migration-controller overlap locally. They do not prove a production
credential, deployed TLS route, staging rollout, production backup/restore, monitoring, capacity, or
deployment.

## Restore and rollback boundary

Before any shared environment exists, a disposable database may be dropped and rebuilt from this
catalog. Once a revision reaches a shared environment it is immutable and repair is forward-only.
There is no generic down migration.

The checked current-snapshot rehearsal is local synthetic evidence. It does not authorize restoring
a shared, production, pre-deletion, or real-user database and does not prove stale-backup deletion
replay, external backup encryption, cluster-role recreation, or an RPO/RTO.
