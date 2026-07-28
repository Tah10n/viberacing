# ADR 0076: Clean AgentAccount provider-reported token ranking

- Status: Accepted (clean-slate pre-release target; implementation evidence pending)
- Date: 2026-07-28
- Decision owners: Product, Identity, Connector, Contracts, Edge, Ingest, Web, Jobs, Database,
  Security, Privacy, Operations, and Release
- Supersedes: ADR 0068, ADR 0069, ADR 0072, and ADR 0075
- Superseded by: None

## Context

Vibe Racing has not released a connector, deployed a service, created a production database, or
accepted real-user traffic. The current repository nevertheless carries 43 pre-release migration
revisions, Codex-specific source names, four legacy Community read routes, an unreleased
`/v1/community/usage` write path, a parallel direct-token metric, and a proposed anonymous identity
model. Preserving those shapes would turn local implementation history into a compatibility burden
without protecting a user.

The product is a weekly, reward-free ranking of provider-reported coding-agent token usage. It needs
to support multiple logical accounts for one provider, multiple providers for one profile, and
multiple independently revocable devices for one logical account. A connector installation is not a
score source, and a device is not a score source. Counting either as one would duplicate usage.

The metric cannot honestly normalize tokenizers into equal cost, compute, effort, or quality. The
server must therefore rank the exact accepted provider-reported totals, state that tokenizers
differ, and keep Community and Verified evidence separate.

Because every existing runtime and database shape is pre-release and synthetic, the narrowest honest
design is a clean replacement. This decision is normative before implementation, while
`docs/IMPLEMENTATION_STATUS.md` remains the authority for what the current tree has actually proved.

## Decision

### 1. Clean-slate pre-release replacement

The final branch has one implementation of the target model:

- replace the 43-revision pre-release migration history with a small bootstrap catalog for an empty
  database;
- do not create migration 0044, production backfill, user cutover, correction records, dual-write,
  compatibility tables, compatibility procedures, or old/new catalogs;
- remove Codex-specific runtime table and procedure names rather than retaining wrappers;
- remove `community_v1`, logarithmic scoring, multipliers, engagement caps, the date-based metric
  cutover, and every legacy score/race/status/token route;
- remove the unreleased `/v1/community/*` usage route and expose only `POST /v1/usage`;
- treat local historical migrations only as design evidence for constraints, roles, races,
  retention, and failure handling worth preserving;
- preserve strong security controls: least-privileged NOLOGIN roles, forced RLS, owner-only schema
  mutation, exact procedures, fixed maintenance capabilities, replay protection, passkeys, deletion,
  restore verification, fail-closed startup gates, and synthetic integration evidence.

There is no backward-compatibility population. A local development database or connector built from
an earlier commit is discarded and rebuilt.

### 2. Identity

Every profile has exactly one immutable GitHub numeric user ID:

- `github_user_id` is unique and immutable;
- GitHub login, handle, display name, email, or another mutable field is never an identity key;
- repeated OAuth for the same numeric ID opens the same profile and cannot create another;
- no anonymous profile, anonymous bootstrap credential, ownership lease, anonymous-to-GitHub
  promotion, or GitHub-as-recovery path exists;
- GitHub OAuth uses state and PKCE, requests the minimal identity scope, discards the provider token
  after resolving the numeric ID, and creates no sync authority;
- initial enrollment requires a primary passkey before account connection;
- returning login, restricted recovery, and critical-action step-up retain their separate,
  action-bound authority.

One person can still create several GitHub accounts. The product does not claim proof of one human,
and Community rank grants no reward, money, authorization, or valuable privilege.

### 3. AgentProvider and AgentAccount

`AgentAccount` is one logical account of one coding agent. It is the competitive accounting
principal.

- one profile may own multiple providers;
- one profile may own multiple AgentAccounts for the same provider;
- one connector installation may discover and service multiple AgentAccounts;
- one AgentAccount may bind multiple independently revocable device keys;
- an installation and a device do not create another counted usage domain;
- provider, accounting revision, trust tier, and accounting scope are immutable server-owned
  AgentAccount attributes and are absent from `UsageSyncV1`;
