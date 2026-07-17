# Threat model

## Overview

Vibe Racing is intended to be an invite-only, English/Russian, pixel-art weekly leaderboard for
people who use Codex. A local connector will read a narrow usage response from a user-controlled
Codex App Server and submit bounded daily values. The public product will rank participating Vibe
Racing profiles in a self-reported Community league.

This is a repository-scoped design threat model. The current tree contains public repository policy,
toolchain, CI, documentation, local PostgreSQL identity/passkey/recovery foundations, and one local
Next.js public-score route, one local invite/OAuth/initial-passkey enrollment and returning-passkey
login plus private passkey/source/device inventory, source pause/reactivation/unlink, device/passkey
revocation, fresh-passkey recovery-code rotation, and fresh-passkey profile-deletion-request slice
plus one-time recovery-code replacement-passkey sign-in with encrypted cookies and logout, one local
one-shot Jobs runner, and local Community sync verification plus PostgreSQL-adapter, transport-free
composition, and bounded Fastify HTTP boundaries; it does not yet contain a deletion purge worker,
deployed Ingest service, Jobs scheduler, operational connector, deployment, or production data. A
library-only Rust connector foundation now bounds and validates the stable App Server initialization
and candidate account/usage exchanges, then composes them through a synthetic one-shot child
supervisor and produces exact sync material behind a second inaccessible reviewed context. An
isolated one-use signer consumes that material only with a third inaccessible device-bound key
capability and returns a closed signed envelope. A separate pending-key/challenge signer and pure
Web verifier agree on an exact pairing-possession proof. A Web/Auth start application generates
bounded pending-transaction material, separate protected poll/code verifiers, and one fixed database
call. A second application composes protected keyed poll lookup, strict proof, and exact atomic
activation through the separately probed read-write pool with local admission/timing. Between those
boundaries, a local `/connect` flow performs session-rate-limited pending-code lookup, exact
device/fingerprint review, opaque new or active existing source selection, and fresh-passkey atomic
approval of that exact choice. Exact local start/poll routes now add closed framing/contracts,
shared four-call admission, and fixed global/client-bucket PostgreSQL windows. The one-command Rust
client generates and stores a pairing key through the native OS credential store, signs the exact
proof, and persists activation before success output. No Codex launch or sync-context capability has
a public constructor. A separate private Windows x86_64 development command can construct them only
after exact explicit-path artifact admission and active-record review, then sends one fixed signed
sync without retry or edge credentials. It cannot discover a binary, admit another platform/version,
or create a support claim. Its database-only Community ingest and bounded ingest-retention
boundaries have synthetic executable evidence. The kernel has raw-envelope, origin-proof,
bounded-parser, contract, and strict device-signature evidence; the adapter has configuration,
fixed-query, role-probe, mapper, and failure evidence with mock pools. A local server factory now
has loopback framing and injection evidence, but no live HTTP edge, host/port/TLS deployment entry
point, or working database login/TLS connection. One signed synthetic request now exercises their
required local composition through a mock pool and validated result/problem decisions. The public
score route has request/response, admission, production-build, and visible browser-consumer/fallback
evidence, while the Jobs runner has strict command/config/pool/role/result evidence. The identity
slice has exact-origin/body/cookie, state/PKCE, token minimization, initial-registration,
returning-login, session-derived passkey inventory, non-current-key revocation, backup-key addition,
exact-handle profile-deletion request, source inventory/pause/reactivation/unlink, and active-device
revoke including hidden-profile PostgreSQL evidence, fixed queries, admission, exact GitHub-only
OAuth `form-action`, and EN/RU UI evidence with injected dependencies. Raw source IDs stay
server-only; source controls receive only a 15-minute encrypted token bound to the active session.
None has a live database login, OAuth app, authenticator, edge, scheduler, purge execution, or
network deployment. Controls below are marked **implemented** only when executable evidence exists
in [implementation status](../IMPLEMENTATION_STATUS.md). Other controls are release requirements,
not security claims about the current tree.

### Assets and security objectives

