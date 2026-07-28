# Privacy data map

This map is the normative collection, visibility, retention, and deletion contract for the
clean-slate AgentAccount design in
[ADR 0076](../decisions/0076-clean-agent-account-provider-reported-token-ranking.md). It permits no
anonymous profile and no Codex-specific score source. Implementation evidence remains separate in
[IMPLEMENTATION_STATUS.md](../IMPLEMENTATION_STATUS.md).

## Principles

- Collect the smallest value needed for identity, security, exact accounting, or the deliberately
  public leaderboard.
- Keep mixed-content local-agent storage local. Extract a closed privacy projection before any
  network or diagnostic boundary.
- Treat a hash of email, login, path, repository, prompt, or another identifying string as personal
  data, not anonymization.
- Keep provider, accounting revision, trust tier, and scope server-owned.
- Publish only complete snapshot fields for profiles that are currently public.
- Keep private Web/Auth, dashboard, pairing, and security responses `no-store`.
- Use synthetic fixtures only. No real user, provider credential, private log, or local machine path
  belongs in the repository.
- A local or synthetic deletion/restore test is not evidence of CDN purge, external backup expiry,
  provider revocation, legal retention, notification, or production recovery.

## Classification

| Class       | Meaning                                                                                 | Default handling                                                                                |
| ----------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Public      | Deliberately visible leaderboard/profile data                                           | Snapshot-only, bounded, cacheable only under reviewed shared-cache policy                       |
| Account     | Private profile, AgentAccount, installation, device, preference, and dashboard metadata | Authenticated same-profile access, least privilege, `no-store`, deleted with the owning profile |
| Security    | Credentials, verifiers, keys, challenges, replay state, restricted authority            | Secret or purpose-bound access, non-reflective handling, exact expiry/revoke, never public      |
| Usage       | Private account/day totals, observations, accounting attribution, sync state            | AgentAccount-scoped write, Jobs derivation, no public breakdown, bounded retention              |
| Operational | Request outcomes, bounded audit events, health and aggregate metrics                    | Minimized, access-controlled, retention fixed before launch, no body/credential/private usage   |
| Prohibited  | Prompt, conversation, code, repository content/name, path, email, key/token, raw record | Do not collect, transmit, persist, log, cache, export, fixture, or include in diagnostics       |

## Planned field inventory

### Identity, authentication, and profile