- account labels are private user metadata and are not identity or deduplication authority;
- an account is `active`, `paused`, `quarantined`, or `disconnected`; only active eligible accounts
  contribute.

The closed provider registry initially recognizes:

- `codex`;
- `claude_code`;
- `opencode`;
- `qwen_code`;
- `cline`;
- `aider`.

Registry state is `supported`, `recognized`, or `disabled`. `supported` requires a real bounded
reader, an exact accounting revision, positive and adversarial fixtures, privacy-sentinel evidence,
and end-to-end accounting tests. A name, protocol, local directory, or plausible schema is not
support evidence. When exact local evidence is absent, the provider remains recognized or disabled
with a precise evidence gap.

### 4. Accounting revisions and overlap

Every supported provider/accounting-scope pair selects one immutable accounting revision when an
AgentAccount is created. The revision defines:

- exact reader versions and admitted local schemas;
- the stable opaque account-domain rule, if one exists;
- UTC-day derivation;
- aggregate-versus-component accounting;
- cumulative snapshot and repeated-record deduplication;
- monotonicity and backfill rules;
- known overlap with other scopes.

A reader uses one documented aggregate total or documented disjoint components. It never:

- adds cache, reasoning, thought, or another nested detail to a total that already includes it;
- estimates tokens from text, characters, price, model, or another provider's tokenizer;
- accepts unknown usage-bearing schema;
- emits a partial understated day after a parse failure;
- counts one provider-wide aggregate together with AgentAccounts already included in that aggregate.

When a provider exposes no safe stable opaque account-domain identifier, the user must explicitly
create or attach the discovered candidate to an existing AgentAccount of the same provider. Email,
login, display name, repository path, or a hash of those values is not an acceptable pseudonymous
fingerprint.

### 5. Competitive metric

The only competitive metric is `provider_reported_tokens_v1`.

For one profile and one UTC week:

1. keep the latest accepted cumulative total for each unique eligible `AgentAccount` and UTC date;
2. count each AgentAccount/date once, regardless of device or installation count;
3. sum the seven account/day totals with exact decimal arithmetic;
4. rank profiles by descending exact `weeklyTokenTotal`;
5. give equal totals the same `rankPosition`.

Provider, model, price, subscription, active days, streak, account count, device count, installation
count, CarRecipe, and display order never multiply the total or break a tie. A deterministic
`displayPosition` may order equal-rank rows for stable rendering but has no competitive meaning.

Community and Verified use separate snapshots and ranks:

- Community is device-signed, self-reported, bounded, and explicitly unverified;
- Verified exists only when a server-side provider integration obtains usage under a reviewed
  provider contract;
- a sync request cannot assert or promote Verified state;
- Community and Verified totals are never merged.

### 6. Numeric and date semantics

Token totals cross JSON as canonical non-negative decimal digit strings. TypeScript validates and
maps them to canonical strings or `bigint`; it never converts them through JavaScript `Number`.
PostgreSQL stores accepted totals as `numeric(30,0)` and rejects negative, fractional, oversized, or
non-canonical values.

Usage date is an exact UTC calendar date. PostgreSQL clock and server-owned policy decide:

- the current UTC date;
- future-date rejection;
- the bounded backfill window;
- open/finalized season eligibility.

Client clock, `observedAt`, locale, or timezone cannot widen the accepted window. `observedAt` is
immutable observation metadata, not ranking time.

### 7. Final public contracts

The final version-one contract inventory contains:

- `AgentProviderV1`;
- `ConnectorDiscoveryManifestV1`;
- `ConnectorPairingStartV1`;
- `ConnectorPairingApprovalV1`;
- `ConnectorPairingPollResultV1`;
- `UsageSyncV1`;
- `UsageSyncResultV1`;
- `LeaderboardSnapshotV1`;
- `PublicProfileSummaryV1`;
- `ProblemDetailsV1`.

