# ADR 0004: Cloudflare ingress plus service and database capability isolation

- Status: Accepted (database roles and server-only score adapter; network services pending)
- Date: 2026-07-14
- Decision owners: Edge, Web/Auth, Ingest, Jobs, Database, and Operations
- Supersedes: None
- Superseded by: None

## Context

Public reads, browser identity flows, high-frequency signed ingestion, background maintenance, and
administration have different data and authority. A single public origin and schema-owning database
role would turn one endpoint compromise into profile, usage, admin, migration, and finalized-season
control.

Cloudflare request shaping is useful only if clients cannot bypass it by discovering a Railway
origin or spoofing forwarding headers.

## Decision

Use Cloudflare as the only intended public ingress. The edge creates a short-lived proof bound to
method, path, body hash, and time. Railway verifies proof and replay before application work and
trusts client-forwarding headers only through that authenticated chain.

Deploy Web/Auth, Ingest, and Jobs as separate principals. Ingest has no OAuth, passkey, admin,
signing, migration, or deployment credentials. It validates a bounded connector contract and can
only execute a narrowly owned usage-submission procedure.

Use separate non-owner PostgreSQL roles for profile/auth, ingest procedure, maintenance jobs, and
migrations. Runtime roles never own schema. Admin uses a separate origin, Access policy, application
role, fresh passkey, reason, and append-only audit.

## Security and privacy consequences

The design contains a compromised public surface by removing unrelated credentials and grants.
Origin proof complements, but does not replace, device/browser authentication. Public infrastructure
addresses are not treated as secrets; direct-origin rejection remains the control.

More services and roles increase deployment, migration, observability, and incident complexity. Logs
and metrics must be correlated through non-sensitive request IDs without copying raw payloads.

## Alternatives considered

- **One monolith and one database owner:** operationally simpler but creates excessive blast radius
  and cannot make the ingest boundary credible.
- **One codebase/process with logical modules:** module boundaries help readability but are not
  runtime capability boundaries.
- **Rely on an undisclosed Railway hostname:** rejected because obscurity is not origin
  authentication.
- **IP allowlist only:** insufficient under changing platform egress and proxy/header assumptions.
- **Separate physical databases for every capability:** stronger isolation but unnecessary for MVP
  if PostgreSQL roles, procedures, constraints, and tests are correct; revisit with scale/risk
  evidence.

## Migration and rollback

Local development may use one disposable PostgreSQL instance, but creates the same logical roles and
grants before runtime code. Production migration credentials are deploy-time only.

If an edge or service rollout fails, roll back the exact deploy artifact or disable the narrow
feature. Do not restore traffic by accepting missing proof, trusting arbitrary forwarding headers,
or granting broader database rights.

## Verification

- Direct-origin, missing/expired/replayed/body-mismatched proof and spoofed-forwarding tests.
- Service environment inventory proving absence of unrelated credentials.
- Every runtime role attempts every allowed and forbidden database capability.
- SQL injection, procedure ownership/search path, transaction, concurrency, and finalized-season
  tests.
- Current PostgreSQL evidence gives Ingest exactly device-verification lookup and Community
  submission, gives Jobs exactly bounded expired ingest-state cleanup plus scoring refresh and
  finalization, gives Web only identity procedures plus the bounded active-only public score
  projection, denies all runtime roles direct private-table access, and proves cross-role procedure
  denials. ADR 0011 adds a dedicated bounded Web pool and verifies the effective role, distinct
  narrow login, exact membership, database capability, search path, and read-only state before each
  fixed score query. ADR 0013 later adds local HTTP score delivery around that adapter. ADR 0015
  adds a pure local bounded raw-request, origin-proof, contract, and strict device-signature
  verification kernel. ADR 0016 adds the dedicated bounded Ingest pool, per-checkout role/login/
  search-path probe, and fixed device-lookup/submission mapping. A deployment login/TLS connection,
  edge/network signer and direct-origin evidence, persistent origin replay store, HTTP Ingest and
  composed live database flow, cleanup/scoring scheduler, and correction authority remain pending.
- Staging key rotation, service rollback, database migration overlap, restore, and kill-switch
  drills.
- Admin user-to-role separation, step-up, reason, audit completeness, and conflict tests.

## References

- [System context](../architecture/SYSTEM_CONTEXT.md)
- [Bounded Web PostgreSQL score adapter](0011-bounded-web-postgresql-score-adapter.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Origin and database abuse cases](../security/ABUSE_CASES.md#infrastructure-administration-and-supply-chain-abuse)
