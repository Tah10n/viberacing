# Threat model

## Overview

Vibe Racing is intended to be an invite-only, English/Russian, pixel-art weekly leaderboard for
people who use Codex. A local connector will read a narrow usage response from a user-controlled
Codex App Server and submit bounded daily values. The public product will rank participating Vibe
Racing profiles in a self-reported Community league.

This is a repository-scoped design threat model. The current tree contains public repository policy,
toolchain, CI, documentation, local PostgreSQL identity/passkey/recovery foundations, local Next.js
public score/race/status routes, one local invite/OAuth/initial-passkey enrollment and
returning-passkey login plus private passkey/source/device inventory, source
pause/reactivation/unlink, device/passkey revocation, fresh-passkey recovery-code rotation, and
fresh-passkey profile-deletion-request slice plus one-time recovery-code replacement-passkey sign-in
with encrypted cookies and logout, one local one-shot Jobs runner with ten bounded cleanup
capabilities, one bounded pairing approval-provenance redaction, one fixed pairing-rate-window
reset, and primary profile purge, plus a synthetic disposable PostgreSQL integration for all fifteen
Jobs commands, plus local Community sync verification, PostgreSQL-adapter, transport-free
composition, and bounded Fastify HTTP boundaries; it does not yet contain an external audit sink,
Jobs scheduler, cache/backup/tombstone purge, restore replay, deployed Ingest service, operational
connector, deployment, or production data. A library-only Rust connector foundation now bounds and
validates the stable App Server initialization and candidate account/usage exchanges, then composes
them through a synthetic one-shot child supervisor and produces exact sync material behind a second
inaccessible reviewed context. An isolated one-use signer consumes that material only with a third
inaccessible device-bound key capability and returns a closed signed envelope. A separate
pending-key/challenge signer and pure Web verifier agree on an exact pairing-possession proof. A
Web/Auth start application generates bounded pending-transaction material, separate protected
poll/code verifiers, and one fixed database call. A second application composes protected keyed poll
lookup, strict proof, and exact atomic activation through the separately probed read-write pool with
local admission/timing. Between those boundaries, a local `/connect` flow performs
session-rate-limited pending-code lookup, exact device/fingerprint review, opaque new or active
existing source selection, and fresh-passkey atomic approval of that exact choice. Exact local
start/poll routes now add closed framing/contracts, shared four-call admission, and fixed
global/client-bucket PostgreSQL windows. The bounded Rust client generates and stores a pairing key
through the native OS credential store, signs the exact proof, persists activation before success
output, and can delete only the exact local origin/label record with an explicit warning that server
authority was not revoked. No Codex launch or sync-context capability has a public constructor. A
separate private Windows x86_64 development command can construct them only after active-record
review and exact artifact admission selected through bounded fixed-name `PATH` discovery or an
explicit path, then sends one fixed signed sync without retry or edge credentials. It cannot admit
another platform/version or create a support claim. A separate explicit `check-codex` command
performs only that admission without credential-store, process, account, persistence, or network
access; its result grants no later sync authority. A separate Windows release-profile smoke copies
only the repository-built `0.0.0` connector under a bounded temporary root, runs its exact help and
missing-candidate paths with cleared ambient environment, verifies digest/inventory stability, and
removes it. The secretless CI declaration uploads no artifact and is not a package or release path.
Its database-only Community ingest plus bounded ingest- and authentication-retention boundaries have
synthetic executable evidence. The kernel has raw-envelope, origin-proof, bounded-parser, contract,
and strict device-signature evidence; the adapter has configuration, fixed-query, role-probe,
mapper, and failure evidence with mock pools. A local server factory now has loopback framing and
injection evidence. A separate local host proves exact loopback/Railway listener declarations,
composition, bind, partial-startup cleanup, and bounded signal shutdown. One opt-in synthetic gate
now exercises signed accepted/duplicate/replay/revoke HTTP through that emitted host and a
disposable least-privileged PostgreSQL login with exact stored-state verification. It proves no live
HTTP edge, trusted external TLS route, deployment credential/TLS connection, real-user result, or
capacity. The public score/race/status routes have request/response, admission, production-build,
and visible browser-consumer/fallback evidence, while the Jobs runner has strict
command/config/pool/role/result evidence plus a synthetic CLI-to-PostgreSQL path with a
widened-login denial and exact-state checks. The identity slice has exact-origin/body/cookie,
state/PKCE, token minimization, initial-registration, returning-login, session-derived passkey
inventory, non-current-key revocation, backup-key addition, exact-handle profile-deletion request,
source inventory/pause/reactivation/unlink, and active-device revoke including hidden-profile
PostgreSQL evidence, fixed queries, admission, exact GitHub-only OAuth `form-action`, and EN/RU UI
evidence with injected dependencies. Raw source IDs stay server-only; source controls receive only a
15-minute encrypted token bound to the active session. None has a production database login, OAuth
app, authenticator, edge, scheduler, cache/backup purge, tombstone/restore replay, or network
deployment. Controls below are marked **implemented** only when executable evidence exists in
[implementation status](../IMPLEMENTATION_STATUS.md). Other controls are release requirements, not
security claims about the current tree.