| Asset or objective                                | Why it matters                                                               | Required protection                                                                                            |
| ------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Public project and release integrity              | Users may execute connector binaries and trust deployment artifacts          | Protected revisions, review, signed artifacts, checksums, SBOM, provenance, rollback                           |
| Connector device private keys                     | A stolen key can submit as its bound Community source                        | OS credential store, source binding, revocation, rotation, no plaintext fallback                               |
| Sessions, passkeys, recovery, and invites         | They control profile identity and security-sensitive actions                 | Exact origins, one-time challenges, restricted recovery authority, hashed tokens, fixation and replay defenses |
| GitHub identity binding                           | It enforces one Vibe Racing profile per resolved GitHub user ID              | Minimal OAuth scope, state, PKCE, exact redirects, token disposal, database uniqueness                         |
| Private usage buckets and exact timestamps        | They can reveal work volume and schedule                                     | Data minimization, private-by-default access, bounded retention, log redaction, deletion                       |
| Public handle, score, rank, source count, and car | They affect reputation even though they grant no privilege                   | Server-derived fields, plain-text rendering, bounded recipes, clear Community label                            |
| Season and scoring integrity                      | Finalized public results must not be silently rewritten                      | Versioned formula, profile-level cap, server deadlines, immutable finalization, audited correction             |
| Database roles and migration ownership            | A role escalation could cross identity, usage, admin, or deletion boundaries | Separate non-owner roles, procedure-only ingest, constraints, capability-matrix tests                          |
| Edge and origin-proof keys                        | Direct-origin access could bypass WAF and request shaping                    | Body-bound short-lived proofs, replay rejection, rotation, Cloudflare-only public ingress                      |
| Admin, deploy, and signing authority              | Compromise can affect every user or official artifact                        | Separate identities, passkey step-up, protected environments, reasons, external audit                          |
| Deletion state and tombstones                     | Restore or job failure must not resurrect a deleted profile                  | Immediate hide/revoke, idempotent purge, bounded tombstone, deletion replay after restore                      |
| Audit evidence                                    | Incident response needs attributable decisions without exposing usage data   | Append-only external records, redaction, access control, bounded retention                                     |

Prompts, conversations, repository contents, Codex credentials, API keys, account email, and
arbitrary user files are prohibited data, not assets the service may collect.

## Threat Model, Trust Boundaries, and Assumptions

### Actors and attacker capabilities

- A public visitor can send arbitrary browser and HTTP input, scrape public data, automate requests,
  and attempt client-side attacks.
- An enrolled user can control their browser, create multiple GitHub accounts when upstream permits,
  declare multiple sources, alter a local connector, and submit fabricated Community usage.
- A network attacker can delay, replay, reorder, or modify traffic unless transport and application
  integrity controls stop them.
- A local attacker may control the Codex executable path, App Server output, environment, working
  directory, filesystem links, or scheduled-task context. A computer owner may control all of them.
- A credential attacker may obtain a session, recovery code, device key, maintainer token, or
  signing capability and attempt to expand its authority.
- A contributor can submit malicious source, scripts, lockfiles, workflows, fixtures, filenames,
  generated output, or dependency changes through a pull request.
- A supply-chain attacker may compromise an upstream package, action, container, toolchain, Codex
  release, installer path, or update channel.
- A malicious or compromised maintainer/operator may misuse repository, database, deployment,
  moderation, or release access.

### Trust boundaries

