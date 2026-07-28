# Compatibility policy

## Principle

Compatibility is exact evidence, not a version guess. Vibe Racing fails closed when a provider
reader, accounting revision, client contract, device binding, date rule, snapshot metric, database
catalog, or release artifact is unknown or ambiguous.

The project is pre-release and has no production database, released connector, or real-user traffic.
[ADR 0076](../decisions/0076-clean-agent-account-provider-reported-token-ranking.md) therefore
replaces the unreleased Codex-only implementation without a legacy compatibility window. Removed
schemas, routes, procedures, migrations, and local binaries are rebuilt, not adapted.

## Version axes

| Axis                       | Version owner                        | Compatibility rule                                                                                        | Breaking-change path                                                                    |
| -------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Public HTTP route          | Contracts and Web/Ingest             | Exact path plus method; no alias or path fallback                                                         | New accepted ADR and explicit new major contract; no silent retry                       |
| JSON Schema and OpenAPI    | Contracts                            | Closed object, exact schema version, reject unknown and duplicate keys                                    | New major version with generated drift and negative tests                               |
| Connector client           | Connector and Release                | Exact supported client range and final V1 contracts only                                                  | Protected new release and support-matrix update                                         |
| Provider reader            | Connector and Provider registry      | Exact provider, local surface, admitted agent versions/schema digest, and reader version                  | New reader version; unknown usage-bearing input fails closed                            |
| Accounting revision        | Provider registry and Database       | Immutable per AgentAccount and season; exact aggregate/component/dedup/UTC/scope semantics                | New revision for new accounts/seasons; never reinterpret accepted history in place      |
| Account domain and scope   | Pairing and Database                 | Closed stable-opaque or explicit attach rule plus reviewed overlap matrix                                 | New registry revision and explicit conflict migration before activation                 |
| Device signature           | Contracts, Connector, and Ingest     | Exact algorithm, canonical message, path, body digest, account/device IDs, timestamp, and nonce           | New policy version and re-pair; no algorithm downgrade                                  |
| Edge origin proof          | Edge and Ingest                      | Exact key ID, path/body message, HMAC algorithm, timestamp window, nonce, and independent enablement      | Bounded key overlap under protected replacement                                         |
| Date and backfill          | Database                             | UTC calendar date and PostgreSQL clock; fixed server-owned backfill/finalization policy                   | Accepted policy/revision change at a future season boundary                             |
| Competitive metric         | Database, Jobs, and Public contracts | Only `provider_reported_tokens_v1`; exact decimal direct sum and shared ranks                             | New metric requires a new ADR and cannot mix with the old metric in one ranking         |
| Snapshot storage           | Jobs and Public Web                  | Complete immutable version/pages/top-32/profile summaries plus atomic publication pointer and strong ETag | New snapshot format/version built beside old until one atomic publication switch        |
| Database bootstrap catalog | Database and migration runner        | Exact ordered manifest, file digests, transactional ledger, role/RLS/grant oracles                        | Pre-release reset before first deployment; forward-only revisions after intentional use |
| Connector platform package | Release                              | Exact version, OS/architecture, checksum, signature, SBOM, provenance, install/update/uninstall evidence  | New protected artifact; unsupported combinations fail before use                        |

## Provider reader contracts

The canonical matrix is
[agent-provider compatibility](../reference/agent-provider-compatibility.md).

Provider state:

- `supported` — a real bounded reader, exact accounting revision, safe account-domain/scope rule,
  privacy sentinels, and end-to-end discovery/pairing/sync/accounting evidence exist;
- `recognized` — the provider is a closed product option, but one or more required evidence items
  are absent, so no usage request can be produced;
- `disabled` — a previously supported combination is blocked for security, correctness, or
  compatibility reasons.

A provider name, directory, executable, MCP compatibility, public API field, plausible local schema,
or another provider's accounting rules cannot create support.

Every supported row records:

- provider ID;
- local storage or stable API surface;
- admitted agent versions/schema digest;
- reader version;
- immutable accounting revision;
- UTC-day derivation;
- aggregate or disjoint component formula;
- cumulative/repeated-record deduplication;
- safe opaque account-domain rule or explicit attach requirement;
- accounting scope and known-overlap exclusions;
- supported connector/platform versions;
- immutable fixture and end-to-end evidence links.

