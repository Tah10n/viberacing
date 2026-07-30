# Vibe Racing threat model

## Overview

Vibe Racing is a pre-release, reward-free weekly leaderboard for provider-reported coding-agent
tokens. One immutable GitHub numeric user ID owns at most one profile. A profile may own several
`AgentAccount` records across one or more providers, and each AgentAccount may have several
independently revocable device keys. Devices and connector installations do not create additional
counted usage.

The competitive metric is `provider_reported_tokens_v1`: the exact accepted sum of unique
AgentAccount/UTC-date cumulative totals for one week. Community usage is self-reported and separate
from any future server-verified provider integration. Tokenizers differ, so the product makes no
claim about normalized cost, compute, effort, quality, or one-human uniqueness.

[ADR 0076](../decisions/0076-clean-agent-account-provider-reported-token-ranking.md) is the accepted
clean-slate target. The former Codex-specific source/score runtime is absent from the current tree;
the remaining exact-version Codex reader is a recognized candidate, not a supported provider.
[Implementation status](../IMPLEMENTATION_STATUS.md) is the evidence boundary. The
[security invariants](../architecture/SECURITY_INVARIANTS.md) are the normative target. Local and
synthetic tests are not deployment, provider, release, monitoring, capacity, or real-user evidence.

### Assets and security objectives

| Asset or property                    | Objective                                                                                                                        |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| GitHub profile binding               | One immutable numeric ID maps to at most one profile; mutable GitHub fields are not authority                                    |
| Passkeys, sessions, and recovery     | Action-bound, short-lived, exact-origin authority with terminal revoke and no GitHub-as-recovery                                 |
| Installation and device private keys | Native credential-store only, account-scoped, independently revocable, no plaintext fallback or export path                      |
| AgentAccount attribution             | Provider, accounting revision, trust tier, and accounting scope are immutable and server-owned                                   |
| Reader privacy boundary              | Mixed-content local storage releases only the closed usage projection; prohibited content remains local                          |
| Usage integrity                      | Exact decimal totals, UTC dates, account/day deduplication, overlap exclusion, monotonic updates, and atomic replay/idempotency  |
| Community/Verified separation        | Community cannot assert or become Verified; tiers never merge                                                                    |
| Public ranking                       | Derived only from complete immutable snapshots; exact total is the sole ranking input; equal totals share rank                   |
| Database authority                   | Forced RLS, schema ownership separation, fixed least-privileged functions, no arbitrary runtime SQL                              |
| Deletion and retention               | Immediate authority lock-down, bounded primary purge, explicit snapshot/cache/backup/restore boundaries                          |
| Release and deployment authority     | Pull requests are secretless; official connector and deployment claims require external protected evidence                       |
| Public repository                    | No working secret, personal data, prompt, code, private log, credential, local path, or protected incident evidence is committed |

## Threat Model, Trust Boundaries, and Assumptions

### Actors and attacker capabilities

- An unauthenticated remote client can scrape public snapshots, send malformed requests, guess
  pairing codes, replay bytes, manipulate headers and encodings, and create load.
- An enrolled Community participant controls local files, clocks, timezones, the connector process,
  and all self-reported values for accounts they can bind.
- A hostile local process running as the user may read or use credential-store material. Native
  storage reduces accidental disclosure; it does not claim hardware-backed non-exportability.
- A malicious participant may attach several installations or devices, create several AgentAccounts,
  attempt overlapping provider scopes, race idempotency keys, and retry old observations.
- A compromised browser session may attempt CSRF, IDOR, stale continuation, passkey-replay, account
  swapping, or batch tampering.
- A compromised Edge, Web, Ingest, Jobs, Admin, or migration login may attempt to exceed its fixed
  database capability.
- A malicious dependency, workflow change, release actor, registry package, container, or build
  runner may attempt supply-chain substitution or credential theft.
- A database owner, deployment controller, provider, GitHub, CDN, OS credential store, or user host
  is a high-impact trusted dependency and can violate assumptions outside application controls.

### Trust boundaries