### Assets and security objectives

| Asset or objective                                | Why it matters                                                               | Required protection                                                                                            |
| ------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Public project and release integrity              | Users may execute connector binaries and trust deployment artifacts          | Protected revisions, review, signed artifacts, checksums, SBOM, provenance, rollback                           |
| Connector device private keys                     | A stolen key can submit as its bound Community source                        | OS credential store, source binding, server revocation, bounded local removal, rotation, no plaintext fallback |
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

| ID    | Boundary                                                | Untrusted side                                                        | Trusted decision point                                                                        | Principal failure modes                                                                     |
| ----- | ------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| TB-01 | Visitor browser to Cloudflare edge                      | Browser state, URL, headers, body, cookies, automation                | Edge policy and Web/Auth validation                                                           | XSS, CSRF, IDOR, cache confusion, redirects, scraping, denial of service                    |
| TB-02 | GitHub OAuth, recovery secret, and WebAuthn to Web/Auth | Callback, recovery selector/secret, browser ceremony, upstream errors | Exact OAuth binding, bounded Argon2id verification, and RP/origin/challenge validation        | Login CSRF, account oracle, offline guessing, replay, fixation, recovery or step-up bypass  |
| TB-03 | Local Codex App Server to connector                     | Process path, JSONL framing, JSON values, stderr, timing              | Bounded exact-artifact selection, pinned adapter, strict field allowlist                      | Prompt or credential exfiltration, parser abuse, process escape, resource exhaustion        |
| TB-04 | Local key store and scheduler to connector              | Host filesystem, environment, job definition, local user              | OS credential API, exact local deletion, fixed executable/arguments, retained artifact handle | Key theft, shell injection, binary substitution, false revoke assumption, persistence abuse |
| TB-05 | Connector to public edge                                | Entire payload except possession proof                                | Edge proof plus ingest signature, source, schema, nonce, and idempotency validation           | Forgery, replay, cross-source submission, oversized input, request floods                   |
| TB-06 | Cloudflare edge to Railway origins                      | Forwarded headers and edge proof                                      | Origin verifier before application routing                                                    | Direct-origin bypass, stale proof, body substitution, spoofed client IP                     |
| TB-07 | Web/Auth, Ingest, and Jobs to PostgreSQL                | Service queries and compromised runtime role                          | Adapter session probes plus database grants, procedures, constraints, and transactions        | SQL injection, role escalation, cross-profile writes, finalized-season mutation             |
| TB-08 | User session to admin surface                           | Normal identity and browser claims                                    | Separate origin, Cloudflare Access, admin policy, fresh passkey, audit                        | Privilege escalation, confused deputy, shared-account actions                               |
| TB-09 | Source and dependencies to CI                           | Pull-request tree and upstream artifacts                              | Secretless read-only CI, protected review, pinned inputs                                      | Workflow injection, credential theft, dependency substitution, artifact publication         |
| TB-10 | Protected source to release consumers                   | Build runner, signing environment, downloadable artifact              | Protected release workflow, signatures, checksums, SBOM, provenance                           | Official malware, key compromise, unsigned substitution, rollback failure                   |
| TB-11 | Primary data to backups, logs, support, and deletion    | Copies and derived operational records                                | Retention, access, redaction, purge, restore replay                                           | Data over-retention, resurrection, support disclosure, unaudited access                     |

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

Repository-verification requests remain developer-controlled orchestration input. The checked local
skill may select only read-only repository-owned gates for the real Git scope, cannot edit, stage,
commit, install, access live/network services, publish, push, or deploy, and cannot turn a local
pass into trusted-source, hosted, or production evidence.

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
  handshake/account/usage child lifecycle with a synthetic executable. Bounded fixed-name Windows
  x86_64 candidate selection, exact artifact admission, and one signed upload path now exist as
  development code. A separate portable connector copy/removal smoke exists locally and in a
  secretless no-upload Windows workflow declaration; its hosted result, real package lifecycle,
  clean-machine selected-artifact/account privacy evidence, other platforms, release provenance, and
  operational account/usage remain blocked.
- Production anti-abuse thresholds and incident evidence remain private. Public code still defines
  safe maximum shapes, state machines, and tests so secrecy is never the only control.