| ID    | Boundary                                                | Untrusted side                                                        | Trusted decision point                                                                 | Principal failure modes                                                                    |
| ----- | ------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| TB-01 | Visitor browser to Cloudflare edge                      | Browser state, URL, headers, body, cookies, automation                | Edge policy and Web/Auth validation                                                    | XSS, CSRF, IDOR, cache confusion, redirects, scraping, denial of service                   |
| TB-02 | GitHub OAuth, recovery secret, and WebAuthn to Web/Auth | Callback, recovery selector/secret, browser ceremony, upstream errors | Exact OAuth binding, bounded Argon2id verification, and RP/origin/challenge validation | Login CSRF, account oracle, offline guessing, replay, fixation, recovery or step-up bypass |
| TB-03 | Local Codex App Server to connector                     | Process path, JSONL framing, JSON values, stderr, timing              | Pinned compatibility adapter and strict field allowlist                                | Prompt or credential exfiltration, parser abuse, process escape, resource exhaustion       |
| TB-04 | Local key store and scheduler to connector              | Host filesystem, environment, job definition, local user              | OS credential API, fixed executable/arguments, path ownership checks                   | Key theft, shell injection, binary substitution, persistence abuse                         |
| TB-05 | Connector to public edge                                | Entire payload except possession proof                                | Edge proof plus ingest signature, source, schema, nonce, and idempotency validation    | Forgery, replay, cross-source submission, oversized input, request floods                  |
| TB-06 | Cloudflare edge to Railway origins                      | Forwarded headers and edge proof                                      | Origin verifier before application routing                                             | Direct-origin bypass, stale proof, body substitution, spoofed client IP                    |
| TB-07 | Web/Auth, Ingest, and Jobs to PostgreSQL                | Service queries and compromised runtime role                          | Adapter session probes plus database grants, procedures, constraints, and transactions | SQL injection, role escalation, cross-profile writes, finalized-season mutation            |
| TB-08 | User session to admin surface                           | Normal identity and browser claims                                    | Separate origin, Cloudflare Access, admin policy, fresh passkey, audit                 | Privilege escalation, confused deputy, shared-account actions                              |
| TB-09 | Source and dependencies to CI                           | Pull-request tree and upstream artifacts                              | Secretless read-only CI, protected review, pinned inputs                               | Workflow injection, credential theft, dependency substitution, artifact publication        |
| TB-10 | Protected source to release consumers                   | Build runner, signing environment, downloadable artifact              | Protected release workflow, signatures, checksums, SBOM, provenance                    | Official malware, key compromise, unsigned substitution, rollback failure                  |
| TB-11 | Primary data to backups, logs, support, and deletion    | Copies and derived operational records                                | Retention, access, redaction, purge, restore replay                                    | Data over-retention, resurrection, support disclosure, unaudited access                    |

### Input ownership

Attacker-controlled input includes every public request, OAuth callback parameter, WebAuthn
response, recovery selector or secret, handle, source choice, device label, connector payload,
timestamp, nonce, idempotency key, Codex process output, pull-request file, dependency update, and
public support submission. Signatures authenticate a registered key; they do not make signed content
honest.

Operator-controlled input includes deployment configuration, private thresholds, origin keys,
database credentials, kill switches, backup policy, retention values, and incident actions. It must
be schema-validated, least-privileged, audited, and kept out of Git.

Developer-controlled input includes contracts, migrations, scoring versions, CarRecipe enums,
workflow definitions, dependencies, generated artifacts, and release metadata. It becomes trusted
only after deterministic checks, review, and protected merge; repository authorship alone is not a
security boundary.

### Assumptions and accepted limitations

- A computer owner can fabricate Community usage or duplicate one real Codex account across declared
  sources. This is an accepted integrity limitation, not proof of a connector vulnerability.
- Community results remain visibly self-reported and cannot grant money, prizes, access,
  authorization, moderation power, or another valuable benefit.
- The Verified league remains server-disabled and has no client-writable ingestion path until a
  separately reviewed server-verifiable OpenAI contract exists.
- GitHub authenticates the upstream GitHub identity, but Vibe Racing still validates OAuth state and
  binding. GitHub identity does not prove unique human identity or unique Codex ownership.
- Platform TLS, Cloudflare, Railway, PostgreSQL, operating-system credential stores, GitHub, and
  supported Codex releases are dependencies, not absolute trust. Compromise, outage, and contract
  drift need detection, rotation, fail-closed behavior, and recovery plans.
- No Codex version is supported until version-specific generated schemas and synthetic compatibility
  fixtures pass. The connector foundation already fixes the default local stdio JSONL handshake,
  omits experimental API capability, rejects unknown fields, and proves a bounded one-shot
  handshake/account/usage child lifecycle with a synthetic executable. Exact Windows x86_64 artifact
  admission and one signed upload path now exist as development code; clean-machine
  selected-artifact/account privacy evidence, other platforms, release provenance, and operational
  account/usage remain blocked.
- Production anti-abuse thresholds and incident evidence remain private. Public code still defines
  safe maximum shapes, state machines, and tests so secrecy is never the only control.

The normative objectives are the [security invariants](../architecture/SECURITY_INVARIANTS.md).
Changing one requires an ADR, updated threat and abuse analysis, negative tests, security review,
and migration or rollback where applicable.

## Attack Surface, Mitigations, and Attacker Stories

### Surface map