| ID    | Boundary                                     | Untrusted input                                                                                      | Trusted decision point                                                                                                                       | Principal failures                                                                                                              |
| ----- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| TB-01 | Public repository and contributor to CI      | Git objects, PR code, workflows, lockfiles, fixtures, docs, binaries                                 | Public-file/history checks, direct-or-remediated DCO validation, exact pins, secretless CI permissions, human review                         | Secret/personal-data publication, false contributor certification, workflow privilege, dependency substitution                  |
| TB-02 | Browser to GitHub OAuth and Web/Auth         | OAuth callback, state, code, browser cookies, mutable profile fields                                 | Exact redirect, state plus PKCE, numeric-ID resolution, unique database binding, purpose-separated cookies                                   | Login CSRF, account substitution, duplicate profile, token leakage, GitHub used as recovery                                     |
| TB-03 | Browser to passkey/session/recovery boundary | WebAuthn options/results, cookies, form fields, encrypted controls, recovery selector                | Exact RP ID/origin/challenge/action, credential provenance, fresh step-up, one-time restricted recovery                                      | Replay, stale authority, IDOR, CSRF, credential downgrade, normal session minted too early                                      |
| TB-04 | Agent local storage to built-in reader       | Mixed prompt/code/log/database records, paths, links, encodings, sizes, duplicate keys, schema drift | Bounded provider-specific reader and privacy output type                                                                                     | Exfiltration, traversal, reparse escape, resource exhaustion, partial understated totals, double counting, guessed schema       |
| TB-05 | Connector installation to pairing start      | Discovery candidates, provider labels, opaque fingerprints, pending public keys, installation proof  | Closed manifest, installation possession, provider registry, bounds, rate policy                                                             | Candidate injection, account overlap, cross-origin binding, pending-key accumulation, reflected local content                   |
| TB-06 | Signed-in browser to batch approval          | Pairing transaction, ordered create/attach/skip decisions, fallback code, target-account controls    | Session ownership, encrypted continuation, provider match, one fresh passkey over the complete ordered batch                                 | Batch swap, partial activation, cross-profile attach, same-provider mismatch, skipped-key retention                             |
| TB-07 | Device to Edge and Ingest                    | Raw body, headers, nonce, timestamp, signature, account ID                                           | Exact Edge route/HMAC and Ingest framing/schema/binding/Ed25519 verification                                                                 | Forgery, replay, wrong-account submission, path confusion, encoding ambiguity, database writes before proof                     |
| TB-08 | Verified lookup to atomic usage transaction  | Validated body plus server-read installation/device/account/provider/revision material               | One PostgreSQL transaction revalidating state, consuming replays/idempotency, enforcing UTC/monotonicity, and writing all derived state      | Time-of-check/time-of-use race, partial mutation, replay consumed without usage, usage without replay consume, revision relabel |
| TB-09 | Jobs scheduler to fixed maintenance catalog  | Time, dirty-season outbox, process signals, database failures                                        | Exact default-off catalog, sequential no-overlap runner, least-privileged Jobs role, transactions                                            | Arbitrary SQL, duplicate refresh, missed settlement, stale partial snapshot, crash after external side effect                   |
| TB-10 | Snapshot builder to public Web/CDN           | Private account/day totals, visibility state, season lifecycle                                       | Versioned immutable page/top-32/profile-summary builder, publication pointer, ETag/cache policy                                              | Private breakdown disclosure, live ranking query, partial publication, cache leak, stale hidden profile                         |
| TB-11 | Cloudflare Edge to direct Ingest origin      | Caller-controlled request and attempted origin headers                                               | Independently configured body/path-bound HMAC, certificate-verified transport, exact forwarded-header allowlist                              | Direct-origin bypass, caller-supplied authority, key confusion, proof replay, unbounded retry                                   |
| TB-12 | Runtime service to PostgreSQL                | Compromised service process, parameters, pool state                                                  | Distinct NOLOGIN roles, probed narrow logins, forced RLS, fixed functions, parameterized adapters, reset-before-reuse                        | Cross-role mutation, schema ownership, RLS bypass, stale role reuse, arbitrary query                                            |
| TB-13 | Admin/release/operator to protected systems  | Access assertion, reason, workflow tag, environment approval, deployment inputs, incident actions    | Separate membership, fresh passkey, audit acknowledgements, protected environment, exact artifacts and runbooks                              | Self-approval, wrong artifact, secret exposure, unreviewed migration, false deployment/release claim                            |
| TB-14 | Backup/restore/deletion to durable state     | Archives, deletion jobs, caches, snapshots, external backups, stale credentials                      | Isolated restore controller, deletion lock-down, bounded purge, keyed resurrection policy when implemented, protected aggregate verification | Deleted identity resurrection, partial purge, stale public snapshot, credential revival, unsupported restore                    |
| TB-15 | Connector build to installed artifact        | Source revision, toolchain, dependencies, platform package, signature, update/uninstall path         | Protected supported-platform build, checksum, SBOM, provenance, signature, clean-machine lifecycle, support declaration                      | Binary substitution, unsigned package, plaintext credential fallback, unsupported version presented as official                 |