Unknown usage-bearing record kinds, fields needed by the accounting formula, schema digests,
encodings, time semantics, or overlap behavior invalidate the affected AgentAccount/day. The reader
does not estimate, skip a required record, or emit a partial total.

## Contract and API rules

The final V1 public routes are only:

```text
POST /v1/usage
GET /v1/leaderboards/current
GET /v1/leaderboards/{seasonStart}
GET /v1/profiles/{handle}
```

The final V1 schema inventory is closed in the contracts manifest. Unknown fields, duplicate JSON
keys, alternate media types, alternate encodings, path normalization, query parameters where absent,
and body/header disagreement fail before protected work.

There is no compatibility acceptance for `/v1/community/sync`, `/v1/community/usage`,
`/v1/community/scores`, `/v1/community/race`, `/v1/community/race/status`, or
`/v1/community/tokens`. An old local binary receives generic not found and must be rebuilt.

`UsageSyncV1` has no provider, accounting revision, trust, scope, profile, rank, model, component,
raw identity, or compatibility hint. Ingest derives immutable attribution from the exact
device-to-AgentAccount binding and rejects a mismatched client/reader combination.

## Numeric semantics

Token totals are canonical decimal digit strings. Accepted values:

- contain only ASCII digits;
- have no sign, decimal point, exponent, whitespace, or noncanonical leading zero;
- fit `numeric(30,0)`;
- map to canonical string or `bigint` only after validation;
- never pass through JavaScript `Number`.

Connector, schemas, generated types, runtime validation, signature vectors, PostgreSQL functions,
snapshot serialization, and Web mapping share the same boundaries.

## Date and time semantics

All competitive dates are UTC calendar dates. PostgreSQL clock is authoritative for:

- current date;
- future rejection;
- bounded backfill;
- season open/finalized state;
- replay/idempotency expiry where durable state is involved;
- Jobs eligibility.

Client clock, local timezone, locale, file mtime, provider display timezone, and `observedAt` cannot
widen eligibility. A provider that cannot yield an honest UTC day is not supported for competitive
ranking.

## AgentAccount and scope compatibility

An activated AgentAccount pins provider, accounting revision, trust tier, and scope. A later reader
binary can submit only when its registry entry remains compatible with that exact tuple.

Several devices may submit the same account/day, but the account/day total remains one monotonic
cumulative value. A provider-wide scope and included account-specific scopes cannot be active
contributors together. When a safe stable opaque provider account-domain ID is unavailable,
compatibility requires explicit user create/attach selection rather than an inferred
email/login/path hash.

## Snapshot compatibility

Public reads consume one complete published snapshot version. Page schema, top-32 payload, profile
summary, ETag, metric, trust tier, and season boundaries are version-bound.

A builder may create a new version beside the current one, but the publication pointer advances only
after every page and summary passes invariants. Web never mixes versions or falls back to live
aggregation. Refresh failure keeps the prior version.

## Deprecation and emergency block

Before the first release, incompatible local state is removed and rebuilt. No deprecation window is
created for an unreleased route, migration, database, reader, or connector.

After release:

1. mark the exact provider/reader/client/platform combination disabled;
2. stop new pairing and sync for that combination without changing other providers;
3. preserve existing accepted observations and finalized snapshots;
4. publish the security/correctness reason and supported replacement when safe;
5. ship a new protected connector or server revision;
6. re-enable only after exact compatibility and lifecycle evidence.

Emergency disablement is independently fail-closed and does not relabel Community as Verified,
reinterpret totals, widen a role, bypass signature/date/scope checks, or restore a legacy route.

## Compatibility evidence

Repository evidence includes:

- provider registry and matrix drift checks;
- exact positive/negative/mixed-content reader fixtures;
- cross-language body/digest/signature vectors;
- create/attach/skip, second-device, wrong-provider/revision/scope, replay, and idempotency tests;
- canonical decimal and UTC boundary tests;
- clean bootstrap, role/RLS/grant, migration, restore, Ingest, Jobs, snapshot, and Web integrations;
- protected-platform release declarations and local portable smoke.

Only hosted protected builds, signatures, package lifecycle tests, real provider surfaces, staging
services, and production observations can promote the corresponding external evidence claim.
