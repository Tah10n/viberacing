# Data flow

## Status and notation

Most sequences remain planned application contracts. The enrollment, returning-login, backup-key
addition, non-current-passkey revocation, immediate profile-deletion-request, source
inventory/pause/reactivation/unlink, and active-device revoke sequences below plus the public score
consumer are now locally implemented boundaries; none has live credentials, edge, purge-worker, or
deployment evidence. Revisions 0001 through 0018 provide private
identity/source/device/pairing/audit/deletion/usage tables, deny-by-default roles, and a narrow
database slice for invite issuance, enrollment, exact-session challenges, initial-passkey
activation, passkey login and management, restricted recovery, session rotation/revocation,
immediate deletion lock-down, source-bound pairing, source/device lifecycle controls, and Community
ingest, bounded ingest- and pairing-retention cleanup, open-season scoring refresh, late-ingest
closure, terminal season finalization, and a Web-only public score projection. One local
public-score GET constructs the bounded adapter lazily after closed request admission. The visible
home race now requests its current server-selected week from that exact same-origin route, validates
the public fields, lets one canonical public-handle URL select a same-page summary from only those
fields, and retains a clearly labeled synthetic fallback on failure. A public signed-in account
links to that URL; invalid, duplicate, and unranked selections grant no authority and add no score
query field or browser persistence. One local one-shot Jobs runner can invoke exactly one of four
fixed functions: either cleanup function, refresh, or finalization, but no broader recovery/step-up,
deployed ingest endpoint, Argon2id/WebAuthn pairing approval, operational connector, purge worker,
Jobs scheduler/monitor, audited correction, or deployed service executes the complete sequences. A
library-only Rust connector foundation validates the bounded stable App Server initialization
exchange and candidate `0.144.4` account/usage responses. A synthetic one-shot supervisor composes
those states with fixed local process mechanics, while an exact-body composer and isolated one-use
signer produce a synthetic signed envelope. A separate inaccessible pending-key and challenge signer
plus a pure server-only Web verifier now agree on one exact pairing-possession message and synthetic
signature. A dormant Web/Auth start application generates fresh IDs, token, challenge, 60-bit code,
separate protected poll/code verifiers, and a nine-minute pending transaction from closed device
metadata. A second application performs protected keyed poll lookup, mandates that proof, and
invokes only exact atomic activation behind local admission/timing. All required connector
capabilities have no public constructor, and there is no executable admission, real Codex execution,
key generation/store, pairing-start client, browser/WebAuthn approval, pairing HTTP route, upload,
or supported-version path. A local Ingest kernel now verifies the bounded exact-body origin/device
request, while the separate adapter maps origin replay, device lookup, and submission through fixed
calls. PostgreSQL now proves atomic origin replay consumption and bounded cleanup. A transport-free
application now composes those exact local capabilities and validates only closed
acknowledgement/problem decisions. A bounded local Fastify factory preserves exact raw HTTP
evidence, enforces no-queue and deadline policy, and serializes only revalidated contracts. There is
no edge/live-database/deployment integration. No host/port/TLS entry point, deployment login,
certificate, edge signer/direct-origin policy, or live route/Jobs evidence is supplied. Data labels
refer to the classifications in the [privacy data map](../security/PRIVACY_DATA_MAP.md): Public,
Account, Security, Usage, Operational, and Prohibited.

## Enrollment and passkey bootstrap

```mermaid
sequenceDiagram
  actor User
  participant Browser
  participant Web as Web/Auth
  participant GitHub as GitHub OAuth
  participant Authenticator as Passkey authenticator
  participant DB as Profile/Auth database role

  User->>Browser: Enter invite, public handle, and preferences
  Browser->>Web: Exact same-origin bounded form
  Web->>Web: Digest invite secret; seal state and PKCE continuation
  Web-->>Browser: Redirect to GitHub with callback-only cookie
  Browser->>GitHub: OAuth authorization with state and PKCE
  GitHub-->>Browser: One-time callback code and state
  Browser->>Web: Exact callback plus encrypted continuation
  Web->>GitHub: Exchange code and resolve numeric user ID
  Web->>Web: Discard token and every other response field
  Web->>DB: Atomically consume invite and create profile/session
  Web-->>Browser: Encrypted pending session; passkey page
  Browser->>Web: Exact same-origin options request
  Web->>DB: Create session-bound one-time challenge
  Web-->>Browser: Registration options plus short-lived cookie
  Browser->>Authenticator: Create discoverable user-verified credential
  Authenticator-->>Browser: WebAuthn registration response
  Browser->>Web: Bounded registration proof
  Web->>Web: Verify type, RP ID, origin, challenge, and UV
  Web->>DB: Consume challenge, activate passkey/profile, rotate session
  Web-->>Browser: Encrypted active session and no-store account page
```

