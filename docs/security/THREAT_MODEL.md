# Threat model

## Overview

Vibe Racing is intended to be an invite-only, English/Russian, pixel-art weekly leaderboard for
people who use Codex. A local connector will read a narrow usage response from a user-controlled
Codex App Server and submit bounded daily values. The public product will rank participating Vibe
Racing profiles in a self-reported Community league.

This is a repository-scoped design threat model. The current tree contains public repository policy,
toolchain, CI, documentation, and local PostgreSQL foundations; it does not yet contain a runtime
web service, ingest service, jobs, connector, deployment, or production data. Controls below are
marked **implemented** only when executable evidence exists in
[implementation status](../IMPLEMENTATION_STATUS.md). Other controls are release requirements, not
security claims about the current tree.

### Assets and security objectives

| Asset or objective                                | Why it matters                                                               | Required protection                                                                                |
| ------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Public project and release integrity              | Users may execute connector binaries and trust deployment artifacts          | Protected revisions, review, signed artifacts, checksums, SBOM, provenance, rollback               |
| Connector device private keys                     | A stolen key can submit as its bound Community source                        | OS credential store, source binding, revocation, rotation, no plaintext fallback                   |
| Sessions, passkeys, recovery, and invites         | They control profile identity and security-sensitive actions                 | Exact origins, one-time challenges, step-up, hashed tokens, fixation and replay defenses           |
| GitHub identity binding                           | It enforces one Vibe Racing profile per resolved GitHub user ID              | Minimal OAuth scope, state, PKCE, exact redirects, token disposal, database uniqueness             |
| Private usage buckets and exact timestamps        | They can reveal work volume and schedule                                     | Data minimization, private-by-default access, bounded retention, log redaction, deletion           |
| Public handle, score, rank, source count, and car | They affect reputation even though they grant no privilege                   | Server-derived fields, plain-text rendering, bounded recipes, clear Community label                |
| Season and scoring integrity                      | Finalized public results must not be silently rewritten                      | Versioned formula, profile-level cap, server deadlines, immutable finalization, audited correction |
| Database roles and migration ownership            | A role escalation could cross identity, usage, admin, or deletion boundaries | Separate non-owner roles, procedure-only ingest, constraints, capability-matrix tests              |
| Edge and origin-proof keys                        | Direct-origin access could bypass WAF and request shaping                    | Body-bound short-lived proofs, replay rejection, rotation, Cloudflare-only public ingress          |
| Admin, deploy, and signing authority              | Compromise can affect every user or official artifact                        | Separate identities, passkey step-up, protected environments, reasons, external audit              |
| Deletion state and tombstones                     | Restore or job failure must not resurrect a deleted profile                  | Immediate hide/revoke, idempotent purge, bounded tombstone, deletion replay after restore          |
| Audit evidence                                    | Incident response needs attributable decisions without exposing usage data   | Append-only external records, redaction, access control, bounded retention                         |

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

| ID    | Boundary                                             | Untrusted side                                           | Trusted decision point                                                              | Principal failure modes                                                              |
| ----- | ---------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| TB-01 | Visitor browser to Cloudflare edge                   | Browser state, URL, headers, body, cookies, automation   | Edge policy and Web/Auth validation                                                 | XSS, CSRF, IDOR, cache confusion, redirects, scraping, denial of service             |
| TB-02 | GitHub OAuth and WebAuthn ceremonies to Web/Auth     | Callback parameters, browser ceremony, upstream errors   | Exact redirect/state/PKCE and RP/origin/challenge validation                        | Login CSRF, account misbinding, replay, session fixation, step-up bypass             |
| TB-03 | Local Codex App Server to connector                  | Process path, JSONL framing, JSON values, stderr, timing | Pinned compatibility adapter and strict field allowlist                             | Prompt or credential exfiltration, parser abuse, process escape, resource exhaustion |
| TB-04 | Local key store and scheduler to connector           | Host filesystem, environment, job definition, local user | OS credential API, fixed executable/arguments, path ownership checks                | Key theft, shell injection, binary substitution, persistence abuse                   |
| TB-05 | Connector to public edge                             | Entire payload except possession proof                   | Edge proof plus ingest signature, source, schema, nonce, and idempotency validation | Forgery, replay, cross-source submission, oversized input, request floods            |
| TB-06 | Cloudflare edge to Railway origins                   | Forwarded headers and edge proof                         | Origin verifier before application routing                                          | Direct-origin bypass, stale proof, body substitution, spoofed client IP              |
| TB-07 | Web/Auth, Ingest, and Jobs to PostgreSQL             | Service queries and compromised runtime role             | Database grants, procedures, constraints, transaction boundaries                    | SQL injection, role escalation, cross-profile writes, finalized-season mutation      |
| TB-08 | User session to admin surface                        | Normal identity and browser claims                       | Separate origin, Cloudflare Access, admin policy, fresh passkey, audit              | Privilege escalation, confused deputy, shared-account actions                        |
| TB-09 | Source and dependencies to CI                        | Pull-request tree and upstream artifacts                 | Secretless read-only CI, protected review, pinned inputs                            | Workflow injection, credential theft, dependency substitution, artifact publication  |
| TB-10 | Protected source to release consumers                | Build runner, signing environment, downloadable artifact | Protected release workflow, signatures, checksums, SBOM, provenance                 | Official malware, key compromise, unsigned substitution, rollback failure            |
| TB-11 | Primary data to backups, logs, support, and deletion | Copies and derived operational records                   | Retention, access, redaction, purge, restore replay                                 | Data over-retention, resurrection, support disclosure, unaudited access              |

### Input ownership