### Input ownership

The client owns only request identifiers, observation metadata, and canonical decimal totals derived
by an admitted reader. It does not own provider, accounting revision, trust tier, accounting scope,
profile, eligibility, accepted UTC window, season, snapshot, or rank.

The server owns AgentAccount attribution and all derived state. PostgreSQL clock owns date
eligibility. Jobs owns snapshot publication. A browser owns one authenticated create/attach/skip
decision only after the complete batch is bound to one fresh passkey assertion.

### Assumptions and accepted limitations

- Community values can be fabricated by the computer owner. Device signatures prove the submitting
  key, not honest agent execution or provider-account ownership.
- One immutable GitHub numeric ID is a stable upstream identity key, not proof of one human. One
  human may operate several GitHub accounts.
- Provider-reported tokens from different tokenizers are not economically or computationally equal.
- A supported reader remains safe only for its exact reviewed schema and accounting revision.
- Native credential stores do not stop a process running with the user's authority from using or
  extracting key material.
- Edge HMAC does not make a compromised Edge trustworthy.
- RLS and narrow functions reduce runtime blast radius but do not contain a database owner or
  superuser.
- Public snapshots intentionally disclose handle, weekly aggregate, rank, and approved cosmetic
  profile fields for visible profiles.
- Protected GitHub, provider, deployment, signing, CDN, monitoring, backup, and incident systems are
  external dependencies. Repository checks cannot prove their configuration or operation.
- No production or real-user state exists. Until hosted evidence is recorded, every operational
  result is local or synthetic only.

## Attack Surface, Mitigations, and Attacker Stories

### Surface map