| Data                                                     | Class    | Source and purpose                                              | Visibility and access                                                     | Store                                                            | Retention and deletion                                                                                                   |
| -------------------------------------------------------- | -------- | --------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Immutable GitHub numeric user ID                         | Account  | GitHub OAuth; enforce at most one profile per upstream identity | Web/Auth and unique profile procedure                                     | `profiles.github_user_id`, unique and immutable                  | Until profile purge; no independent public display                                                                       |
| GitHub access token, callback code, mutable profile data | Security | Resolve numeric ID once with minimal scope                      | OAuth callback memory only                                                | Never persisted                                                  | Discard immediately after identity resolution; query and logs redact callback material                                   |
| OAuth state and PKCE verifier                            | Security | Bind one authorization response to one browser continuation     | Purpose-separated HttpOnly cookie and callback                            | Encrypted short-lived continuation                               | One use or at most ten minutes; cleared on settlement                                                                    |
| GitHub OAuth client secret                               | Security | Authenticate the dedicated OAuth application                    | Protected Web/Auth process only                                           | External secret manager                                          | Rotate on exposure/ownership change; never tracked or logged                                                             |
| Profile ID                                               | Account  | Internal ownership and foreign-key root                         | Exact authenticated procedures                                            | Opaque server-generated identifier                               | Until profile purge; never public or accepted from a public path without an ownership check                              |
| Public handle                                            | Public   | User-selected public identity                                   | Public snapshot after explicit visibility                                 | `profiles.handle` and snapshot summary                           | Until change, hide, or purge; old snapshot/cache purge requires operational evidence                                     |
| Locale, visibility, and privacy preferences              | Account  | EN/RU UX and public-state decision                              | Same-profile dashboard; only public effect is visible                     | `profiles`                                                       | Until reset or purge                                                                                                     |
| CarRecipe                                                | Public   | Cosmetic public car                                             | Active recipe in public snapshot; proposal private                        | Closed enum recipe and at most one bounded proposal              | Proposal expires/rejects/replaces; active recipe until change or purge; never affects rank                               |
| Passkey public key, credential ID, counters, label       | Security | Login and fresh step-up                                         | Authenticator and same-profile security inventory                         | `passkeys`; no attestation fingerprint                           | Active while authoritative; revoked provenance only for bounded security/audit retention, then cleanup when unreferenced |
| WebAuthn challenge and action context                    | Security | Bind one exact ceremony and action                              | Web/Auth only                                                             | Short-lived one-time challenge                                   | At most five minutes; consume or expire; cleanup by fixed Jobs capability                                                |
| Session verifier, cookie, metadata, passkey provenance   | Security | Maintain one browser session                                    | HttpOnly same-site cookie and Web/Auth                                    | Encrypted cookie plus keyed verifier digest and bounded metadata | Pending at most 15 minutes; normal at most 30 days; revoke/expire/delete, then cleanup when unreferenced                 |
| Recovery selector, Argon2id verifier, pepper             | Security | One-time restricted replacement-passkey recovery                | Plain code shown once; verifier in Auth DB; pepper only protected runtime | Selector plus PHC; pepper outside database                       | PHC scrubbed on use; unused batch removed on rotation/completion/purge; authority at most ten minutes                    |
| CSRF and encrypted control tokens                        | Security | Bind same-origin profile/account/device actions                 | Browser and exact Web route only                                          | Purpose-separated authenticated ciphertext                       | One action, at most 15 minutes, no logging                                                                               |

There is no anonymous identity bootstrap key, anonymous owner lease, anonymous promotion state, or
anonymous profile row.

### Provider registry and AgentAccounts

| Data                                                     | Class                 | Source and purpose                                                               | Visibility and access                                       | Store                                                             | Retention and deletion                                                                        |
| -------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Closed provider ID and support state                     | Operational           | Repository registry; select implemented reader and UI state                      | Public provider capabilities; no user binding               | Versioned registry                                                | Retained with the supported software version; changes require review                          |
| Accounting revision ID and exact rules                   | Operational           | Repository registry; pin accounting, UTC, dedup, and scope semantics             | Connector, pairing, Ingest, Database, docs                  | Versioned immutable registry                                      | Retained for every season/account that references it; never reinterpreted in place            |
| AgentAccount ID                                          | Account               | Server-created competitive principal                                             | Same-profile dashboard, account-scoped device and Ingest    | Opaque high-entropy identifier                                    | Until profile purge; terminal disconnect may retain only bounded audit reference              |
| AgentAccount provider, accounting revision, trust, scope | Account / Usage       | Server-owned registry selection                                                  | Same-profile, Ingest, Jobs; public snapshots omit breakdown | Immutable columns                                                 | Until profile purge; finalized snapshots retain only public aggregate/tier fields             |
| Private account label                                    | Account               | User distinguishes several accounts of one provider                              | Same-profile dashboard only                                 | Bounded normalized text                                           | Until change, account purge, or profile purge                                                 |
| AgentAccount state and health                            | Account / Operational | Pause, quarantine, disconnect, last success/error category                       | Same-profile dashboard and bounded operations               | Closed enums and rounded timestamps/error codes                   | Current lifecycle plus bounded operational retention; exact policy fixed before launch        |
| Stable opaque provider account-domain fingerprint        | Account / Security    | Prevent accidental duplicate attachment when a provider exposes a safe opaque ID | Pairing and database uniqueness only                        | Domain-separated keyed digest or provider-issued opaque ID digest | Until account purge; never derived from email/login/display/path; no public or support export |
| Explicit overlap/scope conflict decision                 | Account / Usage       | Prevent provider-wide and included account-specific totals both contributing     | Pairing review, Ingest, Jobs                                | Closed scope and conflict state                                   | Until conflicting account/scope is removed; audit reason retained only under bounded policy   |

