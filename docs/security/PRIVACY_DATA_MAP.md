# Privacy data map

## Status and principles

The current repository contains a private SQL schema, synthetic PostgreSQL integration test, local
Community sync verification kernel, mock-pool database adapter, and bounded local HTTP server
factory, plus library-only connector protocol/parser boundaries, a synthetic one-shot process
supervisor, an exact-body composer, isolated pairing/request signers, a pure Web pairing verifier,
dormant pairing applications, a visible public-score consumer with a synthetic fallback, and bounded
database/local Jobs pairing cleanup behind closed boundaries. A local invite/OAuth/initial-passkey
enrollment, returning-passkey login, private passkey inventory, and private active-device inventory
and revoke slice now add encrypted short-lived cookies, fixed Web/Auth database calls, an account
page, and logout with injected/synthetic evidence, but there is no live OAuth app,
authenticator-backed result, deployed application database, production service, operational
connector, or real user data. This document remains the required inventory for implementation. A
field may not be collected merely because it appears here: its schema, purpose, visibility,
retention, deletion, and access tests must exist first. The implemented column-level mapping is
documented in [`database/README.md`](../../database/README.md#data-and-privacy-map).

Vibe Racing applies these rules:

- collect the minimum data needed for an invite-only Community race;
- keep exact usage private and publish only derived, intentionally selected fields;
- never collect prompts, conversations, repository contents, Codex credentials, API keys, account
  email, or arbitrary files;
- separate public, account, security, usage, and operational capabilities;
- avoid advertising, behavioral analytics, tracking pixels, and remote web fonts in the MVP;
- make pause, hide, device revoke, source unlink, and deletion understandable and testable;
- use synthetic data in development, CI, documentation, screenshots, and support reproduction.

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

| Data                                                                        | Class                           | Source and purpose                                                       | Visibility and access                                                                       | Planned store                                                                                                                       | Retention and deletion                                                                                                           |
| --------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Resolved GitHub numeric user ID                                             | Account                         | GitHub OAuth; enforce one Vibe Racing profile per upstream ID            | Web/Auth and uniqueness procedure only                                                      | `profiles` identity binding                                                                                                         | Until profile deletion; short security tombstone only if justified and disclosed                                                 |
| GitHub access token and non-ID profile response fields                      | Prohibited after callback       | GitHub OAuth; resolve the numeric ID once with no extra scope            | Callback memory only                                                                        | Never persisted                                                                                                                     | Discard immediately after identity resolution                                                                                    |
| OAuth state, PKCE verifier, callback code, and invite continuation          | Security                        | Web/Auth; bind one authorization response to one enrollment              | Verifier/continuation in HttpOnly cookie; state crosses browser/GitHub; code returns to Web | State, verifier, preferences, invite ID/digest, and ten-minute expiry in a purpose-keyed AES-GCM cookie                             | Cookie expires or is cleared at callback; code is exchanged once; app/dev logs suppress it; hosted access logs must redact query |
| GitHub OAuth client ID and client secret                                    | Security                        | Deployment; identify the dedicated enrollment OAuth app                  | Web/Auth callback only; client ID appears in the GitHub redirect                            | Protected environment/secret manager; tracked values are non-working placeholders                                                   | Rotate secret on exposure/ownership change; remove both when GitHub enrollment is disabled                                       |
| Public handle                                                               | Public                          | User; identify the race profile                                          | Public after explicit labeled choice and activation; also supplied to the authenticator     | `profiles` and discoverable-credential display metadata                                                                             | Server copy until changed, hidden, or deleted; authenticator copy remains user-controlled                                        |
| Community trust tier and self-reported flag                                 | Public                          | Server constants; prevent Community results from implying verification   | Public score response and localized UI                                                      | Not stored; literal response metadata                                                                                               | Generated per response; no retention                                                                                             |
| Public score `seasonStart` query label                                      | Public                          | Visitor; select one public Community season                              | Local Web score route                                                                       | Not stored; passed only to the bounded score adapter                                                                                | Per request only; do not retain or log the raw URL                                                                               |
| Optional GitHub profile link                                                | Public                          | User opt-in; distinguish an upstream public identity                     | Public only after explicit opt-in                                                           | `profiles` preference                                                                                                               | Until opt-out or deletion; purge public cache                                                                                    |
| Profile visibility, locale, theme, motion, privacy preferences              | Account                         | User; product experience and visibility controls                         | User profile; only public effects are visible                                               | `profiles`; Web maps lifecycle state only to closed `public`/`hidden`                                                               | Until reset or deletion                                                                                                          |
| Invite secret, verifier digest, and state                                   | Security                        | Operator-issued 256-bit secret; gate beta enrollment                     | Plaintext only in the initial bounded form; digest to Web/Auth and limited admin procedure  | SHA-256 verifier digest, status, expiry, and non-sensitive audit                                                                    | Plaintext discarded during parsing; digest follows expiry/redemption plus a bounded audit window                                 |
| Session verifier, encrypted cookie, and metadata                            | Security                        | Web/Auth; maintain one browser session                                   | HttpOnly same-site browser cookie and Web/Auth only                                         | Purpose-keyed AES-GCM cookie; database stores SHA-256 verifier digest, expiry, state, and passkey provenance                        | Pending enrollment is at most 15 minutes; passkey success rotates to at most 30 days; clear/revoke on logout or deletion         |
| Enrollment cookie master key                                                | Security                        | Deployment; seal login, OAuth, passkey, and session continuations        | Web/Auth process memory only; four purpose keys are derived with HKDF                       | Protected environment/secret manager; exactly 32 canonical base64url bytes; never tracked or logged                                 | Rotate on exposure; rotation invalidates outstanding continuations and sessions                                                  |
| Web PostgreSQL deployment login and password                                | Security                        | Deployment; authorize only the Web score, identity, and pairing adapters | Adapters and PostgreSQL driver process memory only                                          | Protected environment/secret manager; never tracked or logged                                                                       | Rotate on exposure/role change and remove when the adapters are disabled                                                         |
| Ingest PostgreSQL deployment login and password                             | Security                        | Deployment; authorize only device lookup and sync submission             | Ingest adapter and PostgreSQL driver process memory only                                    | Protected environment/secret manager; never tracked or logged                                                                       | Rotate on exposure/role change and remove when ingestion is disabled                                                             |
| WebAuthn public key, credential ID, pseudonymous user handle, and key label | Security; label is Account      | Server profile ID plus user authenticator; login and fresh step-up       | Web/Auth and the user's authenticator; user can list only bounded friendly metadata         | `passkeys`; profile UUID is the discoverable credential user ID; no attestation fingerprint store                                   | Server copy follows passkey/profile lifecycle; authenticator credential remains under user/platform control                      |
| Opaque passkey ID                                                           | Security                        | Server-generated key; select one owned credential for revocation         | Authenticated account revoke control and options request only                               | `passkeys` primary key                                                                                                              | Retained with the passkey row; never public or accepted as proof                                                                 |
| WebAuthn challenge, context, and verifying-passkey reference                | Security                        | Server; bind one ceremony to one action and exact credential             | Web/Auth only; encrypted login challenge cookie contains no profile or reusable authority   | Registration uses a database challenge; login stays cookie-only before proof, then creates and consumes one database row atomically | Registration and login are one-time and at most five minutes; bounded consumed-row cleanup required before launch                |
| Recovery-code selector and verifier                                         | Security                        | Web/Auth-generated; recover profile access                               | Web/Auth only; plaintext secret shown once to the user                                      | Opaque selector and Argon2id PHC; protected pepper stays outside DB                                                                 | PHC scrubbed on use; batch removed on regeneration, completion, or deletion; cleanup before launch                               |
| Restricted recovery authority and registration binding                      | Security                        | Server; permit only exact replacement-passkey registration               | Web/Auth recovery procedure only                                                            | Keyed verifier plus challenge/context digests and terminal lifecycle                                                                | One-time, at most 10 minutes; terminal-row retention and cleanup are a launch decision required                                  |
| Source ID, state, and source count                                          | Account; count is Public        | User-declared opaque CodexSource; isolate and explain aggregation        | User sees sources; public sees only contributing count for a season                         | `codex_sources`, season snapshot                                                                                                    | Source lifecycle plus historical public count until profile deletion                                                             |
| Encrypted source-control token                                              | Security                        | Server; select one owned source without exposing its raw ID in HTML      | Authenticated account page and source-control requests only                                 | Transient AES-GCM ciphertext in HTML/form or JSON; no new database field                                                            | Bound to the exact active session and expires within 15 minutes; never logged or accepted as proof alone                         |
| Device public key, private signing key, and public device ID                | Security                        | Connector; authenticate one source-bound device                          | Public key to Ingest/inventory; private key only to local signer                            | Public key/ID in `device_keys`; private key in reviewed OS store only, not implemented                                              | Pending key is Jobs-cleanup eligible at pairing expiry; active key follows revoke/unlink/delete                                  |
| Device label                                                                | Account                         | User or safe generated default; distinguish devices                      | User profile only after activation; pairing service while pending                           | `device_keys` metadata                                                                                                              | Pending label is Jobs-cleanup eligible at pairing expiry; active label follows device lifecycle                                  |
| Connector, Codex, and OS-family versions                                    | Security; Operational           | Connector; compatibility and incident diagnosis                          | Pairing service while pending; user inventory after activation                              | Device/sync metadata                                                                                                                | Pending metadata is Jobs-cleanup eligible at pairing expiry; active history needs launch policy                                  |
| Pairing poll token, HMAC keys/verifiers, challenge, user code, transaction  | Security                        | Server/connector; poll safely and bind browser approval to one key       | Pairing service/application, connector memory, and browser confirmation                     | Plain token/code returned once; separate keyed verifiers in DB; poll/code HMAC keys in protected configuration                      | Plaintext is never logged/persisted; expired non-activated rows have bounded cleanup but need scheduling                         |
| Pairing possession message and signature                                    | Security                        | Connector/Web verifier; prove one pending device holds its private key   | Connector signer, pure Web verifier, and closed activation application                      | Transient process memory only; never persisted                                                                                      | Web copies overwritten after settlement; Rust proof lives until owner drop; never logged or retained                             |
| `codexReportedDate` and exact daily token value                             | Usage                           | Local stable App Server adapter; compute Community score                 | Isolated Ingest and Jobs scoring/cleanup procedures; never public raw                       | `usage_snapshot_entries`, `source_day_values`                                                                                       | Raw snapshot is Jobs-cleanup eligible after 30 days; current/history policy remains a launch decision                            |
| Connector `observedAt`, server `receivedAt`, device nonce, idempotency key  | Security; Usage                 | Connector/server; replay, ordering, deadline, and retry safety           | Isolated Ingest and Jobs cleanup procedures; shared finalization policy                     | `usage_snapshots`, `device_nonces`                                                                                                  | Nonce after 15 minutes and raw snapshot after 30 days; scheduler and production purge proof remain required                      |
| Edge origin HMAC key and key ID                                             | Security                        | Operator/edge/service; authenticate the only intended ingress            | Edge signer and Ingest verifier process memory only                                         | Protected environment/secret manager; local reader implemented; never tracked, logged, or stored in DB                              | Rotate on exposure or policy change; remove retired key after bounded request window                                             |
| Origin proof timestamp, nonce, proof, nonce digest, and replay expiry       | Security                        | Edge/service; bind and replay-protect one exact request                  | Ingest verification and procedure-only replay capability                                    | Proof/raw nonce transient; `origin_nonces` retains key ID, domain-separated digest, and exact expiry                                | Proof/raw nonce discarded per request; tuple unusable at expiry; bounded cleanup exists but needs scheduling                     |
| Daily and weekly score, active days, shared rank                            | Public                          | Server-derived from accepted source/day state                            | Private Jobs materialization; Web exposes weekly/active/rank only                           | `season_daily_scores`, `season_entries`, `seasons`, `score_versions`                                                                | Finalized rows are immutable except profile purge; daily delivery still needs reviewed policy                                    |
| Rounded freshness and contributing source count                             | Public                          | Server-derived privacy-preserving status                                 | Web score projection exposes source count; freshness/cache remain planned                   | `season_entries`; future freshness projection or cache                                                                              | Read filters current active state; profile-row purge cascades; freshness/cache policy is pending                                 |
| Streak                                                                      | Public when enabled             | Server-derived informational field                                       | Public only under profile visibility setting                                                | Season/profile projection                                                                                                           | Recomputed or deleted with profile; never increases score                                                                        |
| CarRecipe and proposal state                                                | Public recipe; Account proposal | User/agent enum proposal and explicit browser approval                   | Proposal private until approval; active car public                                          | Versioned recipe/proposal tables                                                                                                    | Rejected proposals short-lived; approved recipe until change/delete; launch decision required                                    |
| IP-derived request signal and user-agent family                             | Operational                     | Edge/service; security, rate shaping, and reliability                    | Restricted operations; never leaderboard or behavioral advertising                          | Prefer aggregate/ephemeral edge controls; minimal event when necessary                                                              | Shortest operational window; exact scope and duration require launch privacy review                                              |
| Request ID, outcome, latency, and bounded error code                        | Operational                     | Server-generated correlation; debugging and SLO evidence                 | Response recipient and restricted operations; aggregate metrics                             | Not retained today; future structured logs/metrics                                                                                  | Future bounded logs exclude usage, credentials, bodies, and profiles                                                             |
| Security/admin audit event and reason                                       | Security; Operational           | Auth/admin/jobs/release; accountability                                  | Restricted responders/auditors; user-visible subset where appropriate                       | Bounded `audit_events` reference; external append-only sink planned                                                                 | Publicly documented bounded policy; profile link redacted on purge; delete unrelated personal data                               |
| Deletion state and security tombstone                                       | Security                        | Deletion workflow; prevent ingestion and restore resurrection            | Deletion/jobs/auth and limited audit                                                        | Local request queues an opaque deletion job; minimal tombstone remains planned                                                      | Immediate lock-down is implemented; primary purge and disclosed tombstone expiry remain launch-blocking work                     |
| Maintenance capability mutex                                                | Operational                     | Database; serialize bounded cleanup and scoring capabilities             | Owner-defined Jobs procedures only                                                          | Three fixed `maintenance_locks` enum rows; no user or request data                                                                  | Retained while each capability exists; removed only by a reviewed migration                                                      |

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
likewise adds no retained field and preserves pause/reactivation while hidden. The token expires
within 15 minutes, is bound to the exact session, and is not proof without that session; the
reactivation challenge is a separate five-minute HttpOnly continuation. The Web slice does not log,
cache, or persist the projection. The decoded master key is overwritten immediately after those
purpose keys are derived. Add/revoke step-up is also one-time and at most five minutes; its
consumed-row cleanup remains a launch requirement. The HTTP runtime exposes only the public origin
and secure-cookie flag. The fixed GitHub user response parser accepts only a positive safe numeric
`id` for return; the token and every other response field are discarded after the callback. Tests
use reserved, synthetic values and injected GitHub/database/authenticator capabilities. No real-user
retention or deployed subprocessor claim follows from this local boundary.

Opaque sources deliberately contain no Codex account email or upstream account identifier. The
implemented pairing database caps each profile at 32 lifetime source records and 64 active plus
unexpired approved device authorities. These public safety ceilings do not replace lower
deployment-private rate and fair-use controls, and exact per-source details remain non-public
Account data. Revisions 0004, 0016, and 0017 add no new personal-data column: the private inventory
procedure returns only the requesting session profile's opaque source state and bounded device
metadata, including while that profile is hidden. Lifecycle procedures retain the existing
source/device rows, append only closed audit references, and never accept or expose account email,
upstream account identity, exact usage, public keys, or internal key IDs.

Revision 0006 adds no email, support identity, recovery plaintext, IP address, or arbitrary
metadata. Its lookup returns only one supplied opaque selector and the matching unused PHC, never a
profile ID. Successful start immediately scrubs that PHC. Recovery completion deletes the remaining
batch; regeneration and profile deletion revoke active recovery authority. The terminal authority
row stores only opaque IDs, keyed/challenge/context digests, state, and timestamps. A bounded public
retention and cleanup rule is required before a real endpoint is enabled.

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
evidence; the separate PostgreSQL suite proves access and bounded deletion without claiming a live
connection or production schedule.

ADR 0017 implements only the process-side reader for the already mapped origin key/key-ID class. It
requires one primary and at most one complete secondary pair, passes decoded copies directly into
the verifier constructor, returns no configuration object, and overwrites its temporary decoded
buffers. The environment strings and verifier-owned copies remain protected runtime memory; no
JavaScript memory-erasure guarantee is claimed. Synthetic tests add no real key, user field, store,
log, metric, cache, export, edge signer, or retention sink.

ADRs 0016 and 0018 add no user field. The adapter reconstructs the origin key ID, digest, and
expiry, then reconstructs the verifier allowlist, copies the existing digests, signature, canonical
payload, and identifiers, creates one opaque snapshot UUID, reads the existing minimal device tuple,
and sends only those values to fixed procedures. Mock pools retain nothing. The Ingest deployment
login and password are a separate Security configuration class: protected environment and driver
memory only, never a tracked value, log field, metric, response, or error cause. The config makes
the password non-enumerable and JSON-redacted, and monitoring receives only `idle_client_error`.
Real secret delivery, rotation, access review, and live TLS/login evidence remain deployment work.
Existing 15-minute device-nonce and 30-day raw-snapshot retention are unchanged.

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
destination. Loopback and injection tests use synthetic values only. A future listener entry point,
access log, metric, trace, proxy signal, or monitoring backend requires a separate mapped purpose,
access policy, and retention decision before collection.

ADR 0021 adds no collected or retained field. The connector library transiently validates the stable
initialization response's Codex home, platform family, operating-system name, and user agent under
fixed string/frame bounds, then discards all four values before returning. ADR 0022 then validates
the candidate `0.144.4` account variant and immediately discards email, plan, and nullable summary
values. Only the already mapped private `codexReportedDate`/token entries leave the parser in
caller-owned memory: at most 31, sorted, unique, calendar-valid, and integer-bounded. Its diagnostic
representation contains entry count only. The local Codex home and account email remain prohibited
outside their validators. No value reaches a log, metric, file, database, HTTP payload, cache,
analytics event, export, key, or network sink.

ADR 0023 adds no collected or retained field. The one-shot supervisor receives only a future
capability-owned executable path, isolated working directory, and allowlisted environment values;
none has a public accessor or diagnostic representation. It reads no ambient environment, launches
only one fixed argument over local pipes, retains at most three 16 KiB stdout frames in bounded
memory, and permits only 8 KiB discard-only stderr before failing on the next byte without retaining
or returning its content. Child status, operating-system errors, paths, environment values, and raw
output never enter returned errors. The only success result is the already mapped minimized
`DailyUsage`, returned after terminal-event checking and child reap. Synthetic tests use a
target-built fixture and temporary directory only. Because `ReviewedCodexLaunch` has no public
constructor, the library cannot discover or execute a local Codex installation, access a credential
store, or upload. A future executable-admission diagnostic or retained connector/Codex version must
use the existing mapped Security/Operational class with an explicit purpose and bounded retention.

ADR 0024 adds no new data class or persistent field. It consumes the already mapped private daily
usage plus reviewed opaque source, sync, device, millisecond UTC, and nonce values in transient
memory. The exact JSON body and LF-separated signing message contain private usage and security
material and deliberately implement no diagnostic, clone, display, or serialization surface. The
composer emits no log, metric, file, database value, cache, analytics event, export, or network
request. Its shared test vector uses only synthetic identifiers and values.

ADR 0025 adds no persistent field or sink. It removes every public accessor from the unsigned
prepared value and consumes it only with an inaccessible capability containing the already mapped
private device signing key plus its public device ID. The returned closed envelope exposes only the
same exact body and five bounded header values to a future transport. Prepared body/message buffers,
the signed body buffer, and the upstream signing key are zeroed on drop; this is defense in depth,
not a guarantee that compiler, caller, or operating-system copies are erased. The key capability has
no constructor, accessor, clone, diagnostic, serialization, file, store, or network surface. The
extended public vector contains only synthetic usage/identifiers, a public key, and a signature; its
private test seed is deterministically derived at runtime from an obvious fixed label. No current
code can obtain a real context or key. OS-store custody, fresh entropy, clock handling, pairing,
retries, and egress require separate mapping and review.

ADR 0026 adds no data class, persistent field, or sink. The Rust kernel transiently receives the
already mapped pending private key plus pairing ID/challenge, derives the already mapped public key,
and returns only the existing ID/signature class. The Web kernel transiently copies the approved
pairing ID/challenge/public key and submitted signature, reconstructs the exact possession message,
returns one boolean, and overwrites its copies after settlement. Neither kernel has a poll token,
user code, profile/source identifier, cookie, log, metric, cache, analytics event, database call,
export, or network destination. The public vector is entirely synthetic and contains no private key
or bearer value. Runtime buffer overwriting is defense in depth, not an erasure guarantee. A future
route, diagnostic, or retention sink requires a separate privacy review.

ADR 0027 consumes only those existing classes. The dormant Web application transiently decodes one
32-byte poll token, derives two 32-byte HMAC candidates under a retained primary and optional
secondary protected key, obtains the already mapped approved pairing ID/challenge/public key, and
passes the existing signature through the pure verifier. The SQL procedure retains only the already
mapped activated device ID and bounded audit reference. Candidate/token/material copies are
overwritten after settlement and configured key buffers on close; runtime and driver copies are not
an erasure guarantee. The local admission/timing gate retains only an integer active count and no
token, digest, address, user agent, profile, or result history. No log, metric, cache, cookie,
analytics event, export, network destination, or new database field is added. Future browser
approval, HTTP/client identity, diagnostics, and distributed rate state require separate mapping and
review.

ADR 0028 consumes the same mapped pairing and metadata classes for a dormant transport-free start.
It accepts only one canonical public key, bounded non-personal device label, syntactic connector
version, OS family, and architecture; creates fresh pairing/pending-key/request IDs, poll token,
challenge, 60-bit human code, and nine-minute expiry; and persists only the existing bounded
metadata plus separate primary poll/code HMAC verifiers. The primary and optional secondary code
keys are protected configuration distinct from every poll key. Malformed admitted requests retain no
input or result history and perform no database write. Candidate, material, parameter, and
configured key copies are overwritten where ownership permits, but strings, runtime copies, and
driver internals are not an erasure guarantee. This adds no field, log, metric, cache, cookie,
analytics event, export, or network destination. Browser approval, route/client identity, external
diagnostics, distributed rate state, and cleanup scheduling remain separately reviewable. Revision
0013 and ADR 0029 now supply the bounded local physical pairing-row/key deletion capability.

Revision 0008 adds deletion evidence for only those raw nonce and snapshot rows: a Jobs-only
procedure derives cutoff time on the server, deletes bounded expired batches, cascades raw entries,
and preserves the current source/day value while clearing its deleted snapshot reference. A fixed
owner-only mutex row and five-second lock timeout prevent runtime roles from seizing a public lock
key or waiting without a database bound. The synthetic PostgreSQL suite proves idempotency, live-row
preservation, role denial, and two-worker serialization. No scheduler, service, production retention
monitor, backup policy, or real-user purge evidence exists, so real-user ingestion remains blocked.
The later local one-shot runner can invoke one fixed ingest batch, but does not make cleanup
scheduled or prove a production retention policy.

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
Jobs runner can invoke one fixed maximum pairing batch and discards the two counts. No scheduler,
monitor, backup policy, public retention cadence, or real-user purge evidence exists.

Revision 0009 reads exact current values only inside an owner-defined Jobs procedure and writes a
strictly smaller private derived set: daily and weekly score, active days, contributing-source
count, shared rank, deterministic display order, ISO-week dates, and immutable Community formula
metadata. It does not copy raw token totals, source IDs, exact sync time, device data, or identity
provider bindings into scoring tables. Hidden/deleting profiles and quarantined sources are
excluded; eventual profile-row purge cascades its open entries and daily scores. A week without
source/day state creates no open season row.

Revision 0010 adds only derived deadline and lifecycle metadata to `seasons`: public ISO dates,
`open`/`finalized` state, grace, refresh, and finalization timestamps. Server `receivedAt`, not
client `observedAt`, closes the window. A whole late snapshot remains private 30-day raw evidence
with `season_closed` and creates no accepted source/day value. Finalized metadata and score rows are
immutable except that profile purge removes the profile-linked weekly/daily rows while retaining the
non-personal terminal season definition. A no-data closed week stores only that definition. No
public serializer/cache, audited correction record, finalized public-history retention rule, Jobs
deployment/scheduler, or monitoring backend exists.

ADRs 0014 and 0029 store no user data. The local Jobs process transiently receives only one of two
fixed cleanup batches or one Public season-start label, plus the private aggregate counts already
returned by the procedures. It validates and discards those values within one process invocation.
The CLI emits only one constant completion/failure sentence; it does not log the command, date,
counts, identifiers, SQL, environment, exception, or stack. The optional pool hook receives only the
closed Operational signal `idle_client_error` and has no built-in storage or network sink. A future
scheduler, run history, metric, alert, retry record, or monitoring backend must map its exact
fields, access, retention, and deletion behavior here before collection.

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
metadata.

ADR 0013 adds no store or retained field. `CommunityScoreQueryV1` carries only the public Monday
season label already accepted by the adapter, while the manifest-generated operation fixes
same-origin and `no-store` behavior. The local parser rejects duplicate/unknown query parameters,
encoded field names, bodies, and unsupported media ranges before store work. The route creates one
opaque request ID but no URL/header log, cache entry, analytics event, new network destination, or
retained record; it must not record the raw URL merely to diagnose an invalid date.

The visible home consumer adds no collected or retained field. The server derives only the current
Public Monday label; the browser sends it once to the existing same-origin route without cookies or
credentials, validates the closed Public response in memory, and does not cache or persist it. Fixed
project-owned CarRecipe values are presentation placeholders rather than participant data; streak
and freshness remain absent. A failed or invalid response leaves the explicitly synthetic fallback
visible and creates no retry, log, metric, analytics, export, or third-party request.

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
  only injected origin-nonce and minimal device-lookup capabilities. The separate adapter owns only
  fixed origin-consume/lookup/submission calls and a protected database config contract; mock
  evidence opens no connection. Neither boundary has HTTP, logging, analytics, export, or deployment
  authority.
- The connector library validates and discards the App Server initialization values and candidate
  `0.144.4` account/summary fields, then exposes only bounded private daily usage to its caller. It
  composes that sequence only behind a reviewed-launch capability with no public constructor and
  bounded synthetic process evidence. It can compose exact sync bytes only behind a second
  inaccessible reviewed context and sign them only behind a third inaccessible one-use device-key
  capability. It has no executable discovery/admission, real Codex path, context provider, real key
  generation/store, pairing, log, persistence, or egress capability; the candidate remains
  unsupported until official-artifact, platform, privacy-egress, packaging, and release gates pass.
- Jobs currently receive only bounded expired ingest- and pairing-state cleanup, open-season
  Community scoring refresh, and terminal finalization. The local one-shot adapter rechecks the
  exact Jobs-only login and invokes one prepared capability without logging inputs or results.
  Correction and deletion-purge capabilities require separate migrations and tests; migrations use a
  different non-runtime owner.
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
| Operating-system credential store | Protect connector device private key locally                           | Device private key stays on the user's machine                                      |
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
- **Unlink source:** future submissions stop; historical season attribution remains until deletion
  or documented correction.
- **Export:** any future export is authenticated, bounded, generated on demand, and contains only
  the requesting profile's data. No export endpoint is implied by this design document.
- **Delete:** the local request now requires the exact active session, typed handle, and fresh
  passkey. It immediately hides the profile; revokes session, passkey, device, and recovery
  authority; removes recovery codes; makes ingest reject the profile; unlinks sources; cancels
  approved pairing; and queues a random opaque 32-byte purge reference. Successful HTTP completion
  clears every browser auth cookie.

The queued primary purge, cache purge, disclosed tombstone expiry, and backup handling are not
implemented by the local request slice. They remain launch-blocking work and the UI states that the
local build does not run the purge worker.

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
logging, rejects inbound correlation values, and retains no copy. Future operational logs may use
stable event names, those request IDs, coarse outcomes, and bounded numeric metrics only after a
retention review. They omit raw URLs, request bodies, raw token values, handles when not needed,
OAuth/passkey material, device public keys/signatures/nonces, origin keys/proofs/nonces, idempotency
keys, recovery selectors/secrets/PHCs/authority verifiers, local paths, and prohibited data.

Connector telemetry is off by default. A future diagnostic export is local, explicit, redacted,
previewed before sharing, and generated from an allowlist. Public issue forms do not request raw
logs, screenshots, contact details, or account identifiers. Security and conduct reports use tested
private channels before participation opens.

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
