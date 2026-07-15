# Privacy data map

## Status and principles

The current repository contains a private SQL schema and synthetic PostgreSQL integration test, but
no deployed application database, user accounts, production service, or real user data. This
document remains the required inventory for implementation. A field may not be collected merely
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

| Data                                                                | Class                           | Source and purpose                                                 | Visibility and access                                                   | Planned store                                                           | Retention and deletion                                                                                      |
| ------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Resolved GitHub numeric user ID                                     | Account                         | GitHub OAuth; enforce one Vibe Racing profile per upstream ID      | Web/Auth and uniqueness procedure only                                  | `profiles` identity binding                                             | Until profile deletion; short security tombstone only if justified and disclosed                            |
| GitHub access token                                                 | Prohibited after callback       | GitHub OAuth; resolve the numeric ID once                          | Callback memory only                                                    | Never persisted                                                         | Discard immediately after identity resolution                                                               |
| Public handle                                                       | Public                          | User; identify the race profile                                    | Public after preview; moderation/admin through audited capability       | `profiles`                                                              | Until changed, hidden, or deleted; public caches purged on hide/delete                                      |
| Optional GitHub profile link                                        | Public                          | User opt-in; distinguish an upstream public identity               | Public only after explicit opt-in                                       | `profiles` preference                                                   | Until opt-out or deletion; purge public cache                                                               |
| Locale, theme, reduced-motion, privacy preferences                  | Account                         | User; product experience and visibility controls                   | User profile; only public effects are visible                           | `profiles` or preference store                                          | Until reset or deletion                                                                                     |
| Invite verifier and state                                           | Security                        | Operator-issued invite; gate beta enrollment                       | Invite procedure and limited admin role                                 | Slow/keyed hash, status, expiry, non-sensitive audit                    | Expiry/redemption plus bounded abuse/audit window; launch decision required                                 |
| Session verifier and metadata                                       | Security                        | Web/Auth; maintain an authenticated browser session                | Web/Auth only                                                           | Keyed verifier, expiry, state, and authenticating-passkey provenance    | Short expiry and bounded revocation window; delete/revoke on profile deletion                               |
| WebAuthn credential public key and credential ID                    | Security                        | User authenticator; login and fresh step-up                        | Web/Auth; user can list only bounded friendly metadata                  | `passkeys`; no attestation fingerprint store                            | Active until removal; revoked reference until bounded cleanup/profile deletion; launch decision required    |
| WebAuthn challenge, context, and verifying-passkey reference        | Security                        | Server; bind one ceremony to one action and exact credential       | Web/Auth only                                                           | Short-lived challenge with exact session/profile/action/passkey binding | One-time, at most minutes; bounded expiry cleanup required before launch                                    |
| Recovery-code selector and verifier                                 | Security                        | Web/Auth-generated; recover profile access                         | Web/Auth only; plaintext secret shown once to the user                  | Opaque selector and Argon2id PHC; protected pepper stays outside DB     | PHC scrubbed on use; batch removed on regeneration, completion, or deletion; cleanup before launch          |
| Restricted recovery authority and registration binding              | Security                        | Server; permit only exact replacement-passkey registration         | Web/Auth recovery procedure only                                        | Keyed verifier plus challenge/context digests and terminal lifecycle    | One-time, at most 10 minutes; terminal-row retention and cleanup are a launch decision required             |
| Source ID, state, and source count                                  | Account; count is Public        | User-declared opaque CodexSource; isolate and explain aggregation  | User sees sources; public sees only contributing count for a season     | `codex_sources`, season snapshot                                        | Source lifecycle plus historical public count until profile deletion                                        |
| Device public key and public device ID                              | Security                        | Connector; authenticate one source-bound device                    | Ingest verification; user device inventory                              | `device_keys`                                                           | Until revoke/unlink/delete; revoked identifier retained only for bounded security need                      |
| Device label                                                        | Account                         | User or safe generated default; distinguish devices                | User profile only                                                       | `device_keys` metadata                                                  | Until edited/revoked/deleted; bounded plain text with warning not to enter personal data                    |
| Connector, Codex, and OS-family versions                            | Security; Operational           | Connector; compatibility and incident diagnosis                    | User device inventory and limited operations                            | Device/sync metadata                                                    | Current device state plus bounded compatibility history; launch decision required                           |
| Pairing poll token, verifier, challenge, user code, and transaction | Security                        | Server/connector; poll safely and bind browser approval to one key | Pairing service, connector memory, and browser confirmation             | Plain poll token returned once; only keyed verifier/challenge persisted | Plaintext never logged/persisted; verifier, challenge, and code expire after completion or short timeout    |
| `codexReportedDate` and exact daily token value                     | Usage                           | Local stable App Server adapter; compute Community score           | Isolated Ingest and Jobs scoring/cleanup procedures; never public raw   | `usage_snapshot_entries`, `source_day_values`                           | Raw snapshot is Jobs-cleanup eligible after 30 days; current/history policy remains a launch decision       |
| Connector `observedAt`, server `receivedAt`, nonce, idempotency key | Security; Usage                 | Connector/server; replay, ordering, deadline, and retry safety     | Isolated Ingest and Jobs cleanup procedures; shared finalization policy | `usage_snapshots`, `device_nonces`                                      | Nonce after 15 minutes and raw snapshot after 30 days; scheduler and production purge proof remain required |
| Daily and weekly score, active days, shared rank                    | Public                          | Server-derived from accepted source/day state                      | Private Jobs materialization; future Public Community race/profile      | `season_daily_scores`, `season_entries`, `seasons`, `score_versions`    | Finalized rows are immutable except profile purge; public history retention still needs launch policy       |
| Rounded freshness and contributing source count                     | Public                          | Server-derived privacy-preserving status                           | Source count is private Jobs state; future Public Community projection  | `season_entries`; future public projection or cache                     | Refresh excludes hidden/deleting profiles; profile-row purge cascades; freshness/cache policy is pending    |
| Streak                                                              | Public when enabled             | Server-derived informational field                                 | Public only under profile visibility setting                            | Season/profile projection                                               | Recomputed or deleted with profile; never increases score                                                   |
| CarRecipe and proposal state                                        | Public recipe; Account proposal | User/agent enum proposal and explicit browser approval             | Proposal private until approval; active car public                      | Versioned recipe/proposal tables                                        | Rejected proposals short-lived; approved recipe until change/delete; launch decision required               |
| IP-derived request signal and user-agent family                     | Operational                     | Edge/service; security, rate shaping, and reliability              | Restricted operations; never leaderboard or behavioral advertising      | Prefer aggregate/ephemeral edge controls; minimal event when necessary  | Shortest operational window; exact scope and duration require launch privacy review                         |
| Request ID, outcome, latency, and bounded error code                | Operational                     | Edge/services/jobs; debugging and SLO evidence                     | Restricted operations; safe aggregate metrics                           | Structured logs/metrics                                                 | Bounded by operational need; no raw token value, credential, body, or profile export                        |
| Security/admin audit event and reason                               | Security; Operational           | Auth/admin/jobs/release; accountability                            | Restricted responders/auditors; user-visible subset where appropriate   | Bounded `audit_events` reference; external append-only sink planned     | Publicly documented bounded policy; profile link redacted on purge; delete unrelated personal data          |
| Deletion state and security tombstone                               | Security                        | Deletion workflow; prevent ingestion and restore resurrection      | Deletion/jobs/auth and limited audit                                    | Deletion job plus minimal tombstone                                     | Primary data purged in service window; tombstone expires after disclosed minimum security period            |
| Maintenance capability mutex                                        | Operational                     | Database; serialize bounded cleanup and scoring capabilities       | Owner-defined Jobs procedures only                                      | Two fixed `maintenance_locks` enum rows; no user or request data        | Retained while each capability exists; removed only by a reviewed migration                                 |