If no safe stable opaque account-domain identifier exists, the browser requires explicit
create-or-attach choice. Raw account identity is not sent, hashed, or stored.

### Connector installations, devices, and pairing

| Data                                                                       | Class                 | Source and purpose                                                                      | Visibility and access                              | Store                                                                      | Retention and deletion                                                                                            |
| -------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Installation ID and Ed25519 public key                                     | Account / Security    | Bind one local connector installation and its discovery manifest                        | Pairing, same-profile installation inventory       | `connector_installations`                                                  | Active until disconnect/revoke/profile purge; revoked provenance bounded and removed when unreferenced            |
| Installation private key                                                   | Security              | Sign pairing possession and installation requests                                       | Local connector signer only                        | Native OS credential store; no plaintext fallback/export                   | Delete after authenticated disconnect read-back or explicit `forget-local`; retained copy has no server authority |
| Connector version, platform/OS family, installation label                  | Account / Operational | Compatibility, security inventory, user distinction                                     | Same-profile dashboard, pairing while pending      | Bounded metadata                                                           | Through active/revoked authority under bounded policy; not public                                                 |
| Device ID and account-scoped Ed25519 public key                            | Account / Security    | Authenticate one installation for one AgentAccount                                      | Pairing, Ingest, same-profile device inventory     | `device_keys`, exact AgentAccount binding                                  | Pending until expiry; active until revoke/disconnect; revoked row bounded and removed after references clear      |
| Account-scoped device private key                                          | Security              | Sign `UsageSyncV1` for exactly one AgentAccount                                         | Local connector signer only                        | Native OS credential store, separate record per account/device             | Same as device authority; no copy/share/export workflow                                                           |
| Connector discovery candidate ID and opaque metadata                       | Account               | Let user create, attach, or skip one locally discovered candidate                       | Local preview and exact signed pairing transaction | Short-lived pending transaction only                                       | Consume on approval or expire; skipped metadata and pending keys removed                                          |
| ConnectorDiscoveryManifestV1                                               | Account / Security    | Bind ordered candidates, provider/revision claims, pending keys, and installation proof | Pairing start/application only                     | Bounded short-lived transaction digest and closed fields                   | At most nine minutes; consume or expire; no prompt/path/email/raw record                                          |
| Pairing poll token, HMAC keys/verifiers, challenge, user code, transaction | Security              | Poll safely and provide browser deep-link plus manual fallback                          | Connector, pairing service, browser fallback form  | Raw token/code only in client/browser; keyed verifiers and challenge in DB | Pending at most nine minutes; consume/expire; approved provenance retained only for bounded security window       |
| Batch approval continuation and ordered decision digest                    | Security              | Bind create/attach/skip decisions to one session and fresh passkey                      | HttpOnly browser cookie and Web/Auth               | Authenticated encrypted continuation plus database transaction digest      | One use, at most five minutes; clear on settlement                                                                |
| Pairing attempt counters and network-origin bucket                         | Operational           | Bound start, poll, code, and approval abuse                                             | Edge/Web/Pairing only                              | Saturating short-lived aggregate counters, no raw IP history               | Discard at fixed window; launch decision required for exact hosted thresholds and maximum retention               |

The fallback code is not a bearer profile credential. It selects only the pending transaction; batch
activation still requires the exact signed-in profile and one fresh passkey assertion.

### Reader-local data