Only the numeric GitHub user ID crosses from GitHub into persistent Account data. The OAuth app
requests no extra scope; the access token and every non-ID response field remain callback-memory
data and are discarded. The user explicitly supplies the public handle before authorization; no
GitHub name, login, email, avatar, repository, or profile link is persisted or rendered.

Revisions 0002 and 0005 enforce the database steps after Web/Auth supplies a resolved numeric GitHub
ID and a cryptographically verified WebAuthn result. The local application now supplies exact
same-origin POST checks, state plus S256 PKCE, purpose-separated AES-GCM cookies, fixed GitHub
endpoints, streaming body limits, exact RP/origin/type/user-verification checks, and fixed database
calls. The pending session lasts at most 15 minutes; successful passkey registration atomically
rotates it to a fresh 30-day passkey-bound session. The suite uses injected GitHub,
authenticator-verifier, and database capabilities; there is no live OAuth app, invite issuer UI,
real key/login, edge proof, aggregate/distributed attempt limit, abandoned-state cleanup, recovery,
or deployment evidence.

## Passkey login and credential management

```mermaid
sequenceDiagram
  actor User
  participant Browser
  participant Web as Web/Auth
  participant Authenticator as Passkey authenticator
  participant DB as Profile/Auth database role

  Browser->>Web: Start anonymous login ceremony
  Web-->>Browser: Seal profile-free challenge for at most five minutes
  Web->>Authenticator: Request discoverable credential assertion
  Authenticator-->>Web: Credential ID, signature, UV, and counter flags
  Web->>DB: Read minimal active verification material by credential ID
  Web->>Web: Verify RP ID, origin, challenge, context, signature, and UV
  Web->>DB: Atomically create/consume challenge and mint passkey-bound session
  DB-->>Web: Credential-derived profile ID, handle, and locale
  Web-->>Browser: Private no-store authenticated response

  Browser->>Web: Open account with encrypted session
  Web->>DB: Read bounded session-derived passkey inventory
  DB-->>Web: Labels, lifecycle state, rounded creation dates, current marker
  Web-->>Browser: Server-rendered private list without credential or key material

  User->>Browser: Hide or publish the public profile
  Browser->>Web: Exact same-origin bounded form with encrypted session
  Web->>DB: Idempotently set public or hidden for the session profile
  DB-->>Web: Closed public or hidden state
  Web-->>Browser: No-store redirect to the account state

  User->>Browser: Add a labeled backup passkey
  Browser->>Web: Send validated label with current session
  Web-->>Browser: Independent assertion and registration challenges
  Web->>Authenticator: Fresh existing-key assertion, then new-key registration
  Web->>Web: Verify both exact ceremonies
  Web->>DB: Atomically consume add step-up and insert new credential

  User->>Browser: Revoke an owned non-current active passkey
  Browser->>Web: Send opaque target ID with current session
  Web->>DB: Read inventory and create exact session/target/context challenge
  Web->>Authenticator: Request fresh assertion
  Web->>Web: Verify exact RP, origin, challenge, signature, and UV
  Web->>DB: Atomically consume challenge and terminally revoke target
  DB-->>Web: Close target sessions and pending pairing authority
```

The database exposes no profile identifier during credential lookup, stores no attestation
fingerprint, preserves a monotonic maximum sign counter, and makes revoke terminal. The local
options route creates no database state; after application proof verification revision 0014 stores
and consumes the cookie-bound challenge in the session transaction. The database still cannot check
WebAuthn cryptography or protect an Internet endpoint from request floods; edge/service limits and
bounded cleanup of consumed ceremonies are mandatory before deployment. Recovery is a separate
restricted-authority flow, not a normal login shortcut.

