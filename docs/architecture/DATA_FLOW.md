# Data flow

## Status and notation

These sequences remain planned application contracts. Revision 0001 now provides private
identity/source/device/pairing/deletion tables and deny-by-default roles, but no runtime procedure
or endpoint executes these sequences. Data labels refer to the classifications in the
[privacy data map](../security/PRIVACY_DATA_MAP.md): Public, Account, Security, Usage, Operational,
and Prohibited.

## Enrollment and passkey bootstrap

```mermaid
sequenceDiagram
  actor User
  participant Browser
  participant Edge as Cloudflare edge
  participant Web as Web/Auth
  participant GitHub as GitHub OAuth
  participant Authenticator as Passkey authenticator
  participant DB as Profile/Auth database role

  User->>Browser: Redeem invite with synthetic-safe public input
  Browser->>Edge: Invite enrollment request
  Edge->>Web: Fresh body-bound origin proof
  Web->>GitHub: OAuth authorization with state and PKCE
  GitHub-->>Web: One-time callback code
  Web->>GitHub: Resolve minimal numeric user ID
  Web->>Web: Discard GitHub access token
  Web->>DB: Create unique profile binding and rotated session
  Web->>Authenticator: One-time transaction-bound registration challenge
  Authenticator-->>Web: Verified WebAuthn response
  Web->>DB: Store credential ID and public key
  Web-->>Browser: Private no-store authenticated profile
```

Only the numeric GitHub user ID crosses into persistent Account data. GitHub access tokens are
callback-memory data and are discarded. The public handle and optional GitHub link require a later
explicit preview/choice; neither is inferred from local or OAuth-private data.

## Device pairing and source choice

```mermaid
sequenceDiagram
  actor User
  participant Connector
  participant Browser
  participant Web as Web/Auth
  participant Authenticator as Passkey authenticator
  participant DB as Profile/Auth database role

  Connector->>Connector: Generate Ed25519 key in OS credential store
  Connector->>Web: Start short-lived pairing with public key and safe metadata
  Web->>DB: Store keyed poll verifier, challenge, and immutable key fingerprint
  Web-->>Connector: One-time poll token, challenge, and short user code
  Connector->>Connector: Keep plaintext poll token local until expiry
  User->>Browser: Enter or confirm short code
  Browser->>Web: Authenticated pairing lookup
  Web-->>Browser: Show key fingerprint, device, platform, version, and source choice
  User->>Browser: Choose new source or existing source
  Web->>Authenticator: Fresh transaction-bound step-up
  Authenticator-->>Web: User-verified response
  Web->>DB: Approve exact pending transaction and source choice
  Connector->>Web: Poll token plus Ed25519 proof over bound challenge
  Web->>DB: Atomically activate public key for exactly one source
  Web-->>Connector: Public device ID after verifier and possession checks
```

The short user code and poll token cannot approve or activate a device by themselves. The browser
needs a current GitHub session and fresh passkey, the connector must prove private-key possession,
and the pending public key is immutable. The server returns the plaintext poll token once, stores
only a keyed verifier, and never logs it. Device authority begins only after atomic source binding
and never includes profile administration.

## Local collection and signed synchronization

```mermaid
sequenceDiagram
  participant Scheduler as User-scoped scheduler
  participant Connector
  participant AppServer as Local Codex App Server
  participant KeyStore as OS credential store
  participant Edge as Cloudflare edge
  participant Ingest as Ingest API
  participant DB as Usage procedure
  participant Jobs

  Scheduler->>Connector: Fixed executable and argument array
  Connector->>AppServer: Launch pinned compatible version over stdio
  Connector->>AppServer: initialize then initialized
  Connector->>AppServer: Planned stable allowlisted account-mode and usage reads
  AppServer-->>Connector: Version-specific response
  Connector->>Connector: Reject unknown schema; select only date and token buckets
  Connector->>KeyStore: Use source-bound device private key
  Connector->>Connector: Sign method, path, body hash, device, nonce, time, idempotency
  Connector->>Edge: Bounded ConnectorSyncV1 Community payload
  Edge->>Ingest: Fresh body-bound origin proof plus original signed request
  Ingest->>Ingest: Validate proof, signature, source, schema, replay, and bounds
  Ingest->>DB: Execute narrow idempotent submission procedure
  DB-->>Ingest: Accepted, quarantined, duplicate, or rejected outcome
  Jobs->>DB: Aggregate sources then apply one profile daily cap
```