| Surface                             | Realistic attacker story                                                                                   | Required mitigations                                                                                                             | Current status                                                                                                               |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Public race and profiles            | A visitor injects markup through a handle, enumerates profiles, or infers exact work hours                 | Plain-text bounded names, CSP, public-field allowlist, immediate hide, rounded freshness, rate and cache policy                  | Visible route/fallback and exact-session hide/publish tested; cache, real freshness, rate, live integration planned          |
| OAuth, sessions, passkeys, recovery | An attacker binds a victim callback, enumerates or replays recovery, fixes a session, or skips step-up     | OAuth binding, secure cookies, Argon2id, generic bounded lookup, restricted authority, origin/RP checks, exact provenance/revoke | Enrollment/login/passkey controls, rotation, and local recovery use tested; edge policy, cleanup, notification, live planned |
| Pairing and device management       | A code guess or stolen session binds an attacker's key; a device attempts profile administration           | Short-lived split codes, fresh passkey, source-bound key, deny-by-default device scope, pause, unlink, revoke, and rotate        | DB, approval, lifecycle, exact HTTP/native client, proof/activation tested; live/cross-platform/edge evidence planned        |
| Connector process boundary          | Hostile JSONL or binary substitution extracts local data, hangs, floods output, or executes a command      | Exact binary discovery, ownership and link checks, bounded child/output/time, sanitized environment, no shell, strict adapter    | Protocol, supervisor, exact Windows candidate admission tested; discovery, other platforms, support planned                  |
| Connector request protocol          | A client changes source, body, time, or nonce after signing, or replays a valid request                    | Canonical signature, body hash, device/source binding, server receipt time, replay and idempotency stores                        | Local signer/vector, verifier, replay stores, application, and HTTP tested; operational/live planned                         |
| Edge and origin                     | A client reaches Railway directly or forges forwarded IP/proof headers                                     | Cloudflare-only ingress, short-lived method/path/body proof, direct-origin deny, trusted header chain, rotation                  | Local verifier/config/replay/server tested; edge injection, trusted route, direct-origin planned                             |
| Ingest and database                 | Malformed input writes derived fields, crosses a profile, injects SQL, or exhausts connections             | Strict versioned schema, bounded bodies, fixed adapter, stored procedure, non-owner role, constraints, deadlines, backpressure   | Local HTTP/verifier/adapter/composer and ingest/retention SQL tested; live operations planned                                |
| Scoring and jobs                    | Source multiplication bypasses a cap, a race changes finalized scores, or a failed job double-applies work | Source/date dedup, profile cap after aggregation, versioned formula, idempotent jobs, server deadlines, immutable seasons        | SQL and local one-shot runner tested; live login, scheduler, correction planned                                              |
| CarRecipe and assets                | A proposal smuggles a URL, markup, executable value, copyrighted binary, or nondeterministic output        | Enum-only schema, project-owned assets, preview and approval, provenance, deterministic snapshots                                | Planned                                                                                                                      |
| Admin and operations                | A user session reaches admin, an operator acts without reason, or logs reveal usage                        | Separate origin/policy, passkey step-up, least privilege, external audit, redaction, kill switches                               | Invite role/reason/reference implemented; hosted controls planned                                                            |
| Deletion and retention              | Partial failure or backup restore resurrects a profile or keeps device authority alive                     | Immediate hide/revoke, idempotent purge, bounded tombstone, backup expiry, deletion replay after restore                         | Exact-handle/fresh-passkey request plus DB hide/revoke/queue implemented; cache/purge/restore planned                        |
| Pull-request CI                     | A fork changes a workflow or package to steal a token or publish an artifact                               | Read-only secretless CI, no privileged environment, pinned inputs, no persisted checkout credentials, protected review           | Implemented locally; hosted controls pending                                                                                 |
| Release and dependencies            | A compromised dependency or runner produces an official malicious connector                                | Exact locks, quarantine, review, isolated trusted build, signatures, SBOM, provenance, clean-machine verification                | Dependency baseline implemented; release path planned                                                                        |
| Public repository                   | A maintainer accidentally commits a credential, personal record, local path, or private incident detail    | Public-file scan, exact staged-blob scan, synthetic-only policy, manual diff and history review                                  | Implemented locally; history and hosted scans pending                                                                        |

### High-value attacker stories

1. **Official connector substitution.** An attacker changes a build input or steals signing
   authority so users execute credential-stealing software. Release credentials must never enter
   pull-request CI, releases build only protected revisions, and users receive independent signature
   and checksum verification.