The normative objectives are the [security invariants](../architecture/SECURITY_INVARIANTS.md).
Changing one requires an ADR, updated threat and abuse analysis, negative tests, security review,
and migration or rollback where applicable.

## Attack Surface, Mitigations, and Attacker Stories

### Surface map

| Surface                             | Realistic attacker story                                                                                                        | Required mitigations                                                                                                                                              | Current status                                                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Public race and profiles            | A visitor injects markup through a handle/car, enumerates profiles, or infers exact work hours                                  | Plain-text bounded names, enum-only recipe, CSP, public-field allowlist, immediate hide, rounded freshness, optional streak, rate/cache policy                    | Score/race/status routes, fallback, recipe/status rejection, and hide/publish tested; cache, rate, load, live integration planned        |
| OAuth, sessions, passkeys, recovery | An attacker binds a victim callback, enumerates or replays recovery, fixes a session, or skips step-up                          | OAuth binding, secure cookies, Argon2id, generic bounded lookup, restricted authority, origin/RP checks, exact provenance/revoke                                  | Enrollment/login/passkey controls, recovery and bounded expired/revoked-state cleanup tested; edge, schedule, notification, live planned |
| Pairing and device management       | A code guess or stolen session binds an attacker's key; a device attempts profile administration                                | Short-lived split codes, fresh passkey, source-bound key, deny-by-default device scope, pause, unlink, revoke, and rotate                                         | DB, approval, lifecycle, exact HTTP/native client, proof/activation tested; live/cross-platform/edge evidence planned                    |
| Connector process boundary          | Hostile JSONL or binary substitution extracts local data, hangs, floods output, or executes a command                           | Bounded fixed-name selection, exact artifact admission, retained handle, bounded child/output/time, sanitized environment, no shell, strict adapter               | Protocol, supervisor, synthetic Windows discovery/admission and process-free diagnostic tested; other platforms, support planned         |
| Connector request protocol          | A client changes source, body, time, or nonce after signing, or replays a valid request                                         | Canonical signature, body hash, device/source binding, server receipt time, replay and idempotency stores                                                         | Local signer/vector, verifier, replay stores, application, and HTTP tested; operational/live planned                                     |
| Edge and origin                     | A client reaches Railway directly or forges forwarded IP/proof headers                                                          | Cloudflare-only ingress, short-lived method/path/body proof, direct-origin deny, trusted header chain, rotation                                                   | Local verifier/config/replay/server/host tested; edge injection, trusted route, direct-origin planned                                    |
| Ingest and database                 | Malformed input writes derived fields, crosses a profile, injects SQL, or exhausts connections                                  | Strict versioned schema, bounded bodies, fixed adapter, stored procedure, non-owner role, constraints, deadlines, backpressure                                    | Full synthetic loopback HTTP-to-PostgreSQL plus isolated SQL tested; deployment operations planned                                       |
| Scoring and jobs                    | Source multiplication bypasses a cap, a race changes finalized scores, or a failed job double-applies work                      | Source/date dedup, profile cap after aggregation, versioned formula, idempotent jobs, server deadlines, immutable seasons                                         | SQL plus synthetic CLI-to-PostgreSQL cleanup/reset/purge/scoring tested; production login, scheduler, correction planned                 |
| CarRecipe and assets                | A proposal, agent shell, or public row smuggles a URL, command, markup, executable value, copyrighted binary, or nondeterminism | Enum-only schema, checked one-command agent reducer, signed proposal-only device authority, browser-only decision, exact public projection, provenance, snapshots | Local agent/browser/device/DB/public race and Jobs cleanup tested; schedule, release, edge, deployment pending                           |
| Admin and operations                | A user session reaches admin, an operator acts without reason, or logs reveal usage                                             | Separate origin/policy, passkey step-up, least privilege, external audit, redaction, kill switches                                                                | Invite role/reason/reference implemented; hosted controls planned                                                                        |
| Deletion and retention              | Partial failure or backup restore resurrects a profile or keeps device authority alive                                          | Immediate hide/revoke, idempotent purge, bounded tombstone, backup expiry, deletion replay after restore                                                          | Request, immediate lock-down, and bounded primary purge tested; cache/tombstone/backup/restore planned                                   |
| Pull-request CI                     | A fork changes a workflow or package to steal a token or publish an artifact                                                    | Read-only secretless CI, no privileged environment, pinned inputs, no persisted checkout credentials, fixed no-upload Windows smoke, protected review             | Workflow and policy implemented locally; hosted controls and Windows result pending                                                      |
| Release and dependencies            | A compromised dependency or runner produces an official malicious connector                                                     | Exact locks, quarantine, review, isolated trusted build, signatures, SBOM, provenance, clean-machine verification                                                 | Dependency baseline and untrusted portable smoke implemented; trusted release path planned                                               |
| Public repository                   | A maintainer accidentally commits a credential, personal record, local path, or private incident detail                         | Public-file scan, exact staged-blob scan, synthetic-only policy, manual diff and history review                                                                   | Tree, staged-blob, and reachable-history scans implemented locally; hosted scans pending                                                 |

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
   the minimal lookup source. The database independently checks the device/source relation. Focused
   tests prove verifier-to-adapter ordering through a mock pool and the isolated database proves the
   procedures. A separate synthetic loopback gate now carries independently signed requests through
   the emitted host and a disposable least-privileged PostgreSQL login, proving accepted, duplicate,
   persistent replay, revoke, closed response, and exact persistence behavior. No deployment
   credential/TLS connection, trusted edge path, real-user end-to-end result, or capacity evidence
   exists. The separate CarRecipe proposal message contains no source/profile identifier; its Web
   lookup and revision 0028 derive the profile only from the exact active device, recheck active
   source binding under lock, and can change only the pending enum recipe. Isolated tests cover
   key/device mismatch, inactive source, nonce replay, and no active-recipe mutation.
