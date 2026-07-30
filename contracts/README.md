# Public contracts

`contracts/v1` is the canonical public protocol surface. It contains 18 JSON Schemas, four
authentication/transport policies, and seven OpenAPI operations. Generated TypeScript and OpenAPI
artifacts are derived from that manifest and must never be edited by hand.

All contracts are unreleased version 1. There is no compatibility population, so removed pre-release
score, race, status, token-ranking, source-sync, and source-pairing shapes are not aliases or
migration paths.

## Inventory

### Schemas

- `AgentProviderV1`
- `CarRecipeV1`
- `ConnectorCarProposalResultV1`
- `ConnectorDiscoveryManifestV1`
- `ConnectorPairingApprovalV1`
- `ConnectorPairingPollV1` and `ConnectorPairingPollResultV1`
- `ConnectorPairingStartV1` and `ConnectorPairingStartResultV1`
- `LeaderboardQueryV1`
- `LeaderboardSeasonPathV1`
- `LeaderboardSnapshotV1`
- `ProblemDetailsV1`
- `PublicProfilePathV1`, `PublicProfileQueryV1`, and `PublicProfileSummaryV1`
- `UsageSyncV1` and `UsageSyncResultV1`

`AgentProviderV1` is the closed protocol allowlist for providers with a repository-implemented
reader candidate. Its current `codex` member is not a provider-support declaration: the clean
database bootstrap keeps Codex `recognized`, leaves its accounting revision disabled for new
accounts, and admits no provider until the separately reviewed registry, compatibility, and release
evidence is complete.

### Policies

- connector CarRecipe proposal authentication;
- connector pairing possession;
- connector pairing transport; and
- connector usage-sync authentication.

### OpenAPI operations

| Method | Path                             | Repository status   | Purpose                                     |
| ------ | -------------------------------- | ------------------- | ------------------------------------------- |
| POST   | `/v1/connector/cars/proposals`   | `contract-only`     | Submit one bounded private car proposal     |
| POST   | `/v1/connector/pairing/poll`     | `contract-only`     | Poll one bounded pairing batch              |
| POST   | `/v1/connector/pairing/start`    | `contract-only`     | Start one bounded pairing batch             |
| GET    | `/v1/leaderboards/{seasonStart}` | `implemented-local` | Read an immutable historical snapshot page  |
| GET    | `/v1/leaderboards/current`       | `implemented-local` | Read the last-good current snapshot page    |
| GET    | `/v1/profiles/{handle}`          | `implemented-local` | Read a current public profile summary       |
| POST   | `/v1/usage`                      | `implemented-local` | Submit one AgentAccount cumulative snapshot |

`implemented-local` means repository code and synthetic evidence exist. It does not mean the route
is deployed, enabled, reachable on the Internet, capacity-tested, or backed by production
credentials. The three connector operations remain contract-only even though transport-free Web
applications and connector clients exist; there is no composed hosted transport result.

## Usage semantics

`UsageSyncV1` carries one exact cumulative account/day observation:

- one opaque AgentAccount ID and one sync ID;
- observation time, client version, reader version, and 1–31 unique UTC dates;
- one canonical non-negative decimal token string per date; and
- no prompts, conversations, code, repository contents, local paths, email, access tokens, API keys,
  cost, model usage, arbitrary metadata, or uploaded files.

Provider identity and accounting semantics are sealed during pairing. Ingest revalidates them
against the active account and device rather than accepting provider, revision, scope, trust,
profile, installation, or device fields in the body. PostgreSQL parses each decimal string directly
into `numeric(30,0)`; JavaScript never converts it through `Number`.

The request is signed twice:

1. an account-scoped device key signs the canonical body; and
2. the Edge boundary adds a fresh path/body-bound origin HMAC.

Origin replay is consumed before device lookup or idempotency classification. A valid request then
atomically records the immutable observation, replaces that device's cumulative account/day value,
recomputes the exact AgentAccount/day total, appends a hash-chained ranking event, and coalesces the
affected season into the dirty queue. Duplicate idempotency returns the original acknowledgement;
conflicting reuse fails closed.

## Pairing semantics

The connector discovers a bounded set of logical candidate accounts. Each candidate binds:

- one closed provider identifier;
- one immutable provider-native account key;
- one reader and accounting revision;
- one competitive scope and trust tier; and
- the generated installation and account-scoped public key.

The browser shows the complete sealed batch. One fresh passkey assertion approves or rejects the
whole batch atomically. Provider-native labels remain private and mutable; ownership depends on the
immutable account key. Fallback-code admission uses a separately protected verifier and does not
weaken the device possession proof.

## Public snapshot semantics

Public leaderboard and profile responses are read only from immutable published snapshots. Rank is
derived solely from exact weekly token totals:

- equal totals share rank;
- pagination does not alter rank;
- display order uses stable public tie breakers;
- hidden or deletion-pending profiles are excluded;
- provider breakdowns add exactly to the profile total; and
- a failed refresh preserves the previous published pointer.

The current and historical leaderboard operations share `LeaderboardSnapshotV1`. The response
identifies the ranking scheme and unit explicitly and includes only the public projection. Finalized
snapshots cannot be changed.

## Authoring rules

1. Change a canonical schema or policy under `contracts/v1`.
2. Register it in `contracts/v1/manifest.json`.
3. Preserve closed objects, bounded strings/arrays, explicit integer limits, and exact enums.
4. Keep authentication and admission policy explicit on every operation.
5. Regenerate derivatives:

   ```text
   corepack pnpm run generate:contracts
   ```

6. Verify drift and runtime behavior:

   ```text
   corepack pnpm run check:contracts
   corepack pnpm run lint:contracts
   corepack pnpm run typecheck:contracts
   corepack pnpm run test:contracts:coverage
   ```

Contract changes are security and privacy changes. Read
[security invariants](../docs/architecture/SECURITY_INVARIANTS.md),
[compatibility policy](../docs/architecture/COMPATIBILITY_POLICY.md), and the
[privacy data map](../docs/security/PRIVACY_DATA_MAP.md) first.

## Evidence boundary

Repository checks prove canonical/derived drift control, schema closure, exact route inventory,
runtime validation, signature fixtures, malformed-input rejection, and compatibility between the
Edge signer and Ingest verifier. Disposable PostgreSQL integrations additionally prove the atomic
storage mapping.

They do not prove a supported provider, released connector, clean-machine real-account read,
deployed Edge or Ingest route, external TLS, secret delivery, representative load, monitoring,
operational retention, or real-user ingestion.