| Data                                                    | Class       | Source and purpose                                                            | Visibility and access                               | Store                                                        | Retention and deletion                                                                                      |
| ------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Agent usage files, logs, JSONL, SQLite, or API response | Prohibited  | Mixed-content local source from which a bounded reader derives allowed values | Exact local reader process only                     | Never copied into product storage                            | Close immediately; no product retention, cache, fixture, log, diagnostic, or network transmission           |
| Prompt, conversation, code, tool output                 | Prohibited  | Not required                                                                  | Must not cross reader boundary                      | Never                                                        | None                                                                                                        |
| Repository content/name and filesystem path             | Prohibited  | Used only internally to enforce a fixed safe root                             | Reader path guard only; never output                | Never                                                        | None                                                                                                        |
| Email, login, display name, API key, OAuth token        | Prohibited  | Not required for Community accounting                                         | Must not cross reader boundary                      | Never                                                        | None                                                                                                        |
| Model name, raw token components, raw usage record      | Prohibited  | Temporary input only when exact accounting revision requires components       | Reader-local parsing only                           | Never                                                        | Discard immediately after deriving the canonical total; never sign or log                                   |
| Provider ID                                             | Usage       | Closed reader selection                                                       | Local preview and signed discovery manifest         | Bounded candidate/registry field                             | Pending pairing only; server keeps immutable value on activated AgentAccount                                |
| Opaque candidate metadata                               | Account     | Distinguish candidates without raw identity                                   | Local preview and signed manifest                   | Closed bounded metadata                                      | Pending pairing only unless selected private label is saved                                                 |
| UTC usage date                                          | Usage       | Canonical account/day key                                                     | Local preview, `UsageSyncV1`, Ingest, own dashboard | Account/day totals and observations                          | Open/finalized accounting retention, then bounded cleanup; never public as an account breakdown             |
| Canonical cumulative token-total decimal string         | Usage       | Exact provider-reported total                                                 | Local preview, `UsageSyncV1`, Ingest, own dashboard | PostgreSQL `numeric(30,0)` plus canonical response text      | Current account/day and immutable observation retention; public only after aggregation into weekly snapshot |
| Reader version and accounting revision candidate        | Operational | Compatibility and server binding                                              | Connector, pairing, Ingest                          | Reader version in observation; immutable revision on account | Bounded operational/usage retention and audit; no provider-shaped raw schema                                |

### Usage ingestion and accounting

| Data                                                | Class                 | Source and purpose                                                | Visibility and access                               | Store                                                                 | Retention and deletion                                                                                |
| --------------------------------------------------- | --------------------- | ----------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `UsageSyncV1` raw bytes                             | Usage / Security      | Exact signed request                                              | Edge/Ingest memory only                             | Never persisted                                                       | Discard after settlement; bounded buffers overwritten where practical                                 |
| Sync ID                                             | Security / Usage      | Long-lived idempotency                                            | Ingest and exact account transaction                | Keyed by AgentAccount/device and request identity                     | Retain beyond retry horizon under fixed bounded policy; delete with profile after security window     |
| `observedAt`                                        | Operational           | Immutable observation metadata, signature freshness               | Ingest, own diagnostics; never ranking time         | Immutable observation metadata                                        | Bounded with observation; never public                                                                |
| Origin key ID, timestamp, nonce, HMAC, nonce digest | Security              | Authenticate Edge and prevent replay                              | Edge/Ingest; raw proof transient                    | Only digest/key ID/expiry inside atomic submission                    | Raw values per request; digest through replay window, then cleanup                                    |
| Device nonce, signature, body digest                | Security              | Authenticate exact body to one AgentAccount device                | Connector/Ingest; signature transient               | Nonce digest/idempotency reference only                               | Signature/body transient; replay reference through bounded security window                            |
| Immutable usage observation                         | Usage / Operational   | Audit one accepted monotonic submission                           | Ingest, Jobs, restricted own diagnostics            | AgentAccount/date, accepted total, versions, timestamps, request refs | Bounded raw-observation retention; delete with profile; never public or exported                      |
| AgentAccount/day total                              | Usage                 | One counted cumulative total per logical account and UTC date     | Own dashboard, Jobs ranking                         | Unique `agent_account_id, usage_date`, `numeric(30,0)`                | Through open season and reviewed finalization/retention; delete with profile                          |
| Dirty-season outbox item                            | Operational           | Coalesce ranking refresh work                                     | Ingest/Jobs only                                    | Unique season/trust key plus earliest dirty time                      | Remove or advance atomically after successful refresh; no private value in the item                   |
| Quarantine state and bounded reason code            | Account / Operational | Fail closed on reader/revision/scope/date/value/account ambiguity | Same-profile dashboard and restricted operations    | Closed code plus rounded timestamps                                   | Until resolved/disconnected/purged; no raw input or reflected value                                   |
| Audit/ranking event                                 | Operational           | Attribute security/accounting state transition                    | Restricted operations; bounded own subset if needed | Opaque actor/account refs, event code, coarse outcome/time            | Minimum/maximum retention fixed before launch; redact/remove profile links on purge as policy permits |