`UsageSyncV1` contains exactly one server-issued `agentAccountId`, `syncId`, `observedAt`,
`clientVersion`, `readerVersion`, and bounded unique `dailyEntries`. Each entry contains `usageDate`
and a canonical decimal-string cumulative token total. It contains no provider, accounting revision,
trust tier, profile, rank, device count, installation count, model, component, prompt, repository,
path, email, credential, or raw record.

The only public product routes are:

- `POST /v1/usage`;
- `GET /v1/leaderboards/current`;
- `GET /v1/leaderboards/{seasonStart}`;
- `GET /v1/profiles/{handle}`.

Unknown routes and methods return one generic bounded problem response before protected or expensive
work. There are no aliases for removed `/v1/community/*` paths.

### 8. Batch connection and device authority

`viberacing connect --origin <https-origin>` is the primary connection flow:

1. validate the exact origin;
2. create or load one installation identity from the native OS credential store;
3. run built-in bounded discovery readers;
4. show a local privacy-safe candidate preview;
5. generate one pending account-scoped device key per selected candidate;
6. submit one bounded signed discovery manifest;
7. receive a browser approval deep link plus a fallback code;
8. let the signed-in browser create, attach, or skip each candidate;
9. require one fresh passkey assertion for the entire ordered approval batch;
10. poll a bounded terminal result;
11. persist activated account credentials before success output;
12. delete skipped pending keys;
13. perform the first sync for every activated account.

Fallback code entry remains available, but is not the primary UX. A second installation attaches a
candidate to an existing AgentAccount of the same provider after the same batch review and passkey
step-up. Each device key signs only for its bound AgentAccount and cannot change profile, account,
security, or another device.

The connector also exposes bounded `sync`, `status`, `doctor`, `account list`, `account sync`,
`disconnect`, and `forget-local` commands. Private keys have no plaintext-file fallback, export,
generic launcher, shell hook, proxy, or redirect path.

### 9. Reader privacy boundary

Agent local storage is mixed-content untrusted input. A built-in reader may emit only:

- the closed provider identifier;
- opaque bounded candidate metadata;
- UTC date;
- canonical cumulative token total;
- reader/accounting version.

Prompts, conversations, code, tool output, repository names, paths, email, login, display name, API
keys, OAuth tokens, model names, raw usage records, and provider-shaped component fields do not
cross the reader boundary. File readers reject traversal, symlinks/reparse points, alternate
streams, device paths, unsafe roots, oversized files/records/fields, duplicate JSON keys, malformed
encodings, and schema ambiguity. SQLite readers open a bounded read-only snapshot without mutating
the source. Privacy sentinel fixtures prove prohibited values cannot reach a network payload, log,
diagnostic, or error.

### 10. Edge and atomic Ingest

Edge admits only exact `POST /v1/usage` after independent exact enablement. It checks route, method,
media type, encoding, body/header bounds, and rate policy, then computes the exact body digest and
adds a short-lived path/body-bound origin HMAC. It forwards only allowlisted headers, performs no
retry, and never accepts caller-supplied origin authority.

Ingest performs, in order:

1. raw framing and header bounds;
2. origin HMAC cryptographic verification in memory with no database write;
3. bounded duplicate-key-aware JSON parsing;
4. strict `UsageSyncV1` validation;
5. exact header/body relationship checks;
6. non-mutating device, installation, AgentAccount, provider, and revision lookup;
7. Ed25519 signature verification;
8. server-owned binding validation;
9. one atomic PostgreSQL submission.

Invalid framing, body, origin proof, schema, headers, binding, or device signature leaves zero
persistent replay, idempotency, observation, total, outbox, or audit state.

After signature verification, one database transaction:

- consumes the origin replay tuple;
- revalidates active installation, device, AgentAccount, provider, revision, trust tier, and scope;
- consumes the device nonce;
- enforces long-lived idempotency;
- applies PostgreSQL-clock UTC date and bounded backfill rules;
- applies monotonic cumulative totals;
- inserts immutable observations;
- updates or inserts one account/day total;
- coalesces one dirty-season outbox item;
- appends a bounded audit/ranking event;
- returns one exact result.

Any failure rolls back every mutation.

### 11. Seasons, snapshots, and public reads

UTC weeks are server-owned seasons. Jobs derives dirty seasons from the coalesced outbox and builds
immutable versioned snapshot pages plus one top-32 race payload and bounded public-profile
summaries. Refresh is idempotent, bounded, non-overlapping, restart-safe, and ordered by fixed
catalog capabilities. Finalization settles closed seasons under the same direct metric.

Public requests never aggregate raw ranking tables. They read only the latest complete snapshot
version, emit strong ETags, honor `If-None-Match` with 304, and send reviewed shared-cache headers.
Private account and security routes remain `no-store`. A failed refresh retains the last good
snapshot; the public path does not replace it with a partial snapshot. Absence of any snapshot
returns one bounded generic unavailable response.

The semantic server-rendered leaderboard is primary and usable without canvas or animation. The race
is lazy, cosmetic, reduced-motion aware, and consumes the same top-32 snapshot payload rather than a
second ranking query.

### 12. Operations and release

Web, Edge, Ingest, Jobs scheduler, migration, enrollment, pairing, account creation, public ranking,
and proposal mutations retain independent exact-default-off decisions where they cross a deployment
trust boundary. Missing, malformed, inherited, or unreadable enablement fails closed.

Jobs and migration entry points accept only fixed reviewed commands and exact catalogs. They expose
no arbitrary SQL, query, account selector, cutoff, retry count, or generic launcher. Restore,
deletion, containment, and forward-recovery remain explicit operator procedures with protected
external evidence boundaries.

A connector is not official merely because source builds locally. Official support requires:

- a protected build from a supported revision on Windows, macOS, and Linux;
- platform-native signing where applicable;
- checksum manifest;
- SBOM;
- provenance;
- clean-machine install, update, uninstall, credential-store, discovery, and sync evidence;
- an explicit supported-version declaration.

Repository-local and synthetic gates do not prove hosted CI, signing, release, deployment,
production credentials, external routing, real-provider correctness, capacity, monitoring, or
real-user behavior.

## Security and privacy consequences

The design removes anonymous profile authority, Codex-specific score principals, parallel public
protocols, legacy live aggregation, and engagement scoring. It narrows identity to one immutable
GitHub numeric ID and narrows usage authority to one AgentAccount-scoped device key.

New or materially changed trust boundaries are:

- mixed-content agent storage to a built-in reader;
- installation discovery manifest to signed-in batch approval;
- batch approval to account/device activation;
- Edge to Ingest origin proof for the sole write route;
- verified device lookup to the atomic usage transaction;
- Jobs snapshot builder to immutable public snapshot pages;
- protected release workflow to platform-specific connector artifacts.

Principal residual risks remain explicit:

- a computer owner or compromised local process can fabricate Community totals for its own
  AgentAccount;
- one human can operate several GitHub accounts;
- provider tokenizers are not comparable units of cost or compute;
- OS credential stores do not imply hardware-backed non-exportability;
- a supported local schema can drift after release;
- shared public caches and snapshots require operational purge, monitoring, and capacity evidence;
- local synthetic tests cannot prove a provider, hosted service, release pipeline, or deployment.

The mitigation is containment, not a false verification claim: reward-free Community labeling,
closed schemas, exact account scoping, non-overlap rules, server-owned dates and revisions, strict
numeric representation, atomic replay/idempotency/usage mutation, bounded readers, snapshot-only
public reads, independent gates, and revocable credentials.

## Alternatives considered

- **Add migration 0044 and preserve the old catalog:** rejected because no production database or
  user needs migration compatibility.
