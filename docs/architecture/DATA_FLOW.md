# Data flow

## GitHub enrollment and primary passkey

```mermaid
sequenceDiagram
    participant B as Browser
    participant W as Web/Auth
    participant G as GitHub
    participant D as PostgreSQL

    B->>W: Begin OAuth
    W-->>B: State + PKCE continuation
    B->>G: Minimal identity authorization
    G-->>W: Exact callback code
    W->>G: Exchange and resolve numeric user ID
    W->>D: Atomic create-or-open unique profile
    D-->>W: Profile and one-time registration challenge
    W-->>B: Primary passkey options
    B->>W: Exact WebAuthn registration
    W->>D: Consume challenge, activate passkey, rotate session
```

GitHub access material is discarded after numeric-ID resolution. Mutable GitHub fields are not
identity. No anonymous/bootstrap/ownership-lease path exists. A normal enrolled session is available
only after the primary passkey is activated.

## Batch discovery and pairing approval

```mermaid
sequenceDiagram
    participant C as Connector
    participant P as Pairing
    participant B as Browser
    participant D as PostgreSQL

    C->>C: Read safe roots and build privacy-only candidates
    C->>C: Create pending account-scoped keys
    C->>P: Signed ConnectorDiscoveryManifestV1
    P->>D: Store bounded transaction and keyed poll/code verifiers
    P-->>C: Approval deep link + fallback code
    B->>P: Signed-in transaction review
    P-->>B: Ordered candidates and same-provider account controls
    B->>P: Create/attach/skip + one fresh passkey assertion
    P->>D: Atomic complete batch and activate selected device bindings
    C->>P: Poll with raw token
    P-->>C: Closed terminal result
    C->>C: Persist activated records; delete skipped pending keys
```

The complete ordered batch, target accounts, providers, pending public keys, installation, session,
and passkey assertion are bound together. The fallback code selects a transaction but grants no
profile authority. Activation is all-or-nothing.

## Local collection and signed synchronization

```mermaid
sequenceDiagram
    participant S as Agent storage
    participant C as Connector
    participant E as Edge
    participant I as Ingest
    participant D as PostgreSQL

    C->>S: Bounded read-only exact-schema read
    S-->>C: Mixed-content records
    C->>C: Extract only provider/candidate/date/total/version
    C->>C: Compose decimal-string UsageSyncV1 and Ed25519 signature
    C->>E: POST /v1/usage
    E->>E: Route/method/type/encoding/bounds/rate + origin HMAC
    E->>I: Exact body and allowlisted headers
    I->>I: Framing/HMAC/duplicate-aware parse/schema/header checks
    I->>D: Non-mutating device/account lookup
    I->>I: Verify Ed25519 and immutable attribution
    I->>D: One atomic submit transaction
    D-->>I: Exact accepted/duplicate result
    I-->>C: UsageSyncResultV1
```

No persistent Ingest state exists before device signature verification. The transaction consumes
origin/device replay and idempotency together with observation, AgentAccount/day, dirty outbox, and
audit mutation.

## Snapshot refresh and public read

```mermaid
sequenceDiagram
    participant I as Ingest/Web visibility
    participant D as PostgreSQL
    participant J as Jobs
    participant W as Public Web
    participant V as Visitor/CDN

    I->>D: Coalesce dirty season
    J->>D: Claim fixed refresh capability
    J->>D: Build complete version/pages/top32/profile summaries
    J->>D: Validate and atomically publish version
    V->>W: GET leaderboard/profile with optional If-None-Match
    W->>D: Read published snapshot only
    D-->>W: Immutable payload + ETag material
    W-->>V: 200 shared-cache response or 304
```

A failed build does not move the publication pointer. Web has no live ranking or raw account/day
capability. Private dashboard reads remain separate and `no-store`.

## Hide and deletion

```mermaid
sequenceDiagram
    participant B as Browser
    participant W as Web/Auth
    participant D as PostgreSQL
    participant J as Jobs

    B->>W: Fresh passkey-confirmed deletion
    W->>D: Atomic hide + revoke sessions/passkeys/installations/devices/accounts + queue job
    D-->>W: Committed result
    W-->>B: Clear cookies and confirm request
    J->>D: Fixed bounded primary purge
    J->>D: Refresh affected public snapshots
    J->>D: Retain then clean terminal evidence under policy
```

Cache purge, backup expiry, stale-restore replay, provider revocation, notification, and real-user
outcome remain separate operational evidence and are never inferred from the primary transaction.

## Trusted release

```mermaid
flowchart LR
    Source["Protected supported revision"] --> Builds["Windows + macOS + Linux builds"]
    Builds --> Tests["Clean-machine install/update/uninstall + reader/keyring/sync tests"]
    Tests --> Metadata["Signatures + checksums + SBOM + provenance"]
    Metadata --> Approval["Protected release approval"]
    Approval --> Artifacts["Explicit supported-version artifacts"]
```

Pull-request CI is secretless and cannot publish. A local build or portable smoke is not an official
release, signature, provenance, support, or deployment result.