### Seasons, public snapshots, and caches

| Data                                             | Class                | Source and purpose                                                 | Visibility and access                             | Store                                          | Retention and deletion                                                                                     |
| ------------------------------------------------ | -------------------- | ------------------------------------------------------------------ | ------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| UTC season start/end and state                   | Public / Operational | Define one `provider_reported_tokens_v1` week                      | Public snapshot metadata; Jobs/Database authority | `seasons`                                      | Season definition retained with snapshots; never changed by client time                                    |
| Private profile weekly total                     | Usage                | Exact sum across eligible AgentAccount/day totals                  | Jobs and same-profile dashboard                   | Private materialization                        | Through season/finalization and profile deletion; not served by public request paths                       |
| Rank position and deterministic display position | Public               | Competitive rank and stable rendering                              | Public snapshot                                   | Immutable snapshot version/page                | Versioned season snapshot; purge/rebuild when profile hidden/deleted under documented policy               |
| Public weekly token total                        | Public               | Deliberate leaderboard aggregate                                   | Public Community or Verified snapshot             | Canonical decimal string                       | Same as published snapshot; no account/provider/day breakdown                                              |
| Public profile summary                           | Public               | Bounded handle, rank, total, tier, approved car, rounded freshness | Public profile route from snapshot only           | Immutable snapshot summary                     | Same as snapshot; hide/delete removes from newly published version; CDN purge remains operational evidence |
| Top-32 race payload                              | Public               | Lazy cosmetic race using the same ranking version                  | Public browser/CDN                                | One immutable payload per snapshot version     | Same as snapshot; no second ranking computation                                                            |
| Snapshot page, version, ETag                     | Public / Operational | Bounded cacheable public reads                                     | Web/CDN/visitor                                   | Immutable page plus atomic publication pointer | Keep current and bounded prior versions for safe rollover; exact maximum fixed before launch               |
| Private dashboard ranking/account health         | Account / Usage      | Show current own rank, accounts, devices, and sync health          | Same-profile only, `no-store`                     | Derived read, no shared cache                  | Per request; backing state follows profile/account retention                                               |

Community and Verified snapshots are physically and semantically separate. A public response never
contains an AgentAccount ID, provider breakdown, account label, device/installation count, daily
total, exact receipt time, reader error, or private health state.

### Database, deployment, operations, and test data

