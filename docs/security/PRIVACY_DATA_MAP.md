# Privacy data map

## Status and principles

The current repository contains a private SQL schema, synthetic PostgreSQL integration tests, local
Community sync verification kernel, bounded database adapter, HTTP server and executable host, plus
one full synthetic loopback signed-request path through a disposable least-privileged login. That
path also holds four synthetic requests at the first replay-store call, observes only their
aggregate lock-waiting count, rejects a fifth before replay work, and retains no timing or query
history. It also contains library-only connector protocol/parser boundaries, a synthetic one-shot
process supervisor, an exact-body composer, isolated pairing/request signers, a pure Web pairing
verifier, local pairing applications/routes and bounded native-store connect/local-removal commands,
a visible public-race consumer with a synthetic fallback, a separate synthetic all-three-route
emitted-Next-production-to-TLS-enabled-disposable-PostgreSQL gate, a browser-memory-only
hypothetical score simulator, and bounded database/local Jobs ingest, pairing, authentication,
CarRecipe-proposal, eligible expired-invite/session, abandoned-enrollment, aged unreferenced
revoked-passkey, and aged minimized revoked-device cleanup plus primary profile purge and bounded
oldest-known historical season finalization. A local invite/OAuth/initial-passkey enrollment,
returning-passkey login, private passkey inventory, and private active-device inventory and revoke
slice now add encrypted short-lived cookies, fixed Web/Auth database calls, an account page, and
logout with injected/synthetic evidence, but there is no live OAuth app, authenticator-backed
result, deployed application database, production service, operational connector, or real user data.
This document remains the required inventory for implementation. A field may not be collected merely
because it appears here: its schema, purpose, visibility, retention, deletion, and access tests must
exist first. The implemented column-level mapping is documented in
[`database/README.md`](../../database/README.md#data-and-privacy-map).

Vibe Racing applies these rules:

- collect the minimum data needed for an invite-only Community race;
- keep exact usage private and publish only derived, intentionally selected fields;
- never collect prompts, conversations, repository contents, Codex credentials, API keys, account
  email, or arbitrary files;
- separate public, account, security, usage, and operational capabilities;
- avoid advertising, behavioral analytics, tracking pixels, and remote web fonts in the MVP;
- make pause, hide, device revoke, source unlink, and deletion understandable and testable;
- use synthetic data in development, CI, documentation, screenshots, and support reproduction.

The Web integration adds no product collection or retention class. Its obviously synthetic login
passwords, private fixture identifiers, randomly generated self-signed certificate, and private key
exist only in the checked harness, system temporary directory, disposable database, and
child-process memory. The key Buffer is overwritten after its closed file is written; the read-only
mounted source, container copy, host directory, processes, network, and storage are removed after
each run. Bounded Next and database-blocker output is checked for fixture, credential, and
certificate-path reflection and discarded, HTTP bodies are checked against the closed public
allowlists, and the no-queue scenario inspects only a synthetic login's aggregate count of
lock-waiting score queries. The TLS observation retains only a bounded connection count and
all-connections-secure boolean in harness memory. The same disposable database preloads
`auto_explain`; owner-provisioned database-scoped settings enable it only for the narrow synthetic
login, disable parameter payloads, and emit only SQL already present in the public repository plus
planner/runtime counters, relation/index names, and plan structure. The harness accepts at most two
mebibytes and 128 plan objects, scans the complete log for every synthetic private marker, retains
the bounded parsed plans only while evaluating six pass/fail decisions in process memory, and
neither prints nor writes the plan bytes. The Docker log and its database-scoped role settings
disappear with the container. No result is cached or written as an artifact. Deployment Web
credentials and certificate delivery remain protected environment/secret-manager data under the
table below.

## Classification

| Class       | Meaning                                                             | Default handling                                                                 |
| ----------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Public      | Intentionally visible race/profile information                      | Cacheable only under an explicit public contract; purge on hide/delete           |
| Account     | Private profile and preference data                                 | Authenticated profile access; no public cache; delete with profile               |
| Security    | Credentials, hashes, ceremonies, authorization, and security events | Least privilege, encryption in transit/at rest, redacted logs, bounded retention |
| Usage       | Private Codex-reported daily values and exact sync state            | Source-bound ingest, private by default, excluded from general logs/support      |
| Operational | Minimal delivery, reliability, abuse, and audit data                | Purpose-limited, access-controlled, retention-bounded, not product analytics     |
| Prohibited  | Data the product has no purpose or authority to collect             | Reject, redact from diagnostics, never persist or transmit                       |

## Planned field inventory

Retention values marked **launch decision required** are not permission to retain indefinitely. A
public Privacy Policy and tested purge schedule must replace them before real-user ingestion.

| Data                                                                        | Class                                  | Source and purpose                                                                                                                                                                                                | Visibility and access                                                                                                                                                                                        | Planned store                                                                                                                                                                                                                               | Retention and deletion                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Resolved GitHub numeric user ID                                             | Account                                | GitHub OAuth; enforce one Vibe Racing profile per upstream ID                                                                                                                                                     | Web/Auth and uniqueness procedure only                                                                                                                                                                       | `profiles` identity binding                                                                                                                                                                                                                 | Until profile deletion; a canonical abandoned `enrolling` profile is bounded cleanup-eligible only after all retained authority expires; short security tombstone only if justified and disclosed                                                                                                                                                               |
| GitHub access token and non-ID profile response fields                      | Prohibited after callback              | GitHub OAuth; resolve the numeric ID once with no extra scope                                                                                                                                                     | Callback memory only                                                                                                                                                                                         | Never persisted                                                                                                                                                                                                                             | Discard immediately after identity resolution                                                                                                                                                                                                                                                                                                                   |
| OAuth state, PKCE verifier, callback code, and invite continuation          | Security                               | Web/Auth; bind one authorization response to one enrollment                                                                                                                                                       | Verifier/continuation in HttpOnly cookie; state crosses browser/GitHub; code returns to Web                                                                                                                  | State, verifier, preferences, invite ID/digest, and ten-minute expiry in a purpose-keyed AES-GCM cookie                                                                                                                                     | Cookie expires or is cleared at callback; code is exchanged once; app/dev logs suppress it; hosted access logs must redact query                                                                                                                                                                                                                                |
| GitHub OAuth client ID and client secret                                    | Security                               | Deployment; identify the dedicated enrollment OAuth app                                                                                                                                                           | Web/Auth callback only; client ID appears in the GitHub redirect                                                                                                                                             | Protected environment/secret manager; tracked values are non-working placeholders                                                                                                                                                           | Rotate secret on exposure/ownership change; remove both when GitHub enrollment is disabled                                                                                                                                                                                                                                                                      |
| Public handle                                                               | Public                                 | User; identify the race profile                                                                                                                                                                                   | Public after explicit labeled choice and activation; also supplied to the authenticator                                                                                                                      | `profiles` and discoverable-credential display metadata                                                                                                                                                                                     | Server copy until changed, hidden, or deleted; authenticator copy remains user-controlled                                                                                                                                                                                                                                                                       |
| Community trust tier and self-reported flag                                 | Public                                 | Server constants; prevent Community results from implying verification                                                                                                                                            | Public score/race/status responses and localized UI                                                                                                                                                          | Not stored; literal response metadata                                                                                                                                                                                                       | Generated per response; no retention                                                                                                                                                                                                                                                                                                                            |
| Public score `seasonStart` query label                                      | Public                                 | Visitor; select one public Community season                                                                                                                                                                       | Local Web score/race/status routes                                                                                                                                                                           | Not stored; passed only to the bounded score adapter                                                                                                                                                                                        | Per request only; do not retain or log the raw URL                                                                                                                                                                                                                                                                                                              |
| Hypothetical simulator token/day and active-day input                       | Usage                                  | Visitor; explain the public Community formula without account data                                                                                                                                                | Current browser component only; never Web, API, server, or log                                                                                                                                               | React component state only; no form name/action, request, cache, or persistence                                                                                                                                                             | Discarded on reload/navigation; never transmitted, logged, cached, persisted, or prefilled                                                                                                                                                                                                                                                                      |
| Optional GitHub profile link                                                | Public                                 | User opt-in; distinguish an upstream public identity                                                                                                                                                              | Public only after explicit opt-in                                                                                                                                                                            | `profiles` preference                                                                                                                                                                                                                       | Until opt-out or deletion; purge public cache                                                                                                                                                                                                                                                                                                                   |
| Profile visibility, locale, theme, motion, privacy preferences              | Account                                | User; product experience and visibility controls                                                                                                                                                                  | User profile; only public effects are visible                                                                                                                                                                | `profiles`; Web maps lifecycle state only to closed `public`/`hidden`                                                                                                                                                                       | Until reset or deletion                                                                                                                                                                                                                                                                                                                                         |
| Invite secret, verifier digest, and state                                   | Security                               | Operator-issued 256-bit secret; gate beta enrollment                                                                                                                                                              | Plaintext only in the initial bounded form; digest to Web/Auth and limited admin procedure                                                                                                                   | SHA-256 verifier digest, status, expiry, and non-sensitive audit                                                                                                                                                                            | Plaintext discarded during parsing; expired active/revoked rows are cleanup-eligible; redeemed provenance remains until profile purge or exact abandoned-enrollment cleanup                                                                                                                                                                                     |
| Session verifier, encrypted cookie, and metadata                            | Security                               | Web/Auth; maintain one browser session                                                                                                                                                                            | HttpOnly same-site browser cookie and Web/Auth only                                                                                                                                                          | Purpose-keyed AES-GCM cookie; database stores SHA-256 verifier digest, expiry, state, and passkey provenance                                                                                                                                | At most 15 minutes pending or 30 days normal; bounded cleanup once unreferenced; expired abandoned-enrollment sessions may cascade with their exact profile; activated pairing approval reference is retained at least 180 days before redaction eligibility                                                                                                    |
| Enrollment cookie master key                                                | Security                               | Deployment; seal login, OAuth, passkey, and session continuations                                                                                                                                                 | Web/Auth process memory only; four purpose keys are derived with HKDF                                                                                                                                        | Protected environment/secret manager; exactly 32 canonical base64url bytes; never tracked or logged                                                                                                                                         | Rotate on exposure; rotation invalidates outstanding continuations and sessions                                                                                                                                                                                                                                                                                 |
| Web PostgreSQL deployment login and password                                | Security                               | Deployment; authorize only the Web score, identity, and pairing adapters                                                                                                                                          | Adapters and PostgreSQL driver process memory only                                                                                                                                                           | Protected environment/secret manager; never tracked or logged                                                                                                                                                                               | Rotate on exposure/role change and remove when the adapters are disabled                                                                                                                                                                                                                                                                                        |
| Synthetic Web integration TLS certificate and private key                   | Security; test-only                    | Local harness; authenticate one disposable PostgreSQL endpoint to emitted Next production processes                                                                                                               | Harness memory and temporary directory; certificate is a child-process trust anchor; key is mounted read-only and copied only into the disposable container                                                  | Random runtime-only RSA key and self-signed exact-DNS X.509 certificate; no tracked fixture, artifact, output, or reusable deployment value                                                                                                 | At most one integration run; private Buffer is overwritten after file creation, and host directory, container copy, process state, network, and storage are removed in `finally`                                                                                                                                                                                |
| Synthetic current-snapshot database dumps and restore archives              | Security; Usage; test-only             | Local database harness; prove exact current synthetic state and security-boundary restoration                                                                                                                     | Bounded harness child-process memory and the isolated disposable PostgreSQL container only                                                                                                                   | Canonical plain dumps exist only in bounded memory; two custom archives exist only in container `tmpfs`; no host file, log, fixture, cache, or release artifact                                                                             | One integration run only; canonical buffers are hashed then overwritten, archive contents are never emitted, and both archives disappear with the ephemeral `tmpfs` container; no real-user or production database copy is accepted                                                                                                                             |
| Synthetic scheduler wall-clock observation                                  | Security; Operational; test-only       | Local Jobs harness; prove one native host-timer callback reaches refresh and an OS signal settles it                                                                                                              | Harness memory, link-free temporary production runtime, read-only Linux Node container, one owner lock-holder session, Docker control plane, and disposable PostgreSQL container                             | Startup/recurring epoch milliseconds, aggregate session/wait counts, container exit state, and runtime digest only; no query text, identifier, credential, or user data                                                                     | One integration run only; values are not logged, cached, exported, or retained, and every database session, container, network, storage resource, and fingerprint-checked temporary runtime is removed in bounded cleanup                                                                                                                                       |
| Synthetic process-signal/crash runtimes and container state                 | Security; Usage; test-only             | Local Ingest and Jobs harnesses; prove graceful OS-signal settlement after startup/restart or during one active PostgreSQL call, pre-write Jobs termination, and one uncommitted post-insert transaction rollback | Link-free temporary `target/` runtime, read-only Linux Node hosts, bounded capability-free Ingest client, owner lock holders, disposable trigger/function, Docker, and disposable database network namespace | Exact built workspace and installed production graphs; synthetic login/key/request/source values exist only in process configurations, Ingest-client stdin, or disposable PostgreSQL; Jobs failure emits one generic sentence; no user data | One integration run only; each runtime is fingerprinted before and after read-only mounting, all other host paths remain silent, the disposable trigger/function is removed and verified absent before retry, client output is parsed only in harness memory, every database session/container is removed, and each temporary directory is recursively removed. |
| Ingest PostgreSQL deployment login and password                             | Security                               | Deployment; authorize only device lookup and sync submission                                                                                                                                                      | Ingest adapter and PostgreSQL driver process memory only                                                                                                                                                     | Protected environment/secret manager; never tracked or logged                                                                                                                                                                               | Rotate on exposure/role change and remove when ingestion is disabled                                                                                                                                                                                                                                                                                            |
| WebAuthn public key, credential ID, pseudonymous user handle, and key label | Security; label is Account             | Server profile ID plus user authenticator; login and fresh step-up                                                                                                                                                | Web/Auth and the user's authenticator; user can list only bounded friendly metadata                                                                                                                          | `passkeys`; profile UUID is the discoverable credential user ID; no attestation fingerprint store                                                                                                                                           | Active while authoritative; a revoked row is retained at least 180 days and longer while any session, challenge, or pairing reference remains, then bounded cleanup-eligible                                                                                                                                                                                    |
| Opaque passkey ID                                                           | Security                               | Server-generated key; select one owned credential for revocation                                                                                                                                                  | Authenticated account revoke control and options request only                                                                                                                                                | `passkeys` primary key                                                                                                                                                                                                                      | Retained and cleanup-eligible with the passkey row; never public or accepted as proof                                                                                                                                                                                                                                                                           |
| WebAuthn challenge, context, and verifying-passkey reference                | Security                               | Server; bind one ceremony to one action and exact credential                                                                                                                                                      | Web/Auth only; encrypted login challenge cookie contains no profile or reusable authority                                                                                                                    | Registration uses a database challenge; login stays cookie-only before proof, then creates and consumes one database row atomically                                                                                                         | Registration and login are one-time and at most five minutes; expired-row cleanup has fixed-clock synthetic scheduler/PostgreSQL proof, while deployed proof remains pending                                                                                                                                                                                    |
| Recovery-code selector and verifier                                         | Security                               | Web/Auth-generated; recover profile access                                                                                                                                                                        | Web/Auth only; plaintext secret shown once to the user                                                                                                                                                       | Opaque selector and Argon2id PHC; protected pepper stays outside DB                                                                                                                                                                         | PHC scrubbed on use; unused batch removed on regeneration/completion/deletion; used source row is cleanup-eligible after authority expiry                                                                                                                                                                                                                       |
| Restricted recovery authority and registration binding                      | Security                               | Server; permit only exact replacement-passkey registration                                                                                                                                                        | Web/Auth recovery procedure only                                                                                                                                                                             | Keyed verifier plus challenge/context digests and terminal lifecycle                                                                                                                                                                        | One-time, at most 10 minutes; expired-row cleanup has fixed-clock synthetic scheduler/PostgreSQL proof, while deployed and backup-purge evidence remains pending                                                                                                                                                                                                |
| Source ID, state, and source count                                          | Account; count is Public               | User-declared opaque CodexSource; isolate and explain aggregation                                                                                                                                                 | User sees sources; public sees only contributing count for a season                                                                                                                                          | `codex_sources`, season snapshot                                                                                                                                                                                                            | Source lifecycle plus historical public count until profile deletion                                                                                                                                                                                                                                                                                            |
| Encrypted source-control token                                              | Security                               | Server; select one owned source without exposing its raw ID in HTML                                                                                                                                               | Authenticated account/connect pages and source-control or pairing requests                                                                                                                                   | Transient AES-GCM ciphertext in HTML/form or JSON; no new database field                                                                                                                                                                    | Bound to the exact active session and expires within 15 minutes; never logged or accepted as proof alone                                                                                                                                                                                                                                                        |
| Device public key, private signing key, and public device ID                | Security                               | Connector; authenticate one source-bound device                                                                                                                                                                   | Public key to pairing/Ingest/inventory; private key only to local signer                                                                                                                                     | Public key/ID in `device_keys`; private key in one versioned native OS credential record                                                                                                                                                    | Pending server key is cleanup-eligible at expiry; active while authority exists; revoked server key/ID retained at least 180 days and until pairing/challenge/nonce/raw references are absent; `forget-local` separately removes only the exact local record                                                                                                    |
| Device label                                                                | Account                                | User or safe generated default; distinguish devices                                                                                                                                                               | User profile only after activation; pairing service while pending                                                                                                                                            | `device_keys` metadata                                                                                                                                                                                                                      | Pending label is cleanup-eligible at pairing expiry; active while the device is active; revoked label follows the same at-least-180-day referenced-device boundary                                                                                                                                                                                              |
| Connector, Codex, and OS-family versions                                    | Security; Operational                  | Connector; compatibility and incident diagnosis                                                                                                                                                                   | Pairing service while pending; user inventory after activation                                                                                                                                               | Device/sync metadata                                                                                                                                                                                                                        | Pending metadata is cleanup-eligible at pairing expiry; activated metadata remains through authority and at least 180 days after revocation, longer while exact references remain                                                                                                                                                                               |
| Connector diagnostic preview and candidate admission class                  | Operational                            | Explicit local `check-codex`; provide one user-reviewed coarse troubleshooting result                                                                                                                             | User-selected stdout only                                                                                                                                                                                    | Not stored or transmitted by the connector                                                                                                                                                                                                  | Per invocation only; the connector retains no copy, while any shell redirect or user-shared copy remains under the user's chosen external retention                                                                                                                                                                                                             |
| Pairing poll token, HMAC keys/verifiers, challenge, user code, transaction  | Security                               | Server/connector; poll safely and bind browser approval to one key                                                                                                                                                | Pairing service/application, native connector record, and browser confirmation                                                                                                                               | Plain token/challenge/code only in pending native record; separate keyed verifiers in DB; HMAC keys in protected configuration                                                                                                              | Pending native material clears on activation/local expiry; expired non-activated rows have bounded cleanup; activated approval references redact after at least 180 days, and the minimized pairing/device pair is cleanup-eligible only after both ages and all exact challenge/nonce/raw references clear                                                     |
| Pairing approval attempt window and count                                   | Security; Operational                  | Server; bound authenticated code guessing across Web instances                                                                                                                                                    | Web/Auth and database only                                                                                                                                                                                   | Two fields on the possessed `sessions` row; no code, digest, IP, or user-agent history                                                                                                                                                      | Window resets in place; eligible session rows are deleted once unreferenced; activated pairing references are redaction-eligible after at least 180 days                                                                                                                                                                                                        |
| Anonymous pairing client ID, digest, bucket, and rate window                | Security; Operational                  | Connector/Web; cheaply shape anonymous start/poll load                                                                                                                                                            | Raw 16-byte ID in native connector record and one header; digest transient in Web/PostgreSQL                                                                                                                 | Database stores only 130 fixed operation/global/bucket rows with window start and saturated count; no ID or digest                                                                                                                          | Client ID is removed with the exact local credential; positive aggregate timestamp/count becomes reset-eligible after the maximum one-hour window through a bounded Jobs capability in the default-off local hourly catalog; fixed rows remain, and no deployed maximum retention is evidenced                                                                  |
| Encrypted pairing approval continuation                                     | Security                               | Server; bind reviewed pairing and exact selected source to fresh step-up                                                                                                                                          | Browser receives only an opaque HttpOnly cookie; Web/Auth decrypts it                                                                                                                                        | AES-GCM continuation contains challenge, pairing/source IDs, exact source choice, and expiry; no raw code or public key                                                                                                                     | At most five minutes, one-time database action, cleared from the browser after success                                                                                                                                                                                                                                                                          |
| Pairing possession message and signature                                    | Security                               | Connector/Web verifier; prove one pending device holds its private key                                                                                                                                            | Connector signer, pure Web verifier, and closed activation application                                                                                                                                       | Transient process memory only; never persisted                                                                                                                                                                                              | Web copies overwritten after settlement; Rust proof lives until owner drop; never logged or retained                                                                                                                                                                                                                                                            |
| `codexReportedDate` and exact daily token value                             | Usage                                  | Local stable App Server adapter; compute Community score                                                                                                                                                          | Isolated Ingest and Jobs scoring/cleanup procedures; never public raw                                                                                                                                        | `usage_snapshot_entries`, `source_day_values`                                                                                                                                                                                               | Raw snapshot is Jobs-cleanup eligible after 30 days; finalized exact source/day rows become bounded-cleanup eligible 30 days after terminal projection, while open/missing-projection state remains until lifecycle or a later reviewed rule                                                                                                                    |
| Connector `observedAt`, server `receivedAt`, device nonce, idempotency key  | Security; Usage                        | Connector/server; replay, ordering, deadline, and retry safety                                                                                                                                                    | Isolated Ingest and Jobs cleanup procedures; shared finalization policy                                                                                                                                      | `usage_snapshots`, `device_nonces`                                                                                                                                                                                                          | Nonce after 15 minutes and raw snapshot after 30 days; combined synthetic scheduler/PostgreSQL cleanup is proven, while deployed purge proof remains required                                                                                                                                                                                                   |
| Car proposal signature envelope and nonce digest                            | Security                               | Connector/Web; authenticate one exact proposal without profile authority                                                                                                                                          | Raw body/device headers only in connector and Web verifier; digest only to Web database call                                                                                                                 | Raw body, nonce, signature, public-key copy, and message are transient; domain-separated digest in `device_nonces`                                                                                                                          | Transient bytes overwritten after settlement; digest expires after seven minutes and uses existing bounded cleanup in the default-off local hourly catalog; combined synthetic proof exists, while deployed proof remains pending                                                                                                                               |
| Edge origin HMAC key and key ID                                             | Security                               | Operator/edge/service; authenticate the only intended ingress                                                                                                                                                     | Edge signer and Ingest verifier process memory only                                                                                                                                                          | Protected environment/secret manager; local reader implemented; never tracked, logged, or stored in DB                                                                                                                                      | Rotate on exposure or policy change; remove retired key after bounded request window                                                                                                                                                                                                                                                                            |
| Origin proof timestamp, nonce, proof, nonce digest, and replay expiry       | Security                               | Edge/service; bind and replay-protect one exact request                                                                                                                                                           | Ingest verification and procedure-only replay capability                                                                                                                                                     | Proof/raw nonce transient; `origin_nonces` retains key ID, domain-separated digest, and exact expiry                                                                                                                                        | Proof/raw nonce discarded per request; tuple unusable at expiry; bounded cleanup has combined synthetic scheduler/PostgreSQL proof, while deployed proof remains pending                                                                                                                                                                                        |
| Daily and weekly score, active days, shared rank                            | Public                                 | Server-derived from accepted source/day state                                                                                                                                                                     | Public Web: weekly/active/rank; private account: own daily                                                                                                                                                   | `season_daily_scores`, `season_entries`, `seasons`, `score_versions`                                                                                                                                                                        | Final rows immutable except profile purge; public daily delivery absent                                                                                                                                                                                                                                                                                         |
| Rounded freshness and contributing source count                             | Public                                 | Server-derived privacy-preserving status                                                                                                                                                                          | Public projections expose source count; status route adds complete-UTC-day freshness                                                                                                                         | `season_entries`; freshness derives from live `source_day_values.last_accepted_at` or private `finalized_season_profile_freshness.last_accepted_date` after terminal capture                                                                | Read filters current active state; finalized projection retains only UTC day, source/value counts, and cleanup progress; profile-row purge cascades; exact receipt time stays private; cache policy remains pending                                                                                                                                             |
| Streak                                                                      | Public when enabled                    | Server-derived informational field                                                                                                                                                                                | Status route only when the active profile's `streak_visible` preference is true                                                                                                                              | Derived at read time from `season_daily_scores`; preference in `profiles`                                                                                                                                                                   | Recomputed from retained score rows or deleted with profile; underlying daily rows remain private; never increases score                                                                                                                                                                                                                                        |
| CarRecipe and proposal state                                                | Public active recipe; Account proposal | Signed-in browser proposes enums, or a local agent reduces style intent before an active source-bound device proposes enums; browser decides                                                                      | Proposal private; exact active recipe public only through the separate active-profile race read                                                                                                              | Agent retains nothing in Vibe Racing; forced-RLS versioned recipe/proposal tables through exact session/device Web functions; bounded Web-only race projection                                                                              | Maximum 24-hour logical proposal validity; replacement/reject/approve/profile purge or bounded Jobs cleanup removes it; command is in the default-off local hourly catalog, but deployed cadence is pending; active until change/delete                                                                                                                         |
| IP-derived request signal and user-agent family                             | Operational                            | Edge/service; security, rate shaping, and reliability                                                                                                                                                             | Restricted operations; never leaderboard or behavioral advertising                                                                                                                                           | Prefer aggregate/ephemeral edge controls; minimal event when necessary                                                                                                                                                                      | Shortest operational window; exact scope and duration require launch privacy review                                                                                                                                                                                                                                                                             |
| Request ID, outcome, latency, and bounded error code                        | Operational                            | Server-generated correlation; debugging and SLO evidence                                                                                                                                                          | Response recipient and restricted operations; aggregate metrics                                                                                                                                              | Not retained today; future structured logs/metrics                                                                                                                                                                                          | Future bounded logs exclude usage, credentials, bodies, and profiles                                                                                                                                                                                                                                                                                            |
| Security/admin audit event and reason                                       | Security; Operational                  | Auth/admin/jobs/release; accountability                                                                                                                                                                           | Restricted responders/auditors; user-visible subset where appropriate                                                                                                                                        | Bounded `audit_events` reference; external append-only sink planned but absent                                                                                                                                                              | Database reference retained at least 180 days then cleanup-eligible; profile link redacted on purge; external sink policy remains separate                                                                                                                                                                                                                      |
| Deletion state and security tombstone                                       | Security                               | Deletion workflow; prevent ingestion and restore resurrection                                                                                                                                                     | Deletion/jobs/auth and limited audit                                                                                                                                                                         | Local request queues and local Jobs terminally settle one opaque deletion job; minimal keyed tombstone remains planned                                                                                                                      | Immediate lock-down and primary purge implemented; terminal job retained at least 30 days then cleanup-eligible; cache/backup purge, tombstone/restore replay remain                                                                                                                                                                                            |
| Maintenance capability mutex                                                | Operational                            | Database; serialize bounded cleanup, scoring, and primary deletion                                                                                                                                                | Owner-defined Jobs procedures only                                                                                                                                                                           | Seven fixed `maintenance_locks` enum rows; no user or request data                                                                                                                                                                          | Retained while each capability exists; removed only by a reviewed migration                                                                                                                                                                                                                                                                                     |

The local identity implementation reads the invite body as a bounded stream, hashes and clears the
decoded secret during parsing, and never places plaintext invite or OAuth access token in a cookie,
database call, response, log, cache, or client storage. Its encrypted cookies contain only the
fields named above and use separate derived keys and paths for login, OAuth, passkey, and session
purposes. Returning-login options create no database state and the encrypted challenge contains no
profile identifier; only a valid exact WebAuthn proof reaches the atomic database completion call.
The authenticated account read rounds passkey creation to a UTC date and renders only bounded
labels, active/revoked state, and the current-authenticator marker; credential IDs, public keys,
sign counters, exact activity timestamps, and profile IDs stay outside HTML. Only an owned
non-current active key's opaque passkey ID enters the authenticated revoke control and its options
request; the verify request carries only the WebAuthn response. Backup-key addition validates and
seals the Account label before prompting. Its authenticated options response supplies the profile
UUID and handle only as WebAuthn user fields to the user's authenticator plus two independent
challenges; the verify request carries only the existing-key assertion and new-key registration
responses. Neither credential material nor profile ID enters account HTML. The same possessed
session can read only a closed `public`/`hidden` visibility value and submit that desired value in a
same-origin form; the database derives the profile instead of accepting its ID. Hiding does not stop
source sync. Revision 0015 adds no profile column or new retained field; it stores no form body, IP
address, user agent, or score. The same account read projects at most 64 active device credentials
across at most 32 sources and preserves a source with no active device. HTML receives only source
ordinal and state, bounded device label, platform, connector version, a UTC-day-rounded activation
date, and an exact-shape encrypted source-control token. Raw source IDs, profile IDs, public keys,
internal key IDs, and exact timestamps remain server-only; only the owned device's opaque ID and the
encrypted source-control token enter their respective authenticated controls. Revision 0016 adds no
column or retained field and preserves inventory/revoke while the profile is hidden. Revision 0017
likewise adds no retained field and preserves pause/reactivation while hidden; revision 0018 does
the same for terminal unlink. The token expires within 15 minutes, is bound to the exact session,
and is not proof without that session; reactivation and unlink use distinct five-minute HttpOnly
challenge continuations. The Web slice does not log, cache, or persist the projection. The decoded
master key is overwritten immediately after those purpose keys are derived. Add/revoke step-up is
also one-time and at most five minutes; its consumed-row cleanup remains a launch requirement. The
HTTP runtime exposes only the public origin and secure-cookie flag. The fixed GitHub user response
parser accepts only a positive safe numeric `id` for return; the token and every other response
field are discarded after the callback. Tests use reserved, synthetic values and injected
GitHub/database/authenticator capabilities. No real-user retention or deployed subprocessor claim
follows from this local boundary.

Opaque sources deliberately contain no Codex account email or upstream account identifier. The
implemented pairing database caps each profile at 32 lifetime source records and 64 active plus
unexpired approved device authorities. These public safety ceilings do not replace lower
deployment-private rate and fair-use controls, and exact per-source details remain non-public
Account data. Revisions 0004, 0016, 0017, and 0018 add no new personal-data column: the private
inventory procedure returns only the requesting session profile's opaque source state and bounded
device metadata, including while that profile is hidden. Lifecycle procedures retain the existing
source/device rows, append only closed audit references, and never accept or expose account email,
upstream account identity, exact usage, public keys, or internal key IDs.

Revision 0006 adds no email, support identity, recovery plaintext, IP address, or arbitrary
metadata. Its lookup returns only one supplied opaque selector and the matching unused PHC, never a
profile ID. Successful start immediately scrubs that PHC. Recovery completion deletes the remaining
batch; regeneration and profile deletion revoke active recovery authority. The terminal authority
row stores only opaque IDs, keyed/challenge/context digests, state, and timestamps. Revision 0023
adds bounded physical cleanup after expiry, but a public cadence, monitoring, backup-purge evidence,
and deployed execution remain required before a real endpoint is enabled.

The local account rotation application generates exactly ten selector/secret codes only after a
fresh passkey assertion. It derives PHCs sequentially under a distinct recovery-only pepper, sends
only selectors and PHCs to the fixed database call, and returns plaintext only after atomic
replacement succeeds. The HTTP response is `no-store`; the account component keeps the codes only in
memory for one display and adds no log, audit field, cache, download, analytics, or browser
persistence. The decoded configuration buffer is overwritten after the generator copies its
process-lifetime pepper. Tracked pepper, work-factor, and response-floor values are non-working
placeholders. The local recovery endpoint accepts one code and replacement label in a bounded
same-origin no-store request, immediately reduces the code to its selector plus copied secret bytes,
and clears the code input after the options response. Known, wrong, unknown, and malformed admitted
attempts perform matching or dummy Argon2id work without logging or retaining the plaintext. The
short-lived authority secret and challenge exist only in a purpose-separated encrypted HttpOnly
cookie; the database receives only digests. Revision 0020 adds no table or personal-data column and
returns only the already mapped profile ID, handle, and locale after atomic completion so the normal
session cookie can be sealed. There is no browser persistence, analytics, notification address, or
new third-party transfer.

Revision 0007 implements the database-only Usage/Security rows named above. It stores an exact
private daily value, opaque device/source/sync identifiers, bounded connector/Codex versions, body
and nonce digests, the submitted signature, closed outcome/reason state, and server timestamps. It
adds no prompt, conversation, repository, account email, credential, IP address, arbitrary JSON, or
free-form diagnostic field.

ADR 0015 stores no field. Its local pure verifier transiently copies the exact private Usage body
and required Security headers, reads one configured origin HMAC secret plus minimal device public
verification material, and computes exact-body and nonce digests. It returns only the existing
canonical payload, public device ID, internal device-key ID, idempotency key, submitted signature,
and the two digests to the narrow ADR 0016 adapter. It returns no raw body, origin
secret/proof/nonce, device public key, callback error, or parser detail and has no log, cache,
analytics, export, network, or persistence sink. Revision 0012 now implements the injected callback
with exactly the key ID, domain-separated digest, and exact expiry through a strict local adapter.
The transport-free ADR 0019 application composes that verifier and adapter with synthetic/mock-pool
evidence; the separate PostgreSQL suite proves access and bounded deletion. The full synthetic
loopback gate additionally proves the composed transient flow and exact stored allowlist through a
disposable login, including controlled four-slot no-queue settlement, without adding a retained
field, timing history, log/export sink, deployment connection, or production schedule.

ADR 0017 implements only the process-side reader for the already mapped origin key/key-ID class. It
requires one primary and at most one complete secondary pair, passes decoded copies directly into
the verifier constructor, returns no configuration object, and overwrites its temporary decoded
buffers. The environment strings and verifier-owned copies remain protected runtime memory; no
JavaScript memory-erasure guarantee is claimed. Synthetic tests add no real key, user field, store,
log, metric, cache, export, edge signer, or retention sink.

ADRs 0016 and 0018 add no user field. The adapter reconstructs the origin key ID, digest, and
expiry, then reconstructs the verifier allowlist, copies the existing digests, signature, canonical
payload, and identifiers, creates one opaque snapshot UUID, reads the existing minimal device tuple,
and sends only those values to fixed procedures. Mock pools retain nothing. The opt-in integration
uses only an obviously synthetic password in a disposable process/container and removes its blocker,
container, network, and storage; owner-only stored state plus the aggregate count of four
lock-waiting Ingest queries are asserted in process and not logged, retained, or exported. It also
passes only the same synthetic protected fields to one built-entry-point child, retains no child
output, and forcibly ends only that child after one accepted request. The separate signal harness
builds a link-free exact production graph in ignored `target/`, passes one synthetic signed body and
headers only through a capability-free client container's stdin, retains only its bounded generic
HTTP result in test-process memory, requires empty host output, fingerprints the read-only runtime,
and removes both containers, all database state, and the temporary directory. The Ingest deployment
login and password remain a separate Security configuration class: protected environment and driver
memory only, never a tracked value, log field, metric, response, or error cause. The config makes
the password non-enumerable and JSON-redacted, and monitoring receives only `idle_client_error`.
Real secret delivery, rotation, access review, and deployment TLS/login evidence remain deployment
work. Existing 15-minute device-nonce and 30-day raw-snapshot retention are unchanged.

ADR 0019 adds no user field or retention sink. The application transiently passes the already mapped
Security and Usage allowlist from verifier to adapter and creates one Operational 128-bit request ID
plus a coarse accepted/duplicate/quarantined or generic error decision. It returns the ID only in
the validated application body, accepts no inbound correlation value, and retains no copy. It has no
log, metric, cache, analytics, export, HTTP header, or database field for the ID or decision. A
future transport or monitoring sink must map its exact access and bounded retention before
collection.

ADR 0020 adds no retained field, record, or diagnostic sink. The local Fastify factory transiently
copies the existing Usage body, required Security headers, and bounded Operational transport headers
into the verifier without parsing and serializing signed content again. Unrecognized header values
are treated as Prohibited input and discarded after bounded validation. Framework logging is
disabled; the server does not retain or log the body, headers, URL, forwarded address, user agent,
proof, nonce, signature, public key, sync ID, or framework error. Proxy trust and inbound request
IDs are disabled. A transport-only failure creates the same Operational 128-bit request ID class,
returns it only in the bounded problem body/header, and discards it. Success/problem serialization
adds no cookie, CORS grant, cache, analytics, metric, export, database column, or new network
destination. Loopback and injection tests use synthetic values only. A future access log, metric,
trace, proxy signal, or monitoring backend requires a separate mapped purpose, access policy, and
retention decision before collection.

ADR 0033 adds the listener/process boundary without collecting or retaining another user field. ADR
0055 adds the non-personal `VIBERACING_INGEST_ENABLED` Operational startup value and evaluates it
before every other host or protected application field. Disabled input is discarded with no second
field read; successful startup retains only literal `true` in the frozen local configuration. The
enable value, listener host, port, TLS declaration, and drain window are used only to validate one
startup/bind and bounded shutdown; the host does not serialize, log, export, or persist them. It
adds no access log, metric, trace, analytics event, cache, request header, database column, or
network destination. Any future dynamic control, diagnostic, or monitoring sink still requires a
separate purpose, access, and retention decision.

ADR 0056 adds the non-personal `VIBERACING_PUBLIC_RANKING_ENABLED` Operational module-load value.
The server-only resolver inspects only that own string field and retains one frozen boolean
decision. It does not serialize, log, export, persist, transmit, or attach the input to a request,
metric, trace, audit event, cache key, database row, or browser payload. Disabled GET uses the
existing public request-ID and generic no-store 503 fields already mapped for the score/race/status
HTTP boundary; it adds no new response or retained field. Any dynamic control, operator event,
monitoring sink, or deployment audit still needs a separate mapped purpose, access policy, and
retention decision.

ADR 0057 adds the non-personal `VIBERACING_PAIRING_ENABLED` Operational module-load value. The
server-only resolver inspects only that own string field and retains one frozen boolean decision in
each pairing route module. It does not serialize, log, export, persist, transmit, or attach the
input to a request, metric, trace, audit event, cache key, database row, cookie, native credential,
browser payload, or error. Disabled POST may cancel its existing request body and uses the already
mapped opaque request ID plus generic no-store 503; it adds no response or retained field. The
`/connect` shell adds no flag exposure or browser persistence. Any dynamic control, operator event,
monitoring sink, or deployment audit still needs a separate mapped purpose, access policy, and
retention decision.

ADR 0058 adds the non-personal `VIBERACING_SOURCE_CREATION_ENABLED` Operational module-load value.
The server-only resolver inspects only that own string field and retains one frozen boolean in the
`/connect` page and both approval route modules. The page serializes only the boolean to its
same-origin client tree so EN/RU controls can omit the unavailable new-source choice; it is not
stored in browser persistence or sent to another origin. The exact `new`/`existing` choice is an
already mapped Security input and database challenge field; the purpose-separated encrypted approval
continuation now retains that same enum for at most five minutes and includes it in the v2 context
digest. No new user field, free text, cookie lifetime, database row, metric, trace, audit event,
export, cache key, or network destination is added. A future dynamic control, operator event,
monitoring sink, or deployment audit still needs a separate purpose, access policy, and retention
decision.

ADR 0059 adds the non-personal `VIBERACING_CAR_PROPOSALS_ENABLED` Operational module-load value. The
server-only resolver inspects only that own string field and retains one frozen boolean in the
account page, browser create/approve modules, and device proposal module. The account page
serializes only the boolean to its same-origin server-rendered tree so EN/RU controls can omit
mutation while preserving active/private state and exact rejection; it is not stored in browser
persistence or sent to another origin. The browser/device HTTP boundaries use the boolean only for
an in-process admission decision. No recipe, proposal, account, session, source, device, cookie,
database row, metric, trace, audit event, export, cache key, or network destination is added or
extended. A future dynamic control, operator event, monitoring sink, or deployment audit still needs
a separate purpose, access policy, and retention decision.

ADR 0060 adds the non-personal `VIBERACING_ENROLLMENT_ENABLED` Operational module-load value. The
server-only resolver inspects only that own string field and retains one frozen boolean in both
enrollment page modules and all four GitHub/initial-passkey route modules. Each page passes only the
boolean through its same-origin server-rendered component tree so EN/RU controls can omit the
unavailable form; it is not stored in browser persistence or sent to another origin. The HTTP and
service boundaries use the boolean only for in-process fail-closed decisions. No invite, OAuth,
passkey, session, account, cookie, database row, metric, trace, audit event, export, cache key, or
network destination is added or extended. A future dynamic control, operator event, monitoring sink,
or deployment audit still needs a separate purpose, access policy, and retention decision.

ADR 0061 is a separate Jobs-only retention capability, not behavior of that module-load value. It
adds no cookie, field, identifier, metric, log, or network destination and is described with
revision 0038 below.

ADR 0021 adds no collected or retained field. The connector library transiently validates the stable
initialization response's Codex home, platform family, operating-system name, and user agent under
fixed string/frame bounds, then discards all four values before returning. ADR 0022 then validates
the candidate `0.144.5` account variant and immediately discards email, plan, and nullable summary
values. Only the already mapped private `codexReportedDate`/token entries leave the parser in
caller-owned memory: at most 31, sorted, unique, calendar-valid, and integer-bounded. Its diagnostic
representation contains entry count only. The local Codex home and account email remain prohibited
outside their validators. At this parser boundary no value reaches a log, metric, file, database,
cache, analytics event, export, key, or network sink; ADR 0031 separately permits only the minimized
daily entries to enter the already mapped signed sync payload.

ADR 0023 adds no collected or retained field. The one-shot supervisor receives only a
capability-owned executable path, isolated working directory, and allowlisted environment values;
none has a public accessor or diagnostic representation. It reads no ambient environment, launches
only one fixed argument over local pipes, retains at most three 16 KiB stdout frames in bounded
memory, and permits only 8 KiB discard-only stderr before failing on the next byte without retaining
or returning its content. Child status, operating-system errors, paths, environment values, and raw
output never enter returned errors. The only success result is the already mapped minimized
`DailyUsage`, returned after terminal-event checking and child reap. Synthetic tests use a
target-built fixture and temporary directory only. `ReviewedCodexLaunch` has no public constructor;
ADR 0031 permits only the private exact-admission command to construct it. No path, environment
value, or child output is retained. ADR 0052's later candidate admission diagnostic remains
process-free and non-retained. ADR 0054's explicit stdout preview adds only the allowlisted
version/support fields and coarse Operational admission class mapped below. Any future retained
connector/Codex value or automated diagnostic export must use the existing mapped
Security/Operational class with an explicit purpose and bounded retention.

ADR 0024 adds no new data class or persistent field. It consumes the already mapped private daily
usage plus reviewed opaque source, sync, device, millisecond UTC, and nonce values in transient
memory. The exact JSON body and LF-separated signing message contain private usage and security
material and deliberately implement no diagnostic, clone, display, or serialization surface. The
composer emits no log, metric, file, database value, cache, analytics event, export, or network
request. Its shared test vector uses only synthetic identifiers and values.

ADR 0025 adds no persistent field or sink. It removes every public accessor from the unsigned
prepared value and consumes it only with an inaccessible capability containing the already mapped
private device signing key plus its public device ID. The returned closed envelope exposes only the
same exact body and five bounded header values to the bounded one-shot transport. Prepared
body/message buffers, the signed body buffer, and the upstream signing key are zeroed on drop; this
is defense in depth, not a guarantee that compiler, caller, or operating-system copies are erased.
The key capability has no constructor, accessor, clone, diagnostic, serialization, file, store, or
network surface. The extended public vector contains only synthetic usage/identifiers, a public key,
and a signature; its private test seed is deterministically derived at runtime from an obvious fixed
label. ADR 0030 separately adds OS-store custody, fresh entropy, bounded pairing clock/retry
handling, and fixed start/poll egress.

ADR 0031 adds no persistent field, log, metric, cache, analytics event, export, or browser storage.
The private sync command transiently reads the active record's already mapped source/device IDs and
device key, generates one random sync ID and nonce, formats current millisecond UTC, and sends only
the existing `ConnectorSyncV1` body plus five device-authentication headers to the explicit origin.
Only the selected exact version is displayed locally before launch. The canonical executable path,
exact usage, body, key, nonce, signature, identifiers, and acknowledgement request ID are neither
sent as diagnostics nor printed. The synthetic HTTP test uses only reserved values; repository tests
never open a real credential or local account.

ADR 0051 adds no collected or retained field and no new sink. Only after active-record validation,
the candidate sync command may transiently read a `PATH` value of at most 65,536 encoded bytes,
inspect at most 64 absolute directory strings, join only two fixed filenames, canonicalize candidate
paths of at most 2,048 encoded bytes, inspect exact-size regular-file metadata, and hash at most
four distinct candidates. Those local Security/Operational values, operating-system errors, paths,
metadata, and digests are never logged, printed, retained, exported, written to a credential, or
sent over the network. The explicit path fallback has the same non-reflective exact admission.
Synthetic tests do not inspect an installed Codex binary or real user path.

ADR 0052 adds no data class, retained field, or sink. An explicit `check-codex` invocation may
perform only ADR 0051's same bounded local selection and exact admission before pairing. It opens no
credential-store account, starts no process, reads no Codex account or usage, creates no request,
and uses no network. The selected or discovered path, `PATH` entries, metadata, digest, and
operating-system failure remain transient Security/Operational material and are never printed,
logged, cached, exported, persisted, or converted into reusable sync authority. Success exposes only
exact candidate version `0.144.5` plus the explicit statement that no version is supported; later
sync independently re-admits after active-record validation.

ADR 0053 adds no data class, retained field, or sink. The Windows portable smoke transiently reads
only the fixed repository-built connector path, its bounded size and SHA-256, one random temporary
path, the exact child status/output, and the temporary directory inventory. Those local
Security/Operational values are used only for copy integrity, the closed command decision, and
removal; failure reflects only a fixed stage name. The child receives no profile, credential, proxy,
repository, Git, Cargo, or CI environment value, and runs no account, usage, pairing, sync,
proposal, credential-removal, or network operation. The copied binary and random directory are
removed after each result. No path, digest, child output, artifact, log, metric, cache, credential,
database field, analytics event, export, or network destination is retained or published.

ADR 0054 adds one explicit stdout-only diagnostic preview but no retained field or automatic sink.
It exposes only the compile-time connector version, fixed candidate platform/version contract, one
closed passed/not-admitted/unsupported-platform class, the empty support state, and fixed statements
about included/excluded data and side effects. The exact/discovered path, `PATH` entries, metadata,
size, digest, operating-system error, hostname, username, environment values, credential state,
source/device identity, account, usage, repository, prompt, conversation, and child output stay
absent. A failed admission remains nonzero. The connector does not create a file, clipboard value,
archive, log, metric, telemetry event, support ticket, upload, or network destination; the user must
review stdout before deliberately sharing it. Shell redirection remains a user-controlled external
sink and is not represented as connector retention.

ADR 0026 adds no data class, persistent field, or sink. The Rust kernel transiently receives the
already mapped pending private key plus pairing ID/challenge, derives the already mapped public key,
and returns only the existing ID/signature class. The Web kernel transiently copies the approved
pairing ID/challenge/public key and submitted signature, reconstructs the exact possession message,
returns one boolean, and overwrites its copies after settlement. Neither kernel has a poll token,
user code, profile/source identifier, cookie, log, metric, cache, analytics event, database call,
export, or network destination. The public vector is entirely synthetic and contains no private key
or bearer value. Runtime buffer overwriting is defense in depth, not an erasure guarantee. A future
route, diagnostic, or retention sink requires a separate privacy review.

ADR 0027 consumes only those existing classes. The Web application transiently decodes one 32-byte
poll token, derives two 32-byte HMAC candidates under a retained primary and optional secondary
protected key, obtains the already mapped approved pairing ID/challenge/public key, and passes the
existing signature through the pure verifier. The SQL procedure retains only the already mapped
activated device ID and bounded audit reference. Candidate/token/material copies are overwritten
after settlement and configured key buffers on close; runtime and driver copies are not an erasure
guarantee. The local admission/timing gate retains only an integer active count and no token,
digest, address, user agent, profile, or result history. No log, metric, cache, cookie, analytics
event, export, network destination, or new database field is added. ADR 0030 separately maps the
HTTP/client identity and fixed anonymous rate state. The implemented authenticated browser approval
is mapped in the table above and described below.

ADR 0028 consumes the same mapped pairing and metadata classes for a transport-free start. It
accepts only one canonical public key, bounded non-personal device label, syntactic connector
version, OS family, and architecture; creates fresh pairing/pending-key/request IDs, poll token,
challenge, 60-bit human code, and nine-minute expiry; and persists only the existing bounded
metadata plus separate primary poll/code HMAC verifiers. The primary and optional secondary code
keys are protected configuration distinct from every poll key. Malformed admitted requests retain no
input or result history and perform no database write. Candidate, material, parameter, and
configured key copies are overwritten where ownership permits, but strings, runtime copies, and
driver internals are not an erasure guarantee. This adds no field, log, metric, cache, cookie,
analytics event, export, or network destination. Revision 0013 and ADR 0029 supply the bounded local
physical pairing-row/key deletion capability. ADR 0030 separately adds the fixed start route, client
identity, and aggregate rate state without adding diagnostics or per-client database rows.

ADR 0030 gives the pairing command one explicit canonical HTTPS origin (or loopback HTTP in local
development) and persists one fixed-size `prepared`/`pending`/`active` credential under a
domain-separated origin/label account name. The record contains the origin digest, anonymous client
ID, private key, pending token/challenge/code/transaction or active source/device binding. It is
available only to the current user's native credential store and connector process; there is no
plaintext file fallback, log, diagnostic export, browser copy, analytics event, or generic network
destination. Prepared state is written before egress, pending before code display, and active before
success output. Pending fields are overwritten on local activation/expiry. ADR 0041 adds an exact
`forget-local` command that deletes the entire origin/label record through the native API without
loading it. It emits the same result when the record is absent and neither contacts the service nor
revokes the server device. Rotation remains a separate unimplemented lifecycle.

The raw anonymous client ID crosses only the exact start/poll header. Web derives a domain-separated
32-byte SHA-256 digest and clears the decoded copy. PostgreSQL uses only the first digest byte
modulo 64 to select a fixed bucket and retains no ID or digest. Revision 0022's 130 rows contain
only operation, bucket, millisecond window start, and saturated count. Window values reset in place,
so identifier rotation cannot grow storage. Revision 0037 additionally lets only Jobs scrub a
positive aggregate timestamp/count after the maximum one-hour duration while preserving every fixed
row. The ID is rate shaping, not authentication, account identity, device fingerprinting, or a
substitute for a reviewed edge/IP policy. The reset is in the default-off local hourly catalog, but
only the combined synthetic scheduler/PostgreSQL integration exercises it; no deployed cadence
exists.

Revision 0021 stores only a window start and bounded attempt count on the already mapped active
session. Every admitted canonical or malformed code reaches the same primary/optional-secondary
keyed lookup shape; plaintext codes and candidate digests are transient and are neither logged nor
retained. A successful lookup returns only bounded pending metadata and a full public-key
fingerprint to the signed-in browser. The connect render also reuses the mapped bounded inventory,
but includes only active source ordinals, active device labels, and the existing encrypted
session-bound source-control token. A selected existing source ID is recovered server-side from that
token; a new source ID is generated server-side. The exact pairing/source IDs, challenge, and expiry
are then sealed in the purpose-separated HttpOnly continuation until fresh WebAuthn verification and
atomic approval. No raw source ID, IP address, user agent, per-attempt record, analytics, cache,
export, retained field, or new network destination is added.

Revision 0008 adds deletion evidence for only those raw nonce and snapshot rows: a Jobs-only
procedure derives cutoff time on the server, deletes bounded expired batches, cascades raw entries,
and preserves the current source/day value while clearing its deleted snapshot reference. A fixed
owner-only mutex row and five-second lock timeout prevent runtime roles from seizing a public lock
key or waiting without a database bound. The synthetic PostgreSQL suite proves idempotency, live-row
preservation, role denial, and two-worker serialization. The default-off local catalog includes the
fixed command, and the combined synthetic scheduler/PostgreSQL integration exercises it. No service,
deployed retention monitor, backup policy, or real-user purge evidence exists, so real-user
ingestion remains blocked.

Revision 0012 adds one short-lived Security table with no user binding: `origin_nonces` contains
only the closed origin key ID, a versioned domain-separated 32-byte nonce digest, and millisecond
expiry. It stores no raw nonce, proof, HMAC key, body, header, IP address, profile, source, device,
or free-form field. Atomic consume and an ordered lock-wait race prove one fresh acceptance across
contenders. The revision extends the existing Jobs procedure so origin, device, and snapshot rows
are each independently capped by the requested batch. A tuple is unusable at expiry, no later than
the verifier's bounded proof lifetime; physical deletion still needs a deployed schedule, monitor,
backup policy, and purge evidence.

Revision 0013 deletes only already expired, non-activated pairing transactions and their exact
still-pending key. It covers pending display metadata, keyed poll/code verifiers, challenge,
approval provenance, and pairing-bound approval challenges without introducing a new collected
field. A separate owner-only mutex and oldest-first 1-to-1000 batch bound each call; activated/live
pairings, active or revoked keys, sources, profiles, credentials, and audit events remain. The local
Jobs runner can invoke one fixed maximum pairing batch and discards the two counts. The default-off
local catalog and combined synthetic PostgreSQL integration exercise it, but no monitor, backup
policy, deployed retention cadence, or real-user purge evidence exists.

Revision 0023 adds no collected field. It deletes independently bounded expired authentication
challenges and restricted recovery authorities, plus only an exact still-present source code in
used/scrubbed form. Live challenges and authorities, unused recovery codes, sessions, passkeys,
profiles, sources/devices, and audit rows remain. One fixed private mutex serializes cleanup
workers; stable profile-first locking matches recovery/deletion transitions, and observed worker
plus recovery-start races cover that order. The local Jobs runner discards all three counts. The
default-off local catalog and combined synthetic PostgreSQL integration exercise it, but no monitor,
backup policy, deployed retention cadence, or real-user purge evidence exists.

Revision 0024 adds no collected field. It reads only due opaque deletion jobs already created by the
exact-handle/fresh-passkey request and requires their linked profile to remain `deletion_pending`.
One maximum-10 transaction removes restrictive profile-bound pairing rows and authority-free pending
keys, marks the exact job terminal, then cascades primary invite, identity, session, passkey,
recovery, source, device, usage, and personal score rows. The job's profile link and every retained
audit profile link become null; the random 32-byte job reference, closed state, and timestamps
remain for at least 30 days after server-recorded completion. Revision 0032 then permits only Jobs
to remove maximum-1000 oldest-first terminal, profile-free jobs under the profile-deletion mutex;
recent and non-terminal rows remain. The local Jobs mapper discards both aggregate counts. No
identity-derived tombstone is created because no reviewed keyed digest/expiry/restore contract
exists. The command is in the default-off local catalog and combined synthetic PostgreSQL
integration; deployed scheduling, public cache purge, backup expiry, restore replay, monitoring,
capacity, production login, and real-user evidence remain required.

Revision 0033 adds no collected field. It deletes an oldest-first, 1-to-1000 batch of database audit
events only after 180 days from server-recorded occurrence. Both profile-linked and already redacted
rows are eligible; recent rows remain. One separate private mutex serializes workers, and the local
Jobs mapper discards the count. The table's random request/event uniqueness is therefore finite
evidence, never authority. The combined synthetic scheduler/PostgreSQL integration exercises this
cleanup. No external append-only sink, user-visible audit subset, monitor, backup purge, production
login/TLS, capacity result, or deployed retention evidence exists.

Revision 0034 adds no collected field. It redacts only `approved_by_session_id` and
`approved_by_passkey_id` from an oldest-first, 1-to-1000 batch of activated pairings at least 180
days after server-recorded activation. The approved profile/source and activated device binding,
pairing transaction, device row, passkey row, approval/activation times, and cryptographic
transaction material remain. The existing authentication and pairing mutexes serialize that exact
transition with session cleanup, pairing cleanup, and primary profile purge; partial,
pre-activation, or binding-changing redaction fails closed. A later session-cleanup invocation can
remove an expired session once no rotation or pairing reference remains. The local Jobs mapper
discards the count. Historical pairing/device rows and passkey lifecycle remain outside this slice;
ADR 0050 separately bounds fixed rate-window reset. Both objects are in the default-off local
catalog and combined synthetic PostgreSQL integration, with provenance redaction ordered before
dependent cleanup. Deployed scheduling, monitoring, backup purge, production login/TLS, capacity,
and retention evidence remain absent.

Revision 0035 adds no collected field. It deletes an oldest-first, 1-to-1000 batch of passkey rows
only after server-recorded revocation is at least 180 days old and no session, verifying or
authorized challenge, or pairing transaction retains the exact passkey ID. Candidate rows are locked
and every eligibility predicate is repeated at deletion. Active, recent, and referenced rows remain;
the local Jobs mapper discards the count. The operation can free the unchanged 32-row add/recovery
ceiling. The object is in the default-off local catalog and combined synthetic PostgreSQL
integration, but has no production login/TLS, monitoring, capacity, backup purge, or deployed
retention evidence.

Revision 0036 adds no collected field. It deletes an oldest-first, 1-to-1000 batch of exact
activated-pairing/revoked-device pairs only after both activation and revocation are at least 180
days old, the pairing's approving session/passkey references are already null, and no authorization
challenge, device nonce, or raw usage snapshot remains. Candidate pairing and device rows are locked
together; every predicate is repeated; and exactly one pairing plus one key must be deleted or the
operation rolls back. This removes pairing verifiers/challenge/metadata/bindings and the revoked
public key/label/version/platform/lifecycle row without cascading raw evidence or changing derived
Community values. The local Jobs boundary validates both equal counts and the CLI then discards
them. The object is in the default-off local catalog and combined synthetic PostgreSQL integration,
but there is no production login/TLS, monitoring, capacity, cache/backup purge, restore replay, or
deployed retention evidence.

Revision 0030 adds no collected field. It deletes an oldest-first, 1-to-1000 batch of already
expired session rows only when no retained predecessor points to the row and no pairing transaction
uses it as approval provenance. Session-bound challenges cascade with the selected row. One shared
authentication-retention mutex serializes cleanup with authentication cleanup and primary profile
purge; an observed two-worker race proves bounded serialization and live-authority preservation. The
local Jobs runner discards the count. Recent pairing-referenced expired sessions remain until the
180-day approval-reference window elapses. The combined synthetic integration proves redaction
precedes session cleanup within one cycle; historical pairing/device rows, passkey/device
provenance, backup expiry, deployed scheduling, monitoring, and real-user purge evidence remain
outside this slice.

Revision 0031 adds no collected field. It deletes an oldest-first, 1-to-1000 batch of expired active
or revoked invite rows after the shared authentication mutex. Candidate row locks and repeated
state/expiry predicates preserve an in-flight redemption; live and redeemed rows are never eligible.
The local Jobs mapper discards the count. The object is in the default-off local catalog and
combined synthetic PostgreSQL integration, but deployed scheduling, production login/TLS,
monitoring, capacity, backup purge, and retention evidence remain outside this slice.

Revision 0038 adds no collected field. It removes an oldest-first, 1-to-1000 batch of canonical
`enrolling` profiles only when the exact redeemed invite remains, every associated session is exact
expired enrollment authority, every challenge is exact expired registration authority, and no other
recovery, passkey, source, deletion, scoring, or recipe state exists. The existing cascade removes
that redeemed verifier plus expired session/challenge state; database audit rows remain with null
profile linkage. Authentication/profile-purge mutexes, repeated predicates, and `SKIP LOCKED`
preserve live authority, every non-canonical profile-bound row, and an in-flight initial-passkey
activation. The local Jobs mapper receives and discards only one aggregate count. The operation
creates no replacement invite, deletion job, tombstone, notification, log, metric, cache key, or
export. The object is in the default-off local catalog and combined synthetic PostgreSQL
integration, but deployed scheduling, production login/TLS, monitoring, capacity, backup purge,
restore replay, and retention evidence remain outside this slice.

Revision 0009 reads exact current values only inside an owner-defined Jobs procedure and writes a
strictly smaller private derived set: daily and weekly score, active days, contributing-source
count, shared rank, deterministic display order, ISO-week dates, and immutable Community formula
metadata. It does not copy raw token totals, source IDs, exact sync time, device data, or identity
provider bindings into scoring tables. Hidden/deleting profiles and quarantined sources are
excluded; revision 0024 profile-row purge cascades its open entries and daily scores. A week without
source/day state creates no open season row.

Revision 0019 stores nothing. Its Web-only exact-session procedure reads one bounded Monday's
existing derived season rows, and the local account application keeps that private response
server-rendered and `no-store`. It adds no raw token value, source/device/profile ID, exact activity
time, browser fetch, cache, or storage; a hidden profile renders no score.

Revision 0010 adds only derived deadline and lifecycle metadata to `seasons`: public ISO dates,
`open`/`finalized` state, grace, refresh, and finalization timestamps. Server `receivedAt`, not
client `observedAt`, closes the window. A whole late snapshot remains private 30-day raw evidence
with `season_closed` and creates no accepted source/day value. Finalized metadata and score rows are
immutable except that profile purge removes the profile-linked weekly/daily rows while retaining the
non-personal terminal season definition. A no-data closed week stores only that definition. No
public serializer/cache, audited correction record, deployed Jobs scheduler, or monitoring backend
exists. Revision 0039 separately defines bounded exact-source/day retention after terminal
finalization; it does not define public score-history expiry.

Revision 0039 stores one private derived row per finalized profile/season: the UTC day of the latest
accepted server receipt, bounded contributing-source and source/day counts, deleted-row progress,
and a terminal purge timestamp. It stores no source, device, sync, raw token, exact receipt time, or
new public field. The public status function prefers this rounded date after finalization. Only Jobs
may advance progress one exact row at a time after 30 days while repeated live/captured inventory
checks pass; profile purge cascades the projection. Open, recent, missing-projection, and drifted
state is preserved or fails closed. The object is in the default-off local catalog and combined
synthetic PostgreSQL integration, but deployed scheduling, monitoring, production login/TLS,
correction, cache/backup purge, restore replay, capacity, and real-user retention evidence remain
absent.

ADRs 0014, 0029, 0032, 0034, 0036, 0042, 0043, 0045, 0046, 0047, 0048, 0049, 0050, 0061, and 0063
store no user data. ADR 0062 maps only the smaller finalized projection described above. The local
Jobs process transiently receives only one of twelve fixed 1000-row cleanup batches, one
zero-argument maximum-130 pairing-rate-window reset, one fixed 1000-row pairing approval-provenance
redaction, one fixed maximum-10 profile purge, or one Public season-start label, plus the private
aggregate counts already returned by the procedures. It validates and discards those values within
one process invocation. The CLI emits only one constant completion/failure sentence; it does not log
the command, date, counts, identifiers, SQL, environment, exception, or stack. The optional pool
hook receives only the closed Operational signal `idle_client_error` and has no built-in storage or
network sink. ADR 0063 adds only transient Operational current-clock and derived process-slot
values, plus one fixed job object at a time. They remain in process memory, disappear at shutdown,
and are never logged, exported, or used as database authority. Its optional signal is only
`cycle_failed`; the entry point may emit one generic sentence without a job name, date, count,
identifier, error, or configuration value. The opt-in integration adds no retained field: it creates
obviously synthetic fixture IDs and passwords inside one disposable local PostgreSQL container,
observes only the constant process sentences, asserts state in memory, and removes the container,
network, and storage. Its combined mode additionally keeps only a fixed injected clock value, the
closed job objects, closed per-job outcome values, generic `cycle_failed` signal, canonical
synthetic private-table state, and before/after SHA-256 fingerprints in test-process memory while it
invokes the production scheduler core and real runner; none is written to the repository or retained
after the disposable container is removed. Its timer mode additionally holds only two fixed UTC
clock values, one interval-handler reference/token, three closed due-call records, closed job
objects/outcomes, cleanup counters, generic failure signals, and the terminal reset marker in test
memory. It rearms only the two obviously synthetic pairing-window rows between cycles, retains no
timer history, and removes them with the disposable container. Its lifecycle mode additionally holds
only closed job objects/outcomes, two injected signal-handler references, fixed interval/deadline
handler references and tokens, closed cleanup counters, terminal kind/code, and the omitted reset
marker in test memory; it invokes the omitted reset separately only after proving the scheduler did
not start it. Its emitted-process mode additionally holds only the synthetic narrow-login
environment, real host/database UTC date and derived season targets, terminal reset count, two
output-observed booleans, and child close code/signal in test memory. It discards every child output
chunk without retaining its bytes, forcibly ends only that child after the terminal marker is
visible, and runs the full exact-state oracle immediately afterward. A future durable scheduler
state, run history, metric, alert, retry record, or monitoring backend must map its exact fields,
access, retention, and deletion behavior here before collection.

Revision 0011 stores no new data. One owner-defined function gives only the Web role a fixed
ten-field score projection: season dates/version/finalized state, handle, weekly score, active days,
contributing source count, shared rank, and display position. It filters current profile state to
`active`, re-ranks after that filter, caps one result at 100 rows, and returns no private ID, raw or
daily value, exact timestamp, source/device detail, preference, authentication, recovery, or audit
field. Ingest, Jobs, Admin, and `PUBLIC` are denied. No HTTP serializer, cache, car, streak,
freshness, profile detail, rate/load evidence, monitoring, or public-history retention policy is
implied.

ADR 0010 also stores no data. `CommunityScorePageV1` adds only literal `community` and
`selfReported: true` trust metadata around zero to 32 rows of the same public score fields. The
closed response schema rejects private/unknown fields, daily detail, exact timestamps, car, streak,
freshness, and profile detail. A server-only mapper reads only the exact ten projection columns,
emits the constant trust wrapper, and returns only a validated frozen response; its stable failure
does not include a row value or unexpected field name. Generated TypeScript/runtime validators and a
later OpenAPI operation exist; the local route revalidates the response, but it adds no cache, log
field, analytics field, or retention obligation.

ADR 0011 adds a server-only database adapter but no collected or retained field. It sends one
canonical season label and constant limit to the existing projection, casts the two public calendar
labels to text, and passes only those ten Public columns to the mapper. The deployment login and
password are Security configuration supplied outside the repository: the tracked values are
non-working placeholders, the password is non-enumerable and JSON-redacted in the pool config, and
neither it nor the host, login, SQL, driver error, season input, or row value is included in adapter
errors or monitoring signals. The adapter adds no log, cache, analytics, browser, export, or
retention sink. The local route passes only the validated public season label and retains no request
metadata. The opt-in integration's test-only `auto_explain` sink contains no parameter payload or
real product data, is bounded and private-marker scanned before six closed plan classes are
evaluated, and is deleted with the disposable container. It is not a production logging or
monitoring design.

ADR 0013 adds no store or retained field. `CommunityScoreQueryV1` carries only the public Monday
season label already accepted by the adapter, while the manifest-generated operation fixes
same-origin and `no-store` behavior. The local parser rejects duplicate/unknown query parameters,
encoded field names, bodies, and unsupported media ranges before store work. The route creates one
opaque request ID but no URL/header log, cache entry, analytics event, new network destination, or
retained record; it must not record the raw URL merely to diagnose an invalid date.

The visible home consumer adds no collected or retained field. The server derives only the current
Public Monday label; after hydration, the browser lazily loads a compact validator and sends it once
to the separate same-origin status route without cookies or credentials. It validates the closed
Public response, complete-UTC-day freshness, optional preference-gated streak, and optional exact
active recipe in memory and does not cache or persist them. Profiles without an active recipe use
fixed project-owned presentation placeholders; an omitted streak remains absent. A failed or invalid
response leaves the explicitly synthetic fallback visible and creates no retry, log, metric,
analytics, export, or third-party request.

ADR 0035 adds only the exact version 1 recipe columns, a server UUID, profile foreign key, and
server-created/expiry timestamps. The proposal ID and profile ID remain server-side; the account
receives a purpose-separated encrypted decision control bound to its session and bounded expiry. No
prompt, conversation, arbitrary color, URL, path, file, markup, binary, IP address, user agent, or
exact activity is collected. Approval/rejection/replacement/profile purge removes the pending row,
while active state lasts until change or profile deletion. Expired proposal rows are unusable and
revision 0026 provides a bounded Jobs-only physical cleanup; no deployed retention cadence is
claimed.

ADR 0038 adds no recipe field or third-party destination. The connector creates only a fresh 16-byte
nonce and canonical timestamp around the exact enum body already mapped above. Web overwrites every
owned raw-body, signature, nonce, public-key, and canonical-message byte-buffer copy after
settlement; Rust clears its owned proposal buffers on drop. Platform-managed header strings are not
retained or logged by the application. Revision 0028 retains only a domain-separated 32-byte nonce
digest for seven minutes in the existing replay table, plus the same private recipe and server-owned
proposal metadata. No prompt, conversation, account email, profile/source ID, IP address, user
agent, analytics, cache, export, or support record is added. The generic acknowledgement returns no
proposal identity. The cleanup object is in the default-off local catalog and combined synthetic
PostgreSQL integration, while production credentials, deployed scheduling, monitoring, capacity,
packaging, release, and deployment remain unproved.

ADR 0039 adds no service request, retained field, log, cache, analytics event, export, or
third-party destination. The Agent Skill processes the user's existing style request only to select
the seven canonical enums and one bounded seed, then passes those fields plus an explicitly supplied
origin and shell-safe paired-device label to the existing connector command. It does not forward or
retain the request text in Vibe Racing, inspect credentials or local state, or receive proposal
identity or decision authority. The origin and label remain transient process arguments under the
user's local agent environment; the proposal service still receives neither value as stored profile
data.

ADR 0044 adds no Vibe Racing service request, retained repository field, application log, cache,
analytics event, export, or third-party destination. The repository-verification Agent Skill runs
inside the user's existing authorized agent environment and reads only repository state and command
results in that scope. It reports a sanitized evidence summary in the current agent interaction,
creates no repository persistence, does not install dependencies or access live/network services,
and forbids copying secrets, environment values, private logs, or local absolute paths into tracked
files or public artifacts.

ADR 0037 and revision 0027 add no new retained field. `CommunityRacePageV1` repeats the ten public
score fields and may add only the exact current approved `CarRecipeV1`; absence is explicit through
field omission. The database resolves only the current `active` profile after score visibility
filtering and constructs the object from constrained columns. Proposal identity, state, timestamps,
private IDs, raw/daily usage, and account authority never cross this boundary. The stable score
response remains unchanged. The recipe is current presentation state, not a historical season
snapshot, and grants no score or privilege. Hide or profile purge removes the complete row from the
next no-store response, but a visitor may retain a copy already observed. No cache, log, analytics,
export, new third-party destination, live credential, monitoring sink, or deployment is added.

ADR 0040 and revision 0029 also add no retained personal field. `CommunityRaceStatusPageV1`
preserves the separate race fields and adds only `freshnessDays` plus optional `streakDays`.
Freshness is saturated complete UTC days since the latest accepted server receipt within the
requested season; the exact timestamp never crosses the function, mapper, route, or browser
boundary. Streak is derived from consecutive positive materialized daily scores at read time and is
omitted unless the current active profile enables `streak_visible`; neither the preference nor the
underlying daily sequence is returned. The query adds one partial positive-score index but no new
row, timestamp, log, cache, analytics, export, or third-party destination. Profile hide/purge still
removes the complete row from the next no-store response, while already observed coarse status can
be archived by a visitor. No cache purge, scrape resistance, live credential, monitoring, load
evidence, or deployment is proven.

## Prohibited data

The connector, schemas, services, logs, analytics, support process, fixtures, and release artifacts
must reject or omit:

- prompts, conversation or thread content, model responses, approvals, tool calls, and MCP data;
- repository names, paths, contents, diffs, Git metadata, shell history, and terminal output;
- Codex authentication tokens, ChatGPT cookies, API keys, cloud credentials, and account email;
- arbitrary files, screenshots, archives, images, SVG, HTML, CSS, scripts, shaders, or remote URLs;
- browser exports, credential-store contents, private messages, production database copies, and raw
  incident evidence;
- exact private anti-abuse thresholds or internal detection signatures.

The planned connector may inspect an allowlisted account-mode field locally to reject unsupported
auth modes, but it does not serialize or transmit the account response. Unknown or expanded upstream
schemas fail closed.

## Data flows and access

The canonical flow diagrams are in [data flow](../architecture/DATA_FLOW.md). The access model is:

- Web/Auth owns profile identity, sessions, passkeys, restricted recovery, preferences, device
  approval, deletion initiation, and one active-profile public score projection; it cannot use a
  device credential or recovery authority as a user session or read private score inputs.
- Ingest accepts only source-bound signed sync through a narrow procedure; it cannot read or change
  passkeys, sessions, invites, admin roles, schema, or finalized seasons. The local verifier has
  only origin-nonce and minimal device-lookup capabilities. The separate adapter owns only fixed
  origin-consume/lookup/submission calls and a protected database config contract; the HTTP server
  and host only preserve/serialize the reviewed boundary. One opt-in synthetic integration opens a
  disposable loopback connection under a dedicated Ingest login and retains no added log, metric,
  analytics, cache, or export. None of these boundaries has deployment authority.
- The connector library validates and discards the App Server initialization values and candidate
  `0.144.5` account/summary fields, then exposes only bounded private daily usage to its caller. It
  composes that sequence only behind a reviewed-launch capability with no public constructor and
  bounded synthetic process evidence. It can compose exact sync bytes only behind a second
  inaccessible reviewed context and sign them only behind a third inaccessible one-use device-key
  capability. `connect` owns native key persistence and fixed start/poll egress. The separate
  private Windows sync command can construct those capabilities only after active-record review and
  exact artifact admission selected through bounded fixed-name discovery or an explicit path, then
  make one fixed signed upload. The separate `check-codex` command can perform only that admission
  without credential, process, account, persistence, or network access and grants no authority to
  the later sync. It has no other-platform admission, log/export capability, package, or release;
  the candidate remains unsupported until clean-machine platform, privacy-egress, packaging,
  provenance, and release gates pass.
- Jobs currently receive only bounded cleanup of expired authentication, abandoned-enrollment,
  invitation, ingest, finalized source/day, pairing, session, CarRecipe-proposal,
  terminal-deletion-job, database audit-event, and aged unreferenced revoked-passkey plus minimized
  revoked-device state; bounded aged pairing approval-provenance redaction; fixed anonymous
  pairing-rate-window reset; maximum-10 primary profile deletion; open-season Community scoring
  refresh; explicit terminal finalization; and zero-argument oldest-known historical season
  finalization. The backlog function derives its selected date only from already-retained
  open-season or source/day state, returns only a closed 0-or-1 count plus the existing bounded
  profile count, and the application discards both values. The existing source-date index and one
  new partial open-season index cover only already-mapped private date/source and season-state keys;
  it adds no field, row, queue, run ledger, retry counter, log, metric, cache, export, or
  destination. The local one-shot adapter rechecks the exact Jobs-only login and invokes one
  prepared capability without logging inputs or results. The separate default-off scheduler can
  supply only those fixed objects from UTC in-memory slots and retains only the closed Operational
  state described above. Correction, cache/backup purge, tombstone/restore replay, and remaining
  retention capabilities require separate migrations and tests; migrations use a different
  non-runtime owner.
- The local database integration may copy only its own synthetic current state into bounded
  child-process buffers and two custom archives inside one disposable container. It hashes and
  overwrites canonical buffers, never emits archive or dump content, and removes the container-only
  archives with the ephemeral `tmpfs` service. It has no path to a shared or production database and
  proves no external backup retention, encryption, access policy, or stale-backup deletion replay.
  Before those copies, its migration-overlap drill uses only the unchanged public migration SQL,
  synthetic process application names, exit statuses, and expected duplicate-object SQLSTATE in
  bounded harness memory. The expected loser's SQL output is not emitted or retained; successful
  output contains only the aggregate evidence class. This adds no product field, log, fixture,
  cache, archive, metric, or release artifact. The separate migration-runner core reads only those
  public catalog bytes plus transient protected host/port/database/login/password/TLS configuration.
  The password is bounded, non-enumerable, and JSON-redacted; no configuration, SQL, path, revision,
  digest, count, row, or driver error reaches its fixed process sentences. Its fixed application
  name and in-memory control state are Operational, disappear at process exit, and are not retained
  by this repository. A deployment log, metric, operator identity, timestamp, or migration detail
  requires a separate mapped purpose, access policy, and retention decision before collection. The
  opt-in PostgreSQL gate uses only obvious synthetic logins/passwords, an in-memory bounded closed
  observation, and one generated one-hour certificate/key directory. Child output is bounded to the
  fixed generic sentences; the harness persists or emits no SQL, row, database error, credential, or
  dump content and removes every process/container/network/storage/TLS resource. It touches no
  shared or persistent database and adds no product-data collection.
- The database public score model, response-only contract, mapper, and bounded server-only adapter
  contain only fields explicitly classified Public. A deployment login is Security configuration,
  not response data, and the adapter verifies that it has only Web membership before reading. The
  local query/response route adds no cache or retention sink and is not deployed. The visible
  browser now consumes its current-week Public response transiently and falls back to synthetic data
  without retaining either response or failure detail. Authenticated responses are private and
  `no-store`; future public cache keys cannot include or mix session state.
- Admin access is separate, reasoned, passkey-stepped-up, and audited. Routine support has no need
  to read exact usage.

Every database role is tested against an allow/deny capability matrix. Application code must not
compensate for an over-privileged role.

## Planned service providers

No provider account or production deployment is configured in the current tree. Before beta, the
Privacy Policy records the actual entity, region options, data purpose, retention, transfer terms,
and deletion path for every enabled provider.

| Provider category                 | Planned purpose                                                        | Data boundary                                                                       |
| --------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| GitHub OAuth                      | Resolve a public upstream user ID for enrollment/login                 | Minimal OAuth identity; access token discarded after resolution                     |
| WebAuthn authenticator            | User-controlled authentication and step-up                             | Public-key ceremony; no attestation fingerprint database in MVP                     |
| Cloudflare                        | Public edge, caching, WAF/request shaping, Turnstile, Access for admin | Public requests and minimal security/operational signals under configured retention |
| Railway                           | Isolated Web/Auth, Ingest, Jobs, and PostgreSQL hosting                | Account, security, usage, and operational data according to service role            |
| Operating-system credential store | Protect and explicitly remove one connector device credential locally  | Device private key stays on the user's machine; local removal is not server revoke  |
| Local Codex App Server            | Provide version-pinned usage response to the connector                 | Invoked locally over stdio; prohibited fields never enter Vibe Racing payloads      |

No advertising or behavioral analytics provider is planned for MVP. Adding one changes the privacy
model and requires an ADR, consent/notice analysis, data-map update, and public review.

## User controls and deletion

- **Pause collection:** source/device submissions are rejected while retained state is not changed.
- **Reactivate collection:** only a paused source can resume after a fresh passkey assertion; this
  does not publish a hidden profile or lift quarantine.
- **Hide profile:** public reads and caches stop immediately without waiting for full deletion.
- **Revoke device:** the key loses submission authority immediately; previous season attribution
  remains under policy.
- **Forget local connector credential:** the exact canonical origin/label record is deleted without
  being loaded or sent anywhere. This does not revoke a registered server device; the user must
  review and revoke that device separately in the authenticated account.
- **Unlink source:** the local control requires a fresh passkey, terminally revokes every active
  source device without publishing a hidden profile, and stops future submissions; historical season
  attribution remains until deletion or documented correction.
- **Export:** any future export is authenticated, bounded, generated on demand, and contains only
  the requesting profile's data. No export endpoint is implied by this design document.
- **Delete:** the local request now requires the exact active session, typed handle, and fresh
  passkey. It immediately hides the profile; revokes session, passkey, device, and recovery
  authority; removes recovery codes; makes ingest reject the profile; unlinks sources; cancels
  approved pairing; and queues a random opaque 32-byte purge reference. Successful HTTP completion
  clears every browser auth cookie.

The local request slice itself does not execute background work. Revision 0024 and the separate
one-shot Jobs command now consume due queued/retry rows in maximum-10 transactions, terminally
settle the opaque job, and purge the exact profile's primary identity, credential, source, device,
usage, and personal score data. Revision 0032 makes only profile-free terminal jobs older than 30
days cleanup-eligible through a separate one-shot command. Revision 0033 separately makes database
audit references at least 180 days old cleanup-eligible. The local Web build schedules none of these
commands. An external append-only audit sink, public cache purge, disclosed keyed tombstone expiry,
backup handling, and stale-backup deletion replay remain launch-blocking work.

The isolated database gate now proves that its current synthetic snapshot can be restored twice
without data-digest, forced-RLS, or selected-grant drift before all 45 later lock-wait races and the
final runtime deny matrix run. It does not contain a pre-deletion snapshot or keyed deletion marker,
so it does not satisfy backup expiry or restore replay for this user-control flow.

Restore procedures replay deletion markers before restored data is made available. The UI reports
progress without exposing internal record IDs. Legal retention exceptions, if any, require launch
legal review and explicit public disclosure; they are not assumed here.

## Logs, diagnostics, and support

The server-only problem factory and local score route create a new 128-bit opaque request ID and
return it in the bounded body/header without accepting an inbound correlation value or retaining a
copy. The transport-free Ingest application independently creates the same contract shape and
returns it only in its validated body decision; its configuration reader, kernel, database adapter,
and composer have no request-ID or log sink. The local Ingest HTTP boundary returns that application
ID or a newly generated generic transport-problem ID in the bounded body/header, disables Fastify
logging, rejects inbound correlation values, and retains no copy. The full synthetic integration
asserts only the returned IDs, closed decisions, exact stored state, and transient aggregate blocked
query count; its separate built-entry-point child must emit no byte and keeps no diagnostic sink.
Future operational logs may use stable event names, those request IDs, coarse outcomes, and bounded
numeric metrics only after a retention review. They omit raw URLs, request bodies, raw token values,
handles when not needed, OAuth/passkey material, device public keys/signatures/nonces, origin
keys/proofs/nonces, idempotency keys, recovery selectors/secrets/PHCs/authority verifiers, local
paths, and prohibited data.

Connector telemetry is off by default. The implemented candidate diagnostic preview is local,
explicit, stdout-only, redacted, reviewed before sharing, and generated from a fixed allowlist; the
connector neither retains nor transmits it. Any automated export requires a separate review. Public
issue forms do not request raw logs, screenshots, contact details, or account identifiers. Security
and conduct reports use tested private channels before participation opens.

## Privacy review gates

Before real-user ingestion:

1. Map every schema column, log field, metric label, cache field, and support export to this
   inventory.
2. Replace each **launch decision required** with an implemented retention and purge rule.
3. Prove prohibited fields cannot cross the connector egress contract or enter logs.
4. Test public/private serialization, cache separation, role access, hide, revoke, unlink, deletion,
   restore replay, and backup expiry.
5. Verify provider settings and contracts against the public Privacy Policy and launch
   jurisdictions.
6. Complete appropriate legal review without presenting this engineering map as legal advice.
7. Re-run the [threat model](THREAT_MODEL.md) and [abuse cases](ABUSE_CASES.md) when collection,
   sharing, retention, or product incentives change.