The local account page now composes the existing session-derived inventory read. Its closed mapper
accepts at most 32 ordered rows with exactly one current active authenticator and renders only the
bounded label, active/revoked state, UTC creation date, and current marker. An opaque passkey ID
enters only the authenticated revoke control/request for a non-current active target. The service
revalidates ownership and state before creating the five-minute challenge, while the atomic database
call rechecks last-key protection under lock. Current, last, foreign, expired, malformed, and
replayed attempts fail generically. Credential IDs, public keys, sign counters, exact activity
timestamps, and profile IDs never enter the page or verify request.

The add control appears only below the 32-record lifetime cap. It validates and seals the label
before either prompt, uses distinct five-minute assertion and registration challenges, and binds
both to the active session/profile/RP/origin. The profile UUID enters only the authenticated
registration options as the pseudonymous WebAuthn user ID required by the authenticator. One
materialized statement consumes the verified existing-key step-up and adds the new credential; cap,
duplicate, mixed-cookie, malformed, expired, and replayed attempts fail generically.

## Recovery-code rotation and passkey replacement

```mermaid
sequenceDiagram
  actor User
  participant Browser
  participant Web as Web/Auth
  participant Authenticator as Passkey authenticator
  participant DB as Profile/Auth database role

  alt User still has a passkey
    User->>Browser: Regenerate recovery-code batch
    Web->>Authenticator: Fresh recovery-change step-up
    Authenticator-->>Web: Exact user-verified assertion
    Web->>DB: Record exact passkey and atomically replace 8-16 PHCs
    DB->>DB: Revoke authority derived from every old code
    Web-->>Browser: Show plaintext batch once; never log or persist it
  else User has no available passkey
    User->>Browser: Present opaque code selector and secret
    Web->>DB: Read only selected unused PHC verification material
    Web->>Web: Apply body/rate limits and verify Argon2id plus protected pepper
    Web->>DB: Consume and scrub code; create <=10-minute restricted authority
    Web->>Authenticator: Exact replacement-passkey registration ceremony
    Authenticator-->>Web: Registration response
    Web->>Web: Verify RP ID, origin, challenge, context, signature, and UV
    Web->>DB: Atomically register replacement and revoke old browser authority
    DB-->>Web: Create normal session only after replacement passkey exists
    Web-->>Browser: Show retained activated connectors for explicit review
  end
```

Revision 0006 implements only this database boundary. Lookup returns an opaque selector and PHC,
never a profile identifier. Starting recovery consumes one code, immediately removes its verifier,
and creates no session. Completion requires the exact authority verifier, challenge, and context; it
registers one replacement passkey, revokes previous passkeys and browser sessions, cancels
approved-but-not-activated pairings, removes remaining recovery codes and profile challenges, and
then creates the replacement-key session in the same transaction. Activated source-bound connector
keys remain separately visible and revocable because they have no profile-administration scope.

Code rotation and completion serialize on the profile row and take terminal timestamps after lock
acquisition. Observed cross-connection tests prove rotation dominates a concurrent start with an old
code and completion dominates a concurrent login with an old passkey. Completion fails closed at the
32-lifetime-passkey provenance ceiling until bounded cleanup exists. The repository still lacks
application Argon2id and pepper handling, recovery WebAuthn verification, recovery cookies/CSRF,
generic HTTP timing and response shaping, rate limits, cleanup, notifications, inventory UI, and
deployment evidence; therefore no recovery endpoint is launch-ready.

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

Revision 0003 implements the database steps in this sequence. ADR 0028 now composes the
transport-free start step: a closed request generates all identifiers, 32-byte poll/challenge
material, separate keyed poll/code verifiers, a 60-bit human code, and a nine-minute expiry before
one fixed database call. It supports an explicit new or existing opaque source, binds approval to
the exact session/pairing/source-choice challenge, exposes minimal public-key material for an
external Ed25519 verifier, and activates the exact key only after that verifier succeeds. ADRs 0026
and 0027 implement the transport-free final proof/activation composition: protected
primary/secondary HMAC candidates select at most one approved row, the strict proof is executed for
each structurally valid lookup outcome, and only server-generated device/audit/request IDs reach
activation behind four-call admission and a settlement floor. PostgreSQL scenarios cover competing
profiles, wrong poll possession, replay, immutable binding, 32 lifetime sources, and 64
active/unexpired-approved device authorities per profile. Revision 0013 and ADR 0029 now add bounded
physical cleanup for expired non-activated pairings and their pending keys. Browser/HTTP/WebAuthn
approval, connector transport, distributed edge rate limits, live login, and cleanup scheduling
remain planned. ADR 0015's later device-request verifier does not consume or activate this pairing
transaction. The ceiling and first-winner assertions use separate PostgreSQL connections held behind
a real row lock before simultaneous release.