2. **Profile takeover and durable device binding.** An attacker exploits OAuth, session, recovery,
   or WebAuthn handling, then adds their device. Device approval and security changes require a
   fresh, transaction-bound passkey step-up with exact credential provenance; adding a device never
   follows from GitHub membership alone. Removing a passkey closes its sessions and pending
   approvals. One verified recovery code creates only a short-lived replacement-passkey authority,
   never a normal session. Code rotation and completion serialize against old-code start and
   old-passkey login; a session is minted only after the replacement credential exists.
3. **Cross-source signed write.** A stolen or malicious device key changes `sourceId` and submits
   for another source. The local kernel binds method, path, exact-body digest and therefore source,
   device, nonce, timestamp, and idempotency key under strict Ed25519 verification, then compares
   the minimal lookup source. The database independently checks the device/source relation. One
   signed synthetic request now proves the local verifier-to-adapter ordering and closed
   acknowledgement through a mock pool; the isolated database separately proves the procedures. A
   local HTTP factory preserves the signed bytes/header sequence and revalidates that decision, but
   no working deployment login/TLS connection or live end-to-end path exists.
4. **Local data overcollection.** A connector update starts reading prompts, account email,
   repositories, credentials, or broad App Server events. The candidate `0.144.5` adapter has only
   two fixed requests, closes every response object, validates then discards email/plan/summary,
   exposes only bounded daily entries, and fails terminally on drift. The one-shot supervisor clears
   ambient environment, uses fixed local pipes/arguments, bounds output and time, discards stderr,
   checks late output, and gates success on reap. Its launch capability has no public constructor;
   the private Windows command can construct it only after canonical-path, exact-size/digest, and
   held-handle admission. This still cannot become a support claim. The composer separately consumes
   only the bounded parser output plus an inaccessible reviewed context, revalidates every body and
   unsigned device-header input it owns, and fixes exact JSON/digest/device-message bytes shared
   with Ingest. The isolated signer removes public unsigned access, checks that its inaccessible
   one-use key capability names the exact request device, signs only that message, and returns the
   same body plus five header values. Drop paths zero the private byte buffers and key material,
   while errors remain non-reflective. The pairing command owns OS entropy, native key custody,
   exact HTTPS/loopback start/poll egress, bounded retries, and non-reflective output. The separate
   sync command creates fresh context from only the active record and sends one fixed-path request
   with five exact device headers, no proxy/redirect/retry, and a closed acknowledgement. Automatic
   discovery, cross-platform execution, real-account privacy evidence, credential
   rotation/uninstall, packaging, and release review remain required.
5. **Direct-origin and header spoofing.** A client avoids edge shaping or supplies a false
   forwarding address. The local kernel verifies one fresh, replay-consumed HMAC proof bound to key
   ID, method, path, exact body, time, and nonce before JSON or device work. A protected local
   reader now requires one exact primary and at most one complete distinct rotation pair without a
   default or returned key container. Revision 0012 persistently consumes only the key-bound digest
   and expiry through an Ingest-only atomic function; observed contention yields one fresh result,
   and Jobs can delete bounded expired tuples. A real Cloudflare signer, secret-manager/edge key
   injection, Railway direct-origin denial, trusted proxy chain, and production cleanup scheduling
   remain required. The local HTTP boundary deliberately trusts no proxy/forwarded identity, and the
   transport-free application binds the same replay/device/submission adapter and maps only generic
   public decisions.
6. **Season race and cap bypass.** Parallel source updates or jobs double count, exceed the daily
   profile cap, or mutate a finalized season. Current SQL proves unique source/day state, one
   transactional profile cap, immutable formula/season binding, serialized idempotent open-season
   refresh, server-receipt closure, terminal triggers, and a finalization-versus-late-Ingest race. A
   bounded Web-only SQL projection filters active profiles and returns only public score fields; a
   response-only schema fixes the Community trust label and caps one page at 32. A server-only
   mapper rejects unexpected columns, malformed values, and incoherent season/rank ordering before
   that contract can be serialized. A bounded server-only database adapter now verifies one
   least-privileged Web login/session on every checkout and issues only the fixed parameterized
   top-32 call. A closed Monday query and local GET now enforce the path/body/media grammar,
   no-store/same-origin posture, four-request no-queue admission, adapter deadline policy, generic
   error translation, and bounded response matrix. The visible home race requests the
   server-selected current week without credentials, accepts only closed public fields, and keeps a
   labeled synthetic fallback on error. A local one-shot Jobs runner now validates one fixed
   ingest/pairing cleanup or canonical-season refresh/finalization command, probes its exact
   least-privileged login/session before one prepared function call, holds one client through
   settlement, and emits no input or database detail. Live deployment login/TLS and edge evidence, a
   Jobs scheduler, audited correction authority, client-rate policy, and capacity evidence are still
   required before publishing durable results.