4. **Local data overcollection.** A connector update starts reading prompts, account email,
   repositories, credentials, or broad App Server events. The candidate `0.144.5` adapter has only
   two fixed requests, closes every response object, validates then discards email/plan/summary,
   exposes only bounded daily entries, and fails terminally on drift. The one-shot supervisor clears
   ambient environment, uses fixed local pipes/arguments, bounds output and time, discards stderr,
   checks late output, and gates success on reap. Its launch capability has no public constructor;
   the private Windows command can construct it only after active-record validation, bounded
   fixed-name discovery or an explicit path, canonical exact-size/digest admission, and a held
   handle. A separate explicitly invoked diagnostic reuses only that admission, releases the handle,
   and cannot open credential storage, launch the child, read an account, persist a result, or use a
   network; later sync repeats admission. This still cannot become a support claim. The composer
   separately consumes only the bounded parser output plus an inaccessible reviewed context,
   revalidates every body and unsigned device-header input it owns, and fixes exact
   JSON/digest/device-message bytes shared with Ingest. The isolated signer removes public unsigned
   access, checks that its inaccessible one-use key capability names the exact request device, signs
   only that message, and returns the same body plus five header values. Drop paths zero the private
   byte buffers and key material, while errors remain non-reflective. The pairing command owns OS
   entropy, native key custody, exact HTTPS/loopback start/poll egress, bounded retries, and
   non-reflective output. The separate sync command creates fresh context from only the active
   record and sends one fixed-path request with five exact device headers, no proxy/redirect/retry,
   and a closed acknowledgement. The separate `forget-local` command invokes only native deletion
   for one canonical origin/label, treats absence idempotently, and explicitly says server authority
   was not revoked. Cross-platform execution, real-account privacy evidence, credential rotation,
   safe release diagnostics, packaging, and release review remain required.
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
   public decisions. The separate host requires exact `0.0.0.0:$PORT` and an explicit `railway-edge`
   declaration in production, but treats that value only as startup policy: it does not authenticate
   the platform, forwarded headers, or request path. The full synthetic loopback gate proves that
   the persistent origin nonce rejects a repeated HTTP proof before a second write, but it does not
   prove edge signing or direct-origin denial.
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
   labeled synthetic fallback on error. A local one-shot Jobs runner now validates one of fifteen
   fixed authentication/audit-event/invite/CarRecipe-proposal/ingest/pairing/session/
   terminal-deletion-job/aged-revoked-passkey/aged-revoked-device cleanup, pairing
   approval-provenance redaction, fixed pairing-rate-window reset, primary-profile purge, or
   canonical-season refresh/finalization commands, probes its exact least-privileged login/session
   before one prepared function call, holds one client through settlement, and emits no input or
   database detail. A synthetic integration runs every emitted command against disposable
   PostgreSQL, rejects an extra-membership login before mutation, and checks exact stored state.
   Eligible expired invites are removed without deleting redeemed provenance; eligible expired
   sessions are removed only when no retained predecessor or pairing provenance requires the row;
   exact activated-pairing approval references are redacted only after 180 days while the device
   binding remains; revoked passkeys are removed only after 180 days and after every exact
   session/challenge/pairing reference is absent; minimized activated pairings and their exact
   revoked device keys are removed only after both are 180 days old and every approval,
   authorization-challenge, nonce, and raw-snapshot reference is absent; terminal deletion jobs are
   removed only after 30 days; database audit references are removed only after 180 days. An
   external append-only audit sink, production login/TLS and edge evidence, a Jobs scheduler,
   audited correction authority, trusted-edge rate policy, and capacity evidence are still required
   before publishing durable results.
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