| Data                                             | Class                       | Source and purpose                                                                   | Visibility and access                                   | Store                                                          | Retention and deletion                                                                                          |
| ------------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Service PostgreSQL login/password and TLS trust  | Security                    | Authorize one exact Web, Auth, Ingest, Jobs, Admin, or migration capability          | Protected process memory only                           | External secret manager                                        | Rotate on exposure/role change; remove with capability; never tracked/logged                                    |
| Edge origin HMAC key                             | Security                    | Authenticate the sole public write path                                              | Edge and Ingest process memory only                     | External secret manager                                        | Rotate under overlap policy; remove retired key after request/replay window                                     |
| Cookie/recovery/audit peppers and purpose keys   | Security                    | Seal browser authority and derive keyed verifiers                                    | Exact protected service memory only                     | External secret manager                                        | Rotate on exposure; rotation impact documented; never tracked/logged                                            |
| Request ID, outcome, latency, bounded error code | Operational                 | Reliability, abuse, and incident correlation                                         | Response recipient and restricted aggregate operations  | Future structured logs/metrics; absent until launch review     | Shortest useful window; no body, handle, account, usage, key, cookie, raw error, hostname, or local path        |
| Protected change/incident record                 | Security / Operational      | Authorize migration, containment, restore, deletion recovery, release, or deployment | Named protected operators; never repository/public chat | External append-only system required but not implemented       | Jurisdiction/access/minimum/maximum/hold/export/deletion policy required before operation                       |
| Synthetic fixture identity, usage, keys, TLS     | Security / Usage; test-only | Prove exact paths without real users                                                 | One local test process and disposable container         | Repository-safe obvious synthetic fixture or runtime-only temp | One test run; remove container/network/storage/temp keys; immutable runtime copies are not an erasure guarantee |
| Build, checksum, SBOM, provenance, signature     | Operational / Security      | Prove one official connector artifact                                                | Public release metadata after protected success         | Release system/artifact store                                  | Release policy; no official artifact exists until hosted evidence is recorded                                   |

## Prohibited data

The following must not enter Vibe Racing network payloads, application/database logs, persistent
stores, public or private APIs, snapshots, caches, fixtures, diagnostics, support exports,
analytics, or tracked files:

- prompts and conversations;
- source code, tool output, repository contents, repository names, and filesystem paths;
- GitHub/provider account email, login, display name, avatar payload, or a hash presented as
  anonymity;
- API keys, OAuth tokens, provider credentials, Codex credentials, private signing keys, passkey
  secrets, recovery plaintext, cookies, or database credentials;
- model names, subscription or price data, raw provider token components, raw usage records, session
  transcripts, and generic MCP/tool data;
- raw IP history, exact user-agent strings, private hostnames, certificate private keys, database
  rows/errors/dumps, protected incident details, and real-user screenshots.

Readers may momentarily inspect exact documented usage fields inside a bounded local process, but
their public output type cannot represent prohibited fields. Errors are closed and non-reflective.

## User controls and deletion

An authenticated profile can:

- hide or show its public profile;
- change its public handle and approved CarRecipe;
- view private AgentAccounts, installations, devices, ranking, and bounded sync health;
- pause, reactivate, disconnect, or relabel an owned AgentAccount under the required passkey policy;
- revoke an owned device or installation;
- manage passkeys and recovery;
- request terminal profile deletion with fresh passkey confirmation.

Visibility changes remove the profile from the next published snapshot and require reviewed cache
purge behavior. They do not erase private accounting state.

Confirmed deletion atomically hides the profile and revokes sessions, passkeys, recovery,
installations, devices, AgentAccounts, and pending pairing authority before physical purge. Jobs
owns the bounded primary purge. Audit references, terminal job evidence, immutable release evidence,
external caches, provider tokens, backups, and stale-restore replay follow separately disclosed
retention and recovery policies.

The repository currently proves only local synthetic primary-database behavior. It does not prove a
CDN purge, external backup expiry, provider revocation, notification, legal hold, stale-backup
deletion replay, production recovery, or deletion of real-user data.

## Launch review

Before any real participant data is accepted, record and review:

- exact production data region and subprocessors;
- cookie and public/private cache policy;
- rate-limit signals and maximum retention;
- audit/log/metric allowlists and retention;
- snapshot-version retention and cache invalidation;
- observation, idempotency, replay, revoked-authority, and terminal-job retention;
- provider OAuth scope/storage/revocation for any Verified integration;
- export, access, deletion, incident-hold, and backup/restore policy;
- clean-machine connector behavior on every supported platform;
- user-facing EN/RU privacy and Community/Verified disclosures.

Until that launch decision is complete and hosted evidence exists, the project must not claim
production privacy operations, deployment, monitoring, provider verification, or real-user
retention/deletion behavior.