## Source and device lifecycle

```mermaid
sequenceDiagram
  actor User
  participant Browser
  participant Web as Web/Auth
  participant Authenticator as Passkey authenticator
  participant DB as Profile/Auth database role

  Browser->>Web: Authenticated private inventory request
  Web->>DB: Exact session ID and keyed verifier
  DB-->>Web: Owned opaque sources and bounded device metadata only
  alt Pause source or revoke one device
    User->>Browser: Select immediate protective action
    Web->>DB: Exact session plus owned source or device ID
    DB-->>Web: State change and bounded audit reference
  else Reactivate or unlink source
    User->>Browser: Confirm exact source and action
    Web->>Authenticator: Fresh source-bound step-up
    Authenticator-->>Web: User-verified response
    Web->>DB: Consume exact challenge then claim exact source action
    DB-->>Web: Reactivated source or terminal unlink with device revoke
  end
```

Revision 0004 implements the database lifecycle boundary. Inventory derives the profile from the
possessed session and omits internal key IDs, public keys, profile IDs, exact usage, and account
email. Revision 0016 preserves private inventory and immediate owned-device revoke while public
visibility is hidden. Revision 0017 does the same for pause and source reactivation without changing
visibility; revision 0018 preserves terminal source unlink under the same hidden state. The local
account application now projects at most 32 sources and 64 active device credentials, preserves a
source with no active device, rounds activation to a day, and renders source ordinal/state rather
than its ID. One exact opaque device ID may enter its same-origin revoke form. Source actions
receive only a 15-minute encrypted token bound to the current session; raw source IDs stay
server-only. Pause and device revoke are immediate session-authenticated protective actions.
Reactivation works only from `paused` after a fresh required-UV assertion and one atomic
consume/reactivate call; a normal user cannot lift `quarantined`. A distinct fresh context lets the
same account application unlink an active, paused, or quarantined source while active or hidden.
Unlink moves the source to terminal `unlinked`, revokes every active device, cancels approved
pairings, and invalidates unused source challenges atomically.

The PostgreSQL runner releases pause against pairing approval and unlink against device activation
on separate connections. Either ordering ends without approved authority on a paused source or an
active device on an unlinked source. Inventory, pause, reactivation, and revoke now have
exact-session HTTP authorization, same-origin or exact-JSON enforcement, private no-store responses,
closed mapping, and generic failure. User notifications remain application work. Revision 0007 adds
the database-side submission enforcement described below.

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
  Ingest-->>Edge: Validated acknowledgement or generic problem with server request ID
  Edge-->>Connector: Forward bounded response without a private reason
  Jobs->>DB: Delete bounded expired origin/device nonce and raw-snapshot batches
  Jobs->>DB: Delete bounded expired non-activated pairing and pending-key pairs
  Jobs->>DB: Aggregate sources then apply one profile daily cap