| Surface                  | Primary controls                                                                                                                                                      | Residual risk                                                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| GitHub enrollment        | State, PKCE, exact callback, minimal scope, numeric-ID uniqueness, no token persistence, required initial passkey                                                     | Several GitHub accounts per person; upstream compromise                                                  |
| Passkey/session/recovery | Exact WebAuthn ceremony, purpose cookies, one-time challenges, provenance, fresh step-up, restricted recovery, terminal revoke                                        | Authenticator/browser/host compromise                                                                    |
| Discovery and pairing    | Built-in readers, bounded manifest, installation proof, rate limit, one batch continuation, one fresh passkey, provider-matched attach, terminal cleanup              | User can intentionally create several real accounts; fallback code can be phished                        |
| Local readers            | Closed provider registry, exact accounting revisions, strict roots and bounds, privacy type, sentinel fixtures, fail-closed unknown schema                            | Novel safe-looking drift can cause denial until a reviewed reader update                                 |
| Usage ingress            | Sole route, exact framing, Edge HMAC, Ed25519, non-mutating lookup, atomic PostgreSQL transaction, monotonic totals, long-lived idempotency                           | Compromised authorized device can fabricate its account's Community total                                |
| Ranking and snapshots    | Exact decimal direct sum, overlap exclusion, shared ranks, dirty outbox, bounded Jobs refresh, immutable publication, last-good retention, snapshot-only public reads | Delayed public freshness; disclosed public aggregate enables work-pattern inference                      |
| Public Web/CDN           | Semantic SSR, strong ETag, shared-cache policy, bounded pages, no raw breakdown, hidden-profile filtering                                                             | Scraping of intentionally public fields; operational cache purge remains external                        |
| Private dashboard        | Authenticated profile ownership, `no-store`, encrypted account controls, CSRF protection, bounded metadata                                                            | Compromised browser/session sees the user's private account inventory                                    |
| Database roles           | Owner separation, NOLOGIN roles, forced RLS, fixed functions, probes, parameterized adapters, reset-before-reuse                                                      | Owner/superuser compromise                                                                               |
| Jobs and migration       | Exact default-off startup, fixed catalog, no overlap, transactions, narrow login, advisory lock, checked manifest                                                     | Committed external side effects require explicit recovery; local scheduler is not durable hosted cadence |
| Deletion/restore         | Immediate lock-down, bounded purge, retention, isolated restore, protected oracles, no raw operator SQL                                                               | Cache/backup/tombstone replay is not proven until separately implemented and hosted                      |
| Connector release        | Exact dependencies, protected builds, signatures, checksums, SBOM, provenance, clean-machine lifecycle, support matrix                                                | Platform signer, package host, update channel, or user machine compromise                                |

### High-value attacker stories

#### Identity duplication and account substitution

An attacker races OAuth callbacks, reuses state, changes a mutable GitHub field, or performs
repeated OAuth to create another profile. Controls are exact state plus PKCE, one-use continuation,
numeric-ID resolution, a unique immutable database key, and an atomic create-or-open procedure.
Collision and provider failure return generic results with no partial profile or session.

#### Batch pairing swap

An attacker guesses a fallback code, replaces one discovery candidate, changes create to attach,
targets another profile's AgentAccount, or replays an approved batch. Controls are bounded
server-generated transactions, keyed code and poll verifiers, installation possession, encrypted
session-bound continuation, exact ordered decision digest, one fresh passkey assertion, provider
match, atomic activation, and terminal replay denial.

#### Multi-device double counting

A participant binds several devices to one AgentAccount and submits the same cumulative day from
each. Controls are AgentAccount/date uniqueness, monotonic maximum semantics, immutable
observations, long-lived idempotency, and one account/day projection. Device count is never an
aggregation dimension.

#### Overlapping accounting domains

A participant attempts to count a provider-wide aggregate and included agent-specific accounts, or
attaches one discovered local domain to two accounts. Controls are accounting-scope registry
metadata, opaque stable domain uniqueness when safely available, explicit same-provider attach when
it is not, batch conflict review, and database rejection of active incompatible scopes.

#### Reader exfiltration or schema confusion

A hostile log, JSON, SQLite database, symlink, reparse point, alternate stream, encoding, duplicate
key, or oversized record attempts to leak prompt/code/path/email/key material or create an
understated/duplicated total. Controls are exact safe roots, link/device-path rejection, bounded
read-only access, duplicate-key-aware parsing, closed record kinds, whole account/day invalidation,
privacy-only output types, non-reflective errors, and sentinel fixtures scanned through the signed
network request.

#### Zero-write verification bypass

An attacker sends a valid origin proof with an invalid device signature, a valid device signature
for another account, or malformed body designed to reserve replay state. Ingest performs no
persistent write before Ed25519 verification. The final transaction revalidates every binding and
consumes both replay domains together with idempotency and usage mutation.

#### Numeric precision or date manipulation

An attacker sends a total outside exact bounds, a fractional/exponential/non-canonical value, a
future date, a date derived in local timezone, or a stale observation with a fresh client clock.
Contracts accept canonical decimal strings only; TypeScript never uses `Number`; PostgreSQL
`numeric(30,0)` and database clock enforce value, UTC date, backfill, monotonicity, and
finalization.

#### Snapshot poisoning or partial publication