Attacker-controlled input includes every public request, OAuth callback parameter, WebAuthn
response, handle, source choice, device label, connector payload, timestamp, nonce, idempotency key,
Codex process output, pull-request file, dependency update, and public support submission.
Signatures authenticate a registered key; they do not make signed content honest.

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
  fixtures pass. The connector will use the default local stdio transport, omit experimental API
  capability, and reject unknown methods and fields.
- Production anti-abuse thresholds and incident evidence remain private. Public code still defines
  safe maximum shapes, state machines, and tests so secrecy is never the only control.

The normative objectives are the [security invariants](../architecture/SECURITY_INVARIANTS.md).
Changing one requires an ADR, updated threat and abuse analysis, negative tests, security review,
and migration or rollback where applicable.

## Attack Surface, Mitigations, and Attacker Stories

### Surface map

| Surface                             | Realistic attacker story                                                                                   | Required mitigations                                                                                                          | Current status                                                    |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Public race and profiles            | A visitor injects markup through a handle, enumerates profiles, or infers exact work hours                 | Plain-text bounded names, CSP, public-field allowlist, rounded freshness, rate and cache policy                               | Planned                                                           |
| OAuth, sessions, passkeys, recovery | An attacker binds a victim callback, replays a challenge, fixes a session, or skips step-up                | State, PKCE, exact redirect, token disposal, secure cookies, origin/RP checks, one-time transaction-bound challenges          | Session/challenge DB slice implemented; app/recovery planned      |
| Pairing and device management       | A code guess or stolen session binds an attacker's key; a device attempts profile administration           | Short-lived split codes, fresh passkey, source-bound key, deny-by-default device scope, revoke and rotate                     | Pairing DB procedures tested; app crypto/rate/revoke planned      |
| Connector process boundary          | Hostile JSONL or binary substitution extracts local data, hangs, floods output, or executes a command      | Exact binary discovery, ownership and link checks, bounded child/output/time, sanitized environment, no shell, strict adapter | Planned                                                           |
| Connector request protocol          | A client changes source, body, time, or nonce after signing, or replays a valid request                    | Canonical signature, body hash, device/source binding, server receipt time, replay and idempotency stores                     | Planned                                                           |
| Edge and origin                     | A client reaches Railway directly or forges forwarded IP/proof headers                                     | Cloudflare-only ingress, short-lived method/path/body proof, direct-origin deny, trusted header chain, rotation               | Planned                                                           |
| Ingest and database                 | Malformed input writes derived fields, crosses a profile, injects SQL, or exhausts connections             | Strict versioned schema, bounded bodies, stored procedure, non-owner role, constraints, deadlines, backpressure               | Planned                                                           |
| Scoring and jobs                    | Source multiplication bypasses a cap, a race changes finalized scores, or a failed job double-applies work | Source/date dedup, profile cap after aggregation, versioned formula, idempotent jobs, server deadlines, immutable seasons     | Planned                                                           |
| CarRecipe and assets                | A proposal smuggles a URL, markup, executable value, copyrighted binary, or nondeterministic output        | Enum-only schema, project-owned assets, preview and approval, provenance, deterministic snapshots                             | Planned                                                           |
| Admin and operations                | A user session reaches admin, an operator acts without reason, or logs reveal usage                        | Separate origin/policy, passkey step-up, least privilege, external audit, redaction, kill switches                            | Invite role/reason/reference implemented; hosted controls planned |
| Deletion and retention              | Partial failure or backup restore resurrects a profile or keeps device authority alive                     | Immediate hide/revoke, idempotent purge, bounded tombstone, backup expiry, deletion replay after restore                      | DB hide/revoke/queue implemented; purge/restore planned           |
| Pull-request CI                     | A fork changes a workflow or package to steal a token or publish an artifact                               | Read-only secretless CI, no privileged environment, pinned inputs, no persisted checkout credentials, protected review        | Implemented locally; hosted controls pending                      |
| Release and dependencies            | A compromised dependency or runner produces an official malicious connector                                | Exact locks, quarantine, review, isolated trusted build, signatures, SBOM, provenance, clean-machine verification             | Dependency baseline implemented; release path planned             |
| Public repository                   | A maintainer accidentally commits a credential, personal record, local path, or private incident detail    | Public-file scan, exact staged-blob scan, synthetic-only policy, manual diff and history review                               | Implemented locally; history and hosted scans pending             |

### High-value attacker stories

1. **Official connector substitution.** An attacker changes a build input or steals signing
   authority so users execute credential-stealing software. Release credentials must never enter
   pull-request CI, releases build only protected revisions, and users receive independent signature
   and checksum verification.
2. **Profile takeover and durable device binding.** An attacker exploits OAuth, session, recovery,
   or WebAuthn handling, then adds their device. Device approval and security changes require a
   fresh, transaction-bound passkey step-up; adding a device never follows from GitHub membership
   alone.
3. **Cross-source signed write.** A stolen or malicious device key changes `sourceId` and submits
   for another source. Canonical signing binds method, path, body, device, source, nonce, timestamp,
   and idempotency key; the database independently checks the device/source relation.
4. **Local data overcollection.** A connector update starts reading prompts, account email,
   repositories, credentials, or broad App Server events. The adapter allowlists version-pinned
   stable response fields, egress schemas contain no such fields, and fixture inspection and release
   review fail closed on drift.
5. **Direct-origin and header spoofing.** A client avoids edge shaping or supplies a false
   forwarding address. Railway validates a fresh body-bound edge proof before routing and trusts
   forwarding headers only within that authenticated chain.
6. **Season race and cap bypass.** Parallel source updates or jobs double count, exceed the daily
   profile cap, or mutate a finalized season. Database uniqueness, transactional aggregation,
   idempotent jobs, server receipt time, and finalized-state constraints are required together.
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