```

Prompts, conversations, repositories, account email, Codex credentials, API keys, and process logs
are Prohibited and have no field in the connector egress schema. `observedAt` supports replay
checks; server `receivedAt` controls deadlines and season finalization. A valid signature proves
only which registered device sent the self-reported payload.

Revision 0007 implements the PostgreSQL portion of this flow. Ingest can look up the minimal active
device/source/public-key tuple, then call one procedure after application verification. The
procedure independently enforces the exact activated binding, identifier/version/date/token and
31-entry bounds, millisecond timestamp precision, a server-time freshness window, per-device nonce
replay, per-device/sync idempotency, and one monotonic current value per source/date. It retains a
whole decrease or quarantined-source snapshot as `quarantined`; paused/unlinked sources, revoked
devices, and deletion-pending profiles fail closed. Observed races cover exact retry, same-source
devices, pause, and revoke.

ADR 0015 implements a pure local part of the Ingest application step. A closed raw envelope copies
the exact body and required headers, enforces transport and JSON budgets, rejects duplicate required
headers and decoded JSON keys, and verifies a fresh HMAC-SHA-256 origin proof before body parsing or
device lookup. The parser then validates `ConnectorSyncV1`; timestamp and idempotency headers must
equal their body fields; and a minimal injected device tuple verifies the exact-body request with
strict Ed25519 semantics before a frozen database-ready allowlist is returned.

ADR 0016 adds the local application-to-database mapping. A dedicated four-client pool parses only
namespaced settings, requires certificate-verified non-loopback TLS, and probes the exact Ingest
role, restricted login scope, and safe search path before any fixed parameterized procedure. Device
lookup accepts only zero or one closed row. Submission reconstructs and revalidates the verifier
allowlist, copies its values, creates a server UUID, and accepts only a coherent `accepted`,
`duplicate`, or `quarantined` row. PostgreSQL remains authoritative for receipt time, replay,
lifecycle, season closure, quarantine, and locks. Tests use mock pools; no database connection
occurs.

ADR 0017 implements the protected local origin-key input to the verifier. One mandatory primary and
one optional complete secondary rotation pair use exact namespaced process values, closed IDs, and
canonical 32-byte keys. Construction returns only the verifier and clears the reader's temporary
decoded buffers. No real key or secret-manager binding exists in the repository.

ADR 0018 and revision 0012 implement the injected replay seam as one procedure-only PostgreSQL tuple
keyed by origin key ID and the verifier's domain-separated 32-byte nonce digest. Atomic consume
inserts or replaces only an already expired tuple, returns `false` for an unexpired replay, and
rechecks expiry after lock wait. The local adapter strictly reconstructs the three inputs and
accepts only one boolean row. An ordered observed race proves exactly one fresh consume when two
callers contend for one expired tuple.

ADR 0019 adds the transport-free orchestration around those existing boundaries. One configured
factory uses the same bounded database object for origin consume, device lookup, and submission; the
verifier must settle before submission, and submission must settle before acknowledgement. One
server-generated request ID correlates only a validated `ConnectorSyncResultV1` or generic
`ProblemDetailsV1` decision. A signed synthetic request exercises that production code order with a
mock pool. No inbound ID, private anomaly reason, callback error, or submitted field is reflected.

ADR 0020 adds the local HTTP step shown in the sequence. One confined Fastify server accepts only
the exact sync POST, copies the raw body/header evidence into ADR 0019, disables proxy and inbound
request-ID trust plus framework logging, bounds body/header/connection/socket/time work, and admits
four unsettled application calls without a queue. It revalidates every application decision and
returns only generic `no-store` acknowledgement/problem contracts. Real loopback tests exercise
malformed framing and partial sockets; injection tests exercise route, overload, and serialization.

ADR 0021 implements the first local App Server protocol step: a fixed capability-free `initialize`,
one 16 KiB LF-only closed response, discarded initialization strings, and fixed `initialized`. ADR
0022 adds a candidate `0.144.4` sequence after that handshake: fixed account/usage reads, ChatGPT
mode confirmation with account fields discarded, and no more than 31 normalized daily usage entries.
ADR 0023 composes that exact one-shot sequence through one fixed `app-server` argument, a reviewed
working directory/environment with ambient variables cleared, local pipes, bounded stdout/stderr and
deadlines, terminal-event checks, and reap-before-success cleanup. The required launch capability
has no public constructor, so it cannot identify or admit a binary or execute the official artifact.
ADR 0024 then consumes the normalized output only with another inaccessible capability containing
reviewed source/device/time/nonce inputs. It emits the exact bounded `ConnectorSyncV1` bytes,
SHA-256 digest, unpadded base64url nonce, and LF-separated device message verified by Ingest. ADR
0025 removes public unsigned access and consumes that value only with an inaccessible, device-bound,
one-use Ed25519 key capability; the returned envelope contains the same body and five exact header
values. ADR 0026 adds a separate inaccessible pending-key/challenge signer and pure Web verifier for
one exact synthetic pairing-possession proof. ADR 0027 adds a dormant protected poll-verifier, fixed
approved-material lookup, strict proof-to-activation adapter, and local admission/timing
composition. ADR 0028 adds a dormant closed pairing-start composition with fresh material, separate
keyed poll/code verifiers, and one fixed database call. No boundary can perform browser/WebAuthn
approval, open the pairing HTTP path, create either operational connector context, generate or load
a real key, schedule, or upload, and the support matrix stays empty.

The operational connector layers, edge signer, direct-origin denial, host/port/TLS Ingest deployment
entry point, live secret-manager/edge key injection, live PostgreSQL login/TLS connection,
distributed rate/ backpressure controls, monitoring, and load evidence are still absent. Revisions
0008 and 0012 give Jobs a server-time, 1-to-1000 batch procedure for expired origin nonces, device
nonces, and raw snapshots. It serializes callers, caps each class independently, cascades raw
entries, preserves current source/day values, and clears only their deleted raw reference. The
expiry columns still do not delete rows by themselves. The local one-shot Jobs command can invoke
one fixed 1000-row batch, but no scheduler, monitor, live login, or deployment invokes it
automatically.

Revision 0013 adds a separate private mutex and oldest-first 1-to-1000 batch for expired `pending`,
`approved`, or `cancelled` pairing transactions whose exact key is still pending and unbound. It
deletes transaction-bound approval challenges by cascade, then the key, while contended rows wait
for a later invocation and activated/live state remains. The local Jobs runner exposes a second
fixed 1000-row cleanup command; no scheduler, live login, monitoring, or retention cadence invokes
it automatically.

Revision 0009 adds only the private PostgreSQL scoring part of the planned Jobs step. One serialized
transaction refreshes an open ISO-week season from current eligible source/day values, sums distinct
sources before one profile daily cap, applies the immutable Community v1 formula, and writes derived
daily/weekly scores, active days, source count, shared rank, and deterministic display order. It
excludes hidden/deleting profiles and quarantined sources and copies no raw token total or source ID
into score tables. Revision 0010 closes the grace window at Wednesday 00:00 UTC after the ISO week
using server `receivedAt`; any submission touching a closed week is retained as a quarantined whole
snapshot and cannot update accepted source/day state. Jobs may atomically finalize at or after that
deadline, and terminal triggers reject silent metadata or score rewrites while allowing profile
purge to remove personal rows. Ingest and Jobs share the canonical
`season → profile → source → device` lock order. Revision 0011 gives only Web a bounded score-only
read that filters current profile visibility before re-ranking and omits private identifiers, raw
values, daily detail, and exact timestamps. ADRs 0014 and 0029 make the local one-shot Jobs process
invoke exactly one of four reviewed functions—ingest cleanup, pairing cleanup, refresh, or
finalization—after a per-checkout least-privilege probe; no scheduler, live login/certificate,
application database integration, audited correction, freshness/streak/car projection, deployed
route, or public cache exists.

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
cache. This complete read flow remains planned. Revision 0011 implements only the database score
subset: season metadata, handle, weekly score, active days, source count, shared rank, and display
position. ADR 0010 wraps at most 32 such rows in a closed response component with constant Community
and self-reported metadata. A server-only Web mapper now accepts unknown adapter output, requires
the exact SQL columns and coherent season/order/rank semantics, validates and freezes that response,
and advertises no path. ADR 0011 adds a dedicated four-connection `pg` pool, strict TLS/config
parser, every-checkout effective-role/login-membership/search-path/read-only probe, bounded waits,
and one fixed parameterized score query that casts calendar dates to text before mapping. ADR 0013
now adds a local GET route around that adapter: it closes the URL/body and `Accept` grammar, admits
at most four active reads without a queue, translates only generic errors, validates the mapped page
again, and emits `no-store`/same-origin responses. Its deadline policy is the adapter's bounded
connect/query/statement work, and the lease remains held until that work settles. There is still no
cache, car, streak, freshness, daily detail, profile read, deployment login/certificate, edge rate
policy, load evidence, or live adapter integration. The home page now supplies the current
server-derived Monday to its client, which performs one credential-free `no-store` request to the
exact route. A small closed mapper accepts only the response's public fields, uses fixed
repository-owned presentation cars because CarRecipe is not projected, and shows streak/freshness as
unavailable. Invalid, oversized, or unavailable responses retain the labeled synthetic race. This
adds no live database login, cache, retry loop, or deployment evidence.

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

Revision 0002 implements the database transaction behind the immediate hide/revoke/enqueue step and
proves its rollback behavior with synthetic PostgreSQL scenarios. Revision 0006 also revokes active
restricted recovery authority as the profile enters deletion, and revision 0007 rejects every
deletion-pending profile at the usage procedure. The local Web/Auth endpoint now requires the exact
active session and typed handle, binds a fresh required-UV assertion to the
session/profile/handle/RP/origin context, atomically consumes the challenge with that existing
transaction, and clears every browser auth cookie only after success. Cache purge, queued-job
execution, tombstone policy, and backup replay are still planned.

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
