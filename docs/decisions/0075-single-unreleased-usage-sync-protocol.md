# ADR 0075: Single unreleased Usage Sync protocol

- Status: Superseded
- Date: 2026-07-27
- Decision owners: Contracts, Connector, Edge, Ingest, Database, Security, Privacy, and Operations
- Supersedes: ADR 0070, ADR 0071, and ADR 0073
- Superseded by: ADR 0076

## Context

ADRs 0070, 0071, and 0073 introduced an additive `UsageSyncV1` path while retaining
`ConnectorSyncV1` and `POST /v1/community/sync` as a compatibility route. That compatibility premise
is false: the site and connector have never been released or deployed, and no production client or
stored request depends on the old public contract.

Maintaining two public request schemas, two authentication policies, two Edge routes, two Ingest
branches, and two runtime database capabilities would therefore preserve only local development
history. It would increase the review surface and create an unsupported migration claim without
protecting a real user.

The independently resolved `VIBERACING_USAGE_SYNC_ENABLED` setting remains useful, but its purpose
is capability containment for the single write route. It is not a migration switch or a legacy
compatibility window.

## Decision

Make `UsageSyncV1` on exact `POST /v1/community/usage` the only public Community usage-ingest
protocol:

- remove the `ConnectorSyncV1` request, `ConnectorSyncResultV1` response, authentication policy,
  test vector, manifest operation, generated types, and generated OpenAPI operation;
- make Edge and Ingest register only `/v1/community/usage`, and only when their independently
  resolved enable decisions are exactly true;
- make the connector compose, sign, send, and validate only the Usage Sync contract;
- return the closed not-found response for `/v1/community/sync` before upstream, admission,
  application, or database work;
- retain `VIBERACING_USAGE_SYNC_ENABLED=false` as the checked fail-closed deployment default for the
  sole route; and
- expose only `submit_usage_sync` to runtime roles. The pre-existing `submit_community_sync`
  function may remain as an owner-internal implementation detail while revision 0043 revokes direct
  runtime execution.

Revision 0043 is a forward repository-ledger change because applied migration files are immutable.
It is not evidence that a production database exists or was migrated.

## Security and privacy consequences

There is one externally documented request, one authentication policy, one response contract, one
Edge path, one Ingest path, and one runtime SQL capability. Contract generation and verification
fail if the removed operation is reintroduced.

Previously built local development binaries using `/v1/community/sync` receive 404 and must be
rebuilt. That is intentional because there is no released compatibility promise.

No new personal, operational, or prohibited field is collected. Provider and accounting attribution
remain server-owned, both signatures remain bound to the exact body and Usage path, and the route
remains absent by default. Removing the unused parser and route branches reduces ambiguous
validation and relabeling surface.

The owner-internal `submit_community_sync` function remains reachable by the migration owner because
`submit_usage_sync` delegates to its mature replay and monotonic-storage implementation. Compromise
of that owner is already a database control-plane compromise; runtime roles cannot execute the
function directly after revision 0043.

The public route remains unavailable by default. Coordinated Edge and Ingest enablement is still
required to expose it, but that sequencing is containment and deployment safety rather than a
protocol migration.

## Alternatives considered

- **Retain both public paths:** rejected because no released client or deployed traffic needs
  compatibility, while every extra schema, route, and capability expands drift and attack surface.
- **Change the old path in place to accept `UsageSyncV1`:** rejected because the URL would preserve
  misleading protocol history and weaken exact path-bound signature evidence.
- **Remove the internal mature SQL function immediately:** rejected for this slice because the
  reviewed Usage wrapper delegates to it. Runtime revocation achieves the capability boundary
  without rewriting the mature database state machine.
- **Remove the Usage Sync enable flag:** rejected because independent fail-closed Edge and Ingest
  containment remains valuable before the first deployment.

## Migration and rollback

There is no user, traffic, stored-request, credential, or released-client migration. Local
development binaries must be rebuilt against the sole contract.

Applied migration sources remain immutable, so revision 0043 revokes the old function rather than
editing revisions 0007–0041. Any database correction is a new forward migration. Reverting service
source must not restore runtime access to the removed function or reintroduce the old public path.

Operational containment removes exact `VIBERACING_USAGE_SYNC_ENABLED=true` and replaces both Edge
and Ingest instances. Re-enablement replaces Ingest first and Edge second under the existing
runbook. This controls one protocol; it does not coordinate two protocol populations.

## Verification

Repository tests can prove contract removal, exact path binding, fail-closed enablement, generic
legacy-path rejection, database role denial, and synthetic end-to-end Usage Sync behavior. They do
not prove a deployed Cloudflare route, Railway service, protected secret, production migration, real
connector installation, real-user traffic, monitoring, capacity, or rollback.

Required local evidence is:

- contract generation, drift checks, and negative checker mutations for 14 schemas, four policies,
  and eight operations;
- Edge, Ingest, Ingest-host, connector, and cross-language signature compatibility tests;
- database manifest, role/grant, invariant, and disposable PostgreSQL integration tests, including
  direct old-function denial;
- capability-containment checker and negative mutation tests; and
- repository formatting, documentation, history, dependency, and release gates before publication.

## References

- [Canonical protocol inventory](../../contracts/README.md)
- [Usage Sync authentication policy](../../contracts/v1/connector-usage-sync-authentication.json)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
- [Capability containment runbook](../operations/CAPABILITY_CONTAINMENT_RUNBOOK.md)
- [ADR 0070](0070-dependency-free-cloudflare-ingest-origin-signer.md)
- [ADR 0071](0071-provider-attributed-usage-sync-foundation.md)
- [ADR 0073](0073-candidate-connector-usage-sync-cutover.md)