- **Rename CodexSource to AgentSource but keep source semantics:** rejected because device and
  source count would remain ambiguous; AgentAccount is the logical accounting principal.
- **One source per connector installation:** rejected because installations and devices would
  duplicate one account's tokens.
- **One account per provider:** rejected because users can have multiple real accounts for the same
  coding agent.
- **Anonymous enrollment:** rejected because immutable GitHub identity plus a required passkey gives
  a smaller authority and retention surface for the first product.
- **Provider/model/price normalization:** rejected because it is subjective, unstable, and can
  require prohibited content.
- **Live public aggregation:** rejected because public traffic would consume private ranking
  capability and make cache/failure behavior harder to bound.
- **Keep legacy routes as aliases:** rejected because no released client needs them and aliases
  expand validation, authorization, and documentation surface.
- **Declare providers supported from plausible local files:** rejected because unknown usage-bearing
  schemas must fail closed.
- **Count provider-wide and agent-specific totals together:** rejected because overlapping
  accounting domains would inflate rank.

## Migration and rollback

There is no production or user-data migration.

Implementation replaces the pre-release catalog in one reviewed branch. A local operator:

1. deletes disposable development databases and old local connector credentials;
2. builds the exact branch;
3. creates an empty database through the new manifest;
4. reconnects only synthetic test identities.

No old migration file, compatibility procedure, alias route, source table, score projection, or
historical score is copied forward.

Before release, rollback is Git rollback plus disposal and recreation of local synthetic state. Once
any environment is intentionally created from the new catalog, database repair is forward-only and
the reviewed migration/restore runbooks apply. Capability rollback removes exact enablement and
replaces affected processes; it never changes a stored AgentAccount provider, accounting revision,
trust tier, scope, accepted observation, or finalized snapshot in place.

This ADR is superseded, not edited, if the product model changes after release.

## Verification

The complete implementation requires:

- a new empty database reaches the exact bootstrap ledger and role/RLS/grant state;
- old migration, table, function, score, contract, route, and UI names are absent;
- repeated GitHub OAuth cannot create a second profile;
- multiple providers, multiple same-provider AgentAccounts, and multiple devices per account work;
- two devices for one AgentAccount cannot double count one date;
- overlap scope is rejected or resolved before activation;
- every supported reader has exact positive, adversarial, drift, privacy, and end-to-end fixtures;
- every unsupported provider remains recognized or disabled without a support claim;
- invalid body or signature leaves zero persistent state;
- replay, idempotency, observation, account/day, outbox, and audit mutation is atomic;
- PostgreSQL clock rejects future dates and owns bounded backfill;
- exact decimal totals never pass through JavaScript `Number`;
- direct weekly sums, shared ranks, Community/Verified separation, hidden-profile behavior, and
  finalization are proven;
- 10,000-profile synthetic refresh, concurrency, last-good-snapshot, page, top-32, ETag, 304, and
  shared-cache behavior are proven;
- GitHub-first onboarding, one-assertion batch approval, fallback code, dashboard, semantic
  leaderboard, lazy race, EN/RU copy, accessibility, and reduced-motion behavior are tested;
- clean-machine release lifecycle and supported-platform evidence exists before any official
  connector claim;
- focused, full development, release, history, staged-public, dependency, Rust, and disposable
  PostgreSQL gates pass;
- final diff review confirms no secret, stale compatibility path, false support claim, or false
  production evidence.

## References

- [Project plan](../PROJECT_PLAN.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
- [Compatibility policy](../architecture/COMPATIBILITY_POLICY.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [Dependency policy](../security/DEPENDENCY_POLICY.md)
- [Migration runbook](../operations/MIGRATION_RUNBOOK.md)
- [Restore runbook](../operations/CURRENT_SNAPSHOT_RESTORE_RUNBOOK.md)
- [Capability containment runbook](../operations/CAPABILITY_CONTAINMENT_RUNBOOK.md)
- [Release policy](../../RELEASE.md)