Prompts, conversations, repositories, account email, Codex credentials, API keys, and process logs
are Prohibited and have no field in the connector egress schema. `observedAt` supports replay
checks; server `receivedAt` controls deadlines and season finalization. A valid signature proves
only which registered device sent the self-reported payload.

## Public race read

```mermaid
sequenceDiagram
  actor Visitor
  participant Browser
  participant Edge as Public cache and edge
  participant Web as Web public read
  participant DB as Public projection

  Visitor->>Browser: Open current weekly race
  Browser->>Edge: Public versioned read
  alt Fresh public cache entry
    Edge-->>Browser: Community projection
  else Cache miss
    Edge->>Web: Public request with no session-derived cache key
    Web->>DB: Read allowlisted Public fields only
    DB-->>Web: Handle, score, rank, active days, rounded freshness, source count, car
    Web-->>Edge: Explicit public cache policy and Community label
    Edge-->>Browser: Cached public projection
  end
```

Exact token values, exact sync time, GitHub binding, passkeys, devices, source details, and audit
data are absent. Authenticated responses use private `no-store` policy and never populate this
cache.

## Hide and deletion

```mermaid
sequenceDiagram
  actor User
  participant Browser
  participant Web as Web/Auth
  participant Authenticator as Passkey authenticator
  participant DB as Profile/Auth role
  participant Cache as Public cache
  participant Jobs as Deletion job
  participant Backup as Backup/restore process

  User->>Browser: Confirm deletion and type handle
  Browser->>Web: Current session plus deletion request
  Web->>Authenticator: Fresh transaction-bound step-up
  Authenticator-->>Web: User-verified response
  Web->>DB: Atomically hide, revoke sessions/devices, reject ingest, enqueue purge
  Web->>Cache: Purge public profile and race projection
  Web-->>Browser: Non-sensitive deletion state
  Jobs->>DB: Idempotently purge primary Account, Security, and Usage data
  Jobs->>DB: Retain only disclosed bounded tombstone when justified
  Backup->>DB: On restore, replay deletion markers before opening service
```

Hide and authority revocation are synchronous security actions; bulk purge is retryable. Failure of
the asynchronous job does not make the profile public or the device valid again.

## Trusted release

```mermaid
sequenceDiagram
  participant PR as Untrusted pull request CI
  participant Main as Protected main revision
  participant Release as Protected release workflow
  participant Signer as Isolated signing authority
  participant Registry as GitHub release/container registry
  actor User

  PR->>PR: Secretless read-only checks only
  PR--xRelease: Cannot deploy, sign, publish, or supply credentials
  Main->>Release: Approved immutable source and version
  Release->>Release: Build, test, generate SBOM and provenance
  Release->>Signer: Approve exact artifact digest
  Signer-->>Release: Platform/project signature
  Release->>Registry: Publish artifact, checksum, signature, SBOM, provenance
  User->>Registry: Download official artifact and verification metadata
  User->>User: Verify expected signer, checksum, and provenance
```

Release and deployment workflows do not run a pull-request revision with privileged credentials.
Promotion reuses the verified artifact rather than rebuilding from mutable source.

## Flow-change checklist

A change to any sequence updates:

1. versioned public contracts and generated artifacts;
2. [security invariants](SECURITY_INVARIANTS.md), threat model, and abuse cases;
3. privacy classification, retention, access, and deletion behavior;
4. service/database capability matrices and negative tests;
5. compatibility, migration, rollback, logs, alerts, and user-facing EN/RU documentation.