A refresh crashes after writing some pages, a malicious profile has an oversized total, or a hidden
profile remains cached. Jobs builds a complete version under fixed bounds, validates row/page/top-32
invariants, and atomically advances the publication pointer only after success. Failure preserves
the last good version. Visibility changes coalesce a refresh and public responses are built only
from the published snapshot.

#### Community-to-Verified promotion

A client submits a tier, provider, revision, OAuth-looking field, or supposedly verified flag.
`UsageSyncV1` rejects every such field. AgentAccount trust is server-owned. Verified uses a separate
server-side provider integration, storage path, snapshot, and public label, and remains disabled
without provider evidence.

#### Database role expansion

A compromised service attempts raw SQL, another function, role inheritance, stale assumed role, or
schema ownership. Runtime logins are distinct, probed, and NOINHERIT; roles are NOLOGIN; forced RLS
applies; adapters expose fixed parameterized calls; pooled sessions reset before reuse;
widened-login integrations prove denial and no mutation.

#### Release substitution

An attacker presents a locally compiled or modified connector as official. The project claims
official support only for an exact supported version whose protected platform artifacts have
signature, checksum, SBOM, provenance, and clean-machine lifecycle evidence. Pull-request CI has no
signing or publication authority.

#### Deletion resurrection

A failed purge, stale snapshot, cache, archive, credential, or restored database revives identity or
usage. The request transaction immediately hides and revokes authority; Jobs performs bounded
primary purge; public snapshots refresh from eligible state; restore remains isolated until the
reviewed deletion-replay oracle passes. Backup/cache/tombstone behavior is not claimed until
separately implemented and evidenced.

### Lower-value and out-of-scope stories

- A participant cosmetically edits a CarRecipe: bounded enums are allowed and cannot change rank.
- A participant fabricates Community usage for their own account: accepted residual risk unless it
  crosses account scope, bypasses bounds, becomes Verified, or grants value.
- A visitor scrapes intentionally public handles, ranks, totals, and approved cars: expected public
  behavior within rate/capacity policy; private breakdown disclosure is not.
- Provider tokenizer differences produce unlike values: disclosed product limitation, not corrected
  through subjective normalization.
- A local user explicitly exports shell output or shares a screenshot: outside application control;
  the product minimizes and labels its own output.

## Severity Calibration (Critical, High, Medium, Low)

### Critical

- Production signing, deployment, database-owner, provider OAuth, or release authority theft with a
  credible path to broad compromise.
- Remote code execution in a public service or official connector update path.
- Cross-profile arbitrary critical-action authority at scale.
- Silent Community-to-Verified promotion that grants a valuable privilege.
- Broad resurrection of deleted identities and credentials from a supported restore path.

### High

- Cross-profile AgentAccount/device attachment or usage mutation.
- Prompt, code, repository, path, email, API key, credential, or raw local record leaves the reader
  boundary.
- Invalid device signatures persist replay or usage state.
- Database runtime role can execute another service's capability or own/bypass private schema.
- Snapshot publication exposes private account/day/provider breakdown or a hidden profile.
- Official connector artifact substitution or plaintext private-key fallback.

### Medium

- Same-account replay, idempotency, monotonicity, date, or overlap bug that materially inflates
  rank.
- Pairing fallback-code weakness without profile-level escalation.
- Public cache, ETag, page, or last-good behavior leaks stale public state beyond the documented
  window.
- Resource-exhaustion issue requiring realistic sustained traffic but no data compromise.
- Misleading EN/RU trust copy that implies provider verification, equal compute, or rewards.

### Low

- Cosmetic renderer defect without script/content injection or competitive effect.
- Non-sensitive diagnostics, documentation drift, or stale recognized-provider metadata that does
  not make an unsupported reader usable.
- Bounded availability loss with no persistent mutation or privacy impact.

Severity is calibrated to realistic prerequisites, blast radius, detectability, persistence, and the
pre-release evidence boundary. A locally reproducible defect is not automatically a production
incident, and absence of deployment does not reduce the required fix quality for code intended to be
released.