7. **Deletion resurrection.** A retry, partial outage, or restore brings back public data or device
   access. Visibility and authority are revoked synchronously, purge is idempotent, and restore
   procedures replay deletion markers before service resumes.
8. **Malicious contribution.** A pull request modifies tests and workflows to appear safe while
   extracting credentials. PR execution remains disposable and secretless; protected review and
   CODEOWNERS, not self-modifiable tests alone, authorize merge and later release.

### Lower-value and out-of-scope stories

- Fabricating one's own Community values, declaring the same Codex account several times, or sharing
  a computer is expected client dishonesty. It becomes reportable if it bypasses profile caps,
  crosses another profile, reaches Verified data, gains privilege, or creates material service harm.
- Losing access to a GitHub or Codex account through an upstream compromise is not caused by this
  repository. Mishandling the callback, stored token, or recovery consequence inside Vibe Racing is
  in scope.
- Scraping fields intentionally public is not a confidentiality breach by itself. Bypassing a hide
  or deletion state, recovering private fields, defeating documented rate controls, or deriving an
  exact private schedule is in scope.
- A denial of service that requires full control of the operator's Railway, Cloudflare, GitHub, or
  database account is primarily an operational account-compromise scenario. Missing least privilege,
  rotation, audit, or recovery controls can still make its project impact reportable.
- A visual rank disagreement that grants no privilege and corrects at the next normal refresh is
  lower severity than persistent cross-profile, finalized-season, or privacy impact.

## Severity Calibration (Critical, High, Medium, Low)

Severity uses realistic prerequisites, affected users, confidentiality/integrity/availability,
persistence, recoverability, and the Community league's deliberately low value. A score-only issue
does not inherit the severity of an authorization or release compromise.

### Critical

- Compromise of the official connector signing/release path that can deliver arbitrary code to a
  substantial part of the user base without an additional uncommon prerequisite.
- Unauthenticated remote code execution or unrestricted production database ownership across all
  profiles, credentials, and deletion state.
- A systemic authentication or admin bypass that grants broad production control and is immediately
  exploitable.

A Verified-league manipulation is not Critical while that league is disabled and grants nothing.
Severity rises if a future feature turns ranking into money, authorization, or another valuable
benefit; that product change requires a new threat-model review before enablement.

### High

- Account takeover through OAuth, session, passkey, or recovery flaws, especially when an attacker
  can bind a durable device or delete the victim.
- Device signature or authorization failure that permits cross-profile/source writes or profile
  administration.
- Connector behavior that transmits prompts, repository contents, Codex credentials, API keys, or
  account email.
- Direct-origin, SQL, role, or job-state bypass that enables material unauthorized writes,
  finalized-season mutation, or broad private usage disclosure.
- Release or CI credential exposure that creates a practical path to an official artifact or
  production deployment.
- Deletion failure that leaves revoked authority active or systematically resurrects deleted users.

### Medium

- Stored or reflected browser injection with meaningful same-origin action but limited reach or
  strong user interaction requirements.
- Disclosure of one user's private usage buckets or exact schedule without credential compromise.
- Persistent rank manipulation that bypasses server caps or source boundaries but still grants no
  privilege or reward.
- Repeatable resource exhaustion against an expensive endpoint that causes bounded outage without
  broader compromise.
- Audit gaps that materially impede investigation of a sensitive action but do not create that
  action by themselves.

### Low

- Short-lived presentation or ordering defects with no cross-profile write, private disclosure, or
  privilege consequence.
- Public-field scraping or enumeration that stays within the explicitly public contract and causes
  no demonstrated operational harm.
- Dependency, documentation, or hardening issues that require maintainer control and do not create a
  plausible path to a protected asset.
- Community self-report inaccuracies that remain inside the documented profile cap and are visible
  as unverified.

Severity is raised by low-privilege remote reachability, cross-tenant scope, stealth, persistence,
official distribution, irreversible deletion/privacy harm, or chaining into admin/release authority.
It is lowered by strong local prerequisites, explicit user confirmation, single-profile scope,
short-lived non-sensitive effects, reliable detection, and a tested recovery path. Lack of current
runtime code means this model identifies classes and gates; it does not assert a present
vulnerability.