Opaque sources deliberately contain no Codex account email or upstream account identifier. The
implemented pairing database caps each profile at 32 lifetime source records and 64 active plus
unexpired approved device authorities. These public safety ceilings do not replace lower
deployment-private rate and fair-use controls, and exact per-source details remain non-public
Account data. Revision 0004 adds no new personal-data column: its private inventory procedure
returns only the requesting session profile's opaque source state and bounded device metadata.
Lifecycle procedures retain the existing source/device rows, append only closed audit references,
and never accept or expose account email, upstream account identity, exact usage, public keys, or
internal key IDs.

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

Revision 0008 adds deletion evidence for only those raw nonce and snapshot rows: a Jobs-only
procedure derives cutoff time on the server, deletes bounded expired batches, cascades raw entries,
and preserves the current source/day value while clearing its deleted snapshot reference. A fixed
owner-only mutex row and five-second lock timeout prevent runtime roles from seizing a public lock
key or waiting without a database bound. The synthetic PostgreSQL suite proves idempotency, live-row
preservation, role denial, and two-worker serialization. No scheduler, service, production retention
monitor, backup policy, or real-user purge evidence exists, so real-user ingestion remains blocked.

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
service, or scheduler exists.

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
  approval, and deletion initiation; it cannot use a device credential or recovery authority as a
  user session.
- Ingest accepts only source-bound signed sync through a narrow procedure; it cannot read or change
  passkeys, sessions, invites, admin roles, schema, or finalized seasons.
- Jobs currently receive only bounded expired ingest-state cleanup, open-season Community scoring
  refresh, and terminal finalization. Correction, public projection, and deletion capabilities
  require separate migrations and tests; migrations use a different non-runtime owner.
- Public read models contain only fields explicitly classified Public. Authenticated responses are
  private and `no-store`; public cache keys cannot include or mix session state.
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
- **Hide profile:** public reads and caches stop immediately without waiting for full deletion.
- **Revoke device:** the key loses submission authority immediately; previous season attribution
  remains under policy.
- **Unlink source:** future submissions stop; historical season attribution remains until deletion
  or documented correction.
- **Export:** any future export is authenticated, bounded, generated on demand, and contains only
  the requesting profile's data. No export endpoint is implied by this design document.
- **Delete:** GitHub session, fresh passkey, and typed handle trigger immediate hide,
  session/passkey/device/recovery-authority revoke, recovery-code removal, ingest rejection,
  idempotent primary purge, cache purge, and backup/tombstone handling.

Restore procedures replay deletion markers before restored data is made available. The UI reports
progress without exposing internal record IDs. Legal retention exceptions, if any, require launch
legal review and explicit public disclosure; they are not assumed here.

## Logs, diagnostics, and support

Operational logs use stable event names, request IDs, coarse outcomes, and bounded numeric metrics.
They omit request bodies, raw token values, handles when not needed, OAuth/passkey material, device
signatures, recovery selectors/secrets/PHCs/authority verifiers, local paths, and prohibited data.

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
