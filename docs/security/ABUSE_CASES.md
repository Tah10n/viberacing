# Abuse-case catalog

This catalog maps realistic attacker stories to the active
[security invariants](../architecture/SECURITY_INVARIANTS.md) and [threat model](THREAT_MODEL.md).
Controls are target requirements under ADR 0076; local evidence is not production evidence.

## Accepted-risk boundary

Community usage is self-reported and reward-free. A computer owner can fabricate totals for an
AgentAccount they legitimately control, and one person can operate several GitHub accounts. Those
facts are disclosed residual risks. Crossing profile/account authority, double-counting one
accounting domain, bypassing bounds, exposing prohibited data, or promoting Community to Verified is
not accepted.

## Identity, account, and accounting abuse

### VR-ABUSE-IDENTITY-DUPLICATION — Repeat OAuth creates more than one profile

- **Attacker:** A participant or an attacker controlling OAuth browser state.
- **Preconditions:** GitHub OAuth enrollment or returning login is reachable.
- **Abuse:** Replay callbacks, race create/open, or substitute mutable login/handle/email to create
  a second profile for one numeric GitHub ID.
- **Impact:** Duplicate public identities, split authority, inconsistent deletion, and avoidable
  Sybil amplification.
- **Controls:** Exact state plus PKCE, minimal-scope numeric-ID resolution, unique immutable
  `github_user_id`, and one atomic create-or-open procedure.
- **Detection:** Unique-constraint conflicts, bounded duplicate-attempt metrics, and synthetic
  parallel callback tests without raw GitHub fields.
- **Recovery:** Keep the single committed profile, invalidate continuations, review the
  implementation, and never auto-merge profile state.
- **Residual risk:** One person can create several independent GitHub accounts; the product does not
  claim one-human uniqueness.

### VR-ABUSE-ACCOUNT-DUPLICATION — One local account is attached as several AgentAccounts

- **Attacker:** An authenticated profile owner seeking a higher total.
- **Preconditions:** Discovery cannot or does not safely identify a stable account domain.
- **Abuse:** Create several same-provider AgentAccounts for the same logical provider account and
  sync the same usage through each.
- **Impact:** Duplicate account/day totals inflate weekly rank.
- **Controls:** Safe opaque provider-domain uniqueness when available; otherwise explicit
  create-or-attach review, scope metadata, conflict detection, and account-domain non-overlap tests.
- **Detection:** Pairing conflict outcomes, suspicious identical cumulative series, and aggregate
  duplicate-domain metrics without raw identity.
- **Recovery:** Quarantine conflicting accounts, preserve immutable observations, select one
  authoritative account, and rebuild affected snapshots through a reviewed correction path.
- **Residual risk:** Without a safe provider domain identifier, deliberate user deception cannot be
  eliminated; Community remains unverified.

### VR-ABUSE-DEVICE-MULTIPLICATION — Several devices double one AgentAccount

- **Attacker:** A participant with several installations or copied local authority.
- **Preconditions:** More than one active device is bound to one AgentAccount.
- **Abuse:** Submit the same cumulative date from every device and rely on per-device counting.
- **Impact:** Inflated account/day and weekly totals.
- **Controls:** Unique AgentAccount/date total, monotonic maximum semantics, account-scoped
  observations, device-independent aggregation, and long-lived idempotency.
- **Detection:** Multi-device same-date fixtures and bounded per-account/device observation metrics.
- **Recovery:** Revoke compromised devices, keep the exact accepted account/day value, and refresh
  the dirty season.
- **Residual risk:** An authorized device can still fabricate a larger Community cumulative total
  for its bound account.

### VR-ABUSE-ACCOUNT-OVERLAP — Provider-wide and included agent scopes both contribute

- **Attacker:** A participant or a buggy discovery registry.
- **Preconditions:** Two candidate accounting scopes overlap.
- **Abuse:** Activate a provider-wide aggregate together with AgentAccounts whose usage it already
  includes.
- **Impact:** Systematic double counting that appears legitimate across different provider labels.
- **Controls:** Immutable accounting-scope registry, explicit overlap matrix, batch conflict review,
  database exclusion of incompatible active scopes, and fail-closed unknown scope.
- **Detection:** Registry checker, activation conflict metrics, and exact overlapping-domain
  integration fixtures.
- **Recovery:** Pause or quarantine the conflicting account set, preserve evidence, correct registry
  rules through a new revision, and rebuild only affected snapshots.
- **Residual risk:** Provider documentation may omit hidden overlap; support requires continued
  schema/accounting review.

### VR-ABUSE-USAGE-FORGERY — Authorized device inflates Community totals

- **Attacker:** The computer owner, stolen device-key holder, or compromised local process.
- **Preconditions:** One active account-scoped device authority.
- **Abuse:** Modify local storage, reader output, or signed payload to report fabricated monotonic
  totals.
- **Impact:** Unfair Community rank for the controlled AgentAccount.
- **Controls:** Explicit self-reported label, no rewards, exact account scope, numeric/date bounds,
  anomaly quarantine, revocation, and separate Verified tier.
- **Detection:** Bounded anomaly metrics, unusual monotonic jumps, user-visible sync health, and
  report workflow without raw usage disclosure.
- **Recovery:** Pause/quarantine the account, revoke devices, correct through a reviewed immutable
  correction event if implemented, and rebuild snapshots.
- **Residual risk:** Device signatures do not prove honest local execution; fabrication within
  bounds remains an accepted Community limitation.

#### VR-ABUSE-USAGE-FORGERY — Fabricated or inflated token buckets

Historical ADR anchor. The active AgentAccount-scoped case is the structured case immediately above.

### VR-ABUSE-NUMERIC-PRECISION — Decimal values round, overflow, or parse differently

- **Attacker:** A malicious client or accidental language/runtime mismatch.
- **Preconditions:** A token total crosses JSON, TypeScript, and PostgreSQL.
- **Abuse:** Send exponent notation, leading zeros, fractions, negatives, overlong digits, or values
  unsafe for JavaScript `Number`.
- **Impact:** Wrong totals, rank inversion, collisions, denial of refresh, or signature
  disagreements.
- **Controls:** Canonical decimal digit strings, strict length/range validation, no JavaScript
  `Number`, canonical `bigint` mapping, and PostgreSQL `numeric(30,0)` checks.
- **Detection:** Boundary/property tests across contract, connector, Ingest, database, snapshot, and
  JSON serialization.
- **Recovery:** Reject before mutation, quarantine incompatible clients, and ship a new reviewed
  contract/revision rather than reinterpret stored values.
- **Residual risk:** Third-party tooling may display large decimal strings poorly; official clients
  must preserve them exactly.

### VR-ABUSE-DATE-WINDOW — Client clock or timezone opens future/backfill dates

- **Attacker:** A participant controlling client time, locale, timezone, and `observedAt`.
- **Preconditions:** Usage contains one or more dates near UTC boundaries.
- **Abuse:** Submit future dates, local-day labels, old dates, or fresh observation timestamps to
  reopen a finalized season.
- **Impact:** Preloaded future rank, unauthorized history, or mutation after finalization.
- **Controls:** Exact UTC date contract, PostgreSQL clock, server-owned bounded backfill, immutable
  finalization, and no eligibility decision from `observedAt`.
- **Detection:** Fixed-clock leap-day, Sunday/Monday, future, boundary, delayed-request, and
  finalized-season tests.
- **Recovery:** Reject atomically, leave replay/idempotency/usage unchanged, and correct only
  through a separately authorized path.
- **Residual risk:** A provider that cannot yield an honest UTC day cannot be supported for
  competitive accounting.

## Pairing, device, and connector abuse

Historical ADR section anchor. The active pairing, reader, device, and Ingest cases follow.

## Pairing, reader, device, and ingest abuse

### VR-ABUSE-PAIRING-BATCH-SWAP — Candidate decisions change after user review

- **Attacker:** A network attacker, compromised browser session, or malicious local connector.
- **Preconditions:** A pending discovery batch exists.
- **Abuse:** Reorder candidates, replace keys, switch create/attach/skip, target another profile's
  account, or replay an approved batch.
- **Impact:** Wrong account authority, cross-profile attachment, orphan pending keys, or
  unauthorized future sync.
- **Controls:** Installation possession proof, closed ordered manifest digest, encrypted
  session-bound continuation, provider-matched target control, one fresh passkey over the complete
  batch, and atomic terminal activation.
- **Detection:** Digest/provider/ownership/replay negative tests and bounded generic pairing
  outcomes.
- **Recovery:** Revoke the transaction and affected devices, delete pending local keys, preserve
  redacted audit evidence, and restart a new batch.
- **Residual risk:** A user can intentionally approve a misleading private label; labels are not
  authority or identity.

#### VR-ABUSE-SOURCE-DUPLICATION — Duplicate declared Codex sources

Historical ADR anchor. CodexSource no longer exists in the active model; use
VR-ABUSE-ACCOUNT-DUPLICATION and VR-ABUSE-ACCOUNT-OVERLAP.

### VR-ABUSE-PAIRING-CODE-GUESS — Fallback code is guessed or phished

- **Attacker:** An unauthenticated remote client or phishing site.
- **Preconditions:** Manual fallback code entry is enabled for a pending transaction.
- **Abuse:** Guess codes, enumerate transaction existence, or persuade a user to enter a code for
  another connector.
- **Impact:** Transaction disclosure or attempted key binding.
- **Controls:** High-entropy transaction plus 60-bit human code, keyed verifier,
  global/bucket/session attempt limits, bounded expiry, generic responses, displayed
  installation/candidate fingerprints, signed-in ownership, and required fresh passkey.
- **Detection:** Saturating aggregate attempt metrics and rate-limit outcomes without raw code or IP
  history.
- **Recovery:** Expire/revoke the transaction, delete pending keys, rotate affected installation
  authority if possession is uncertain, and create a fresh batch.
- **Residual risk:** A user may approve the wrong clearly displayed batch; UX must make origin,
  installation, providers, and account decisions explicit.

### VR-ABUSE-READER-EXFILTRATION — Mixed-content local storage leaks prohibited data

- **Attacker:** A hostile local file/database, compromised agent, or crafted fixture.
- **Preconditions:** A built-in reader opens mixed-content agent storage.
- **Abuse:** Place prompt, code, repository, path, email, API key, OAuth token, model, or raw record
  where a parser reflects or serializes it.
- **Impact:** Severe local privacy/credential disclosure to network, logs, errors, or diagnostics.
- **Controls:** Fixed safe roots, symlink/reparse/device/ADS denial, size/record/field bounds,
  duplicate-key-aware parsing, closed usage types, privacy-only output type, non-reflective errors,
  and sentinel end-to-end scans.
- **Detection:** Sentinel fixtures assert prohibited bytes are absent from outputs, signed bodies,
  stdout/stderr, logs, diagnostics, and retained test artifacts.
- **Recovery:** Disable the reader/provider, revoke exposed credentials through their owner, remove
  retained artifacts, fix the exact parser, and add a regression fixture before re-enablement.
- **Residual risk:** A novel provider schema may cause availability loss; unknown usage-bearing data
  fails closed rather than being guessed.

### VR-ABUSE-READER-PARTIAL — Parse failure emits an understated accepted total

- **Attacker:** A malformed/corrupt local record or incompatible provider upgrade.
- **Preconditions:** Some records in one AgentAccount/day parse and another required record fails.
- **Abuse:** Reader sums the successful subset and signs it as complete.
- **Impact:** Accepted total can later decrease semantics, mis-rank users, and hide schema drift.
- **Controls:** Whole AgentAccount/day invalidation for any required ambiguous usage-bearing record,
  closed recognized non-usage kinds, no partial signed request, and new accounting revision for
  semantic changes.
- **Detection:** Truncation, corruption, missing-dedup-record, duplicate-key, and mixed-version
  fixtures.
- **Recovery:** Keep the last accepted total, report one bounded local error, update the
  reader/revision, and resubmit only after the full day is valid.
- **Residual risk:** A provider can make historical data unreadable; the service does not estimate
  or synthesize missing tokens.

### VR-ABUSE-DEVICE-KEY-THEFT — Local key signs unauthorized account usage

- **Attacker:** Malware or another process running with the user's OS authority.
- **Preconditions:** The process can use or extract a native credential-store key.
- **Abuse:** Sign fabricated usage or keep signing after local connector compromise.
- **Impact:** Community inflation for the one bound AgentAccount.
- **Controls:** Separate key per AgentAccount/device, native credential store, no plaintext/export
  path, exact signature domain, server revoke, installation/device inventory, and no profile-level
  capability.
- **Detection:** User-visible device inventory, bounded last-success state, anomaly metrics, and
  impossible cross-account signature tests.
- **Recovery:** Revoke the device/installation, rotate by a fresh passkey-approved pairing batch,
  and explicitly forget the local credential.
- **Residual risk:** Credential-store use is not hardware-backed non-exportability; compromise can
  fabricate Community usage until revocation.

### VR-ABUSE-INGEST-ZERO-WRITE — Invalid proof reserves replay or usage state

- **Attacker:** Any remote client with malformed bytes, a valid Edge proof, or another device's
  material.
- **Preconditions:** The write route is enabled.
- **Abuse:** Cause origin nonce, device nonce, idempotency, observation, or outbox writes before
  full device verification.
- **Impact:** Denial of valid requests, persistent garbage, replay oracle, or partial ranking
  mutation.
- **Controls:** In-memory framing/HMAC/schema checks, non-mutating lookup, Ed25519 verification
  before writes, then one database transaction for both replay domains, idempotency, observation,
  totals, outbox, and audit.
- **Detection:** Exact zero-row oracles for every invalid class, injected transaction failures, and
  concurrent replay races.
- **Recovery:** Roll back the complete transaction, close the affected route if invariant evidence
  fails, repair forward, and rerun all zero-write cases.
- **Residual risk:** Edge rate counters may mutate before origin forwarding; they are separate
  ephemeral abuse state, not persistent Ingest state.

### VR-ABUSE-IDEMPOTENCY-COLLISION — Retry key returns the wrong committed result

- **Attacker:** A buggy or malicious device reusing IDs with changed bodies.
- **Preconditions:** One sync ID or nonce has previously succeeded.
- **Abuse:** Replay identical bytes, change the body under the same ID, or race several requests.
- **Impact:** Duplicate observation, hidden mutation, inconsistent acknowledgement, or denied
  legitimate retry.
- **Controls:** Body/account/device-bound idempotency digest, unique constraints, one atomic winner,
  exact replay outcome for identical content, and conflict for changed content.
- **Detection:** Same/different-body concurrency fixtures and stored-state equality oracles.
- **Recovery:** Preserve the first committed result, reject conflicting reuse, and require a fresh
  request ID without altering accepted totals.
- **Residual risk:** Lost acknowledgements require retained idempotency longer than transport retry
  windows.

## Public Web, authentication, and infrastructure abuse

### VR-ABUSE-SNAPSHOT-PARTIAL — Public readers observe an incomplete refresh

- **Attacker:** A fault, oversized synthetic profile, concurrent visibility change, or compromised
  Jobs process.
- **Preconditions:** Snapshot refresh is in progress or fails.
- **Abuse:** Publish some pages/top-32/profile summaries before the whole version is valid, or
  calculate live ranking on request.
- **Impact:** Inconsistent ranks, missing/duplicate rows, private leakage, cache poisoning, or
  public outage.
- **Controls:** Fixed bounded builder, complete-version validation, immutable pages, atomic
  publication pointer, last-good preservation, snapshot-only Web role, and no live ranking grant.
- **Detection:** Crash/failure injection, 10k-scale page invariants, pointer/page counts, query
  allowlist, and ETag tests.
- **Recovery:** Keep the previous version published, discard incomplete version through bounded Jobs
  cleanup, fix the cause, and refresh idempotently.
- **Residual risk:** Public freshness can lag until Jobs succeeds; the UI must show rounded snapshot
  freshness honestly.

### VR-ABUSE-PUBLIC-SCRAPE — Public rank reveals or amplifies work patterns

- **Attacker:** Any visitor or automated scraper.
- **Preconditions:** A profile is public.
- **Abuse:** Collect weekly totals, ranks, handles, changes, and cars at scale or bypass cache/rate
  controls.
- **Impact:** Profiling, harassment, load, or misleading external reuse.
- **Controls:** Explicit visibility, only weekly aggregate and rounded freshness, no
  provider/account/day/device breakdown, bounded pages, shared caching, rate/capacity policy,
  hide/delete refresh.
- **Detection:** CDN aggregate traffic and cache metrics without user-level behavioral analytics.
- **Recovery:** Hide affected profile, publish a new snapshot, purge reviewed caches, contain
  abusive routes, and communicate without confirming private state.
- **Residual risk:** Intentionally public historical values may be copied by third parties beyond
  project control.

### VR-ABUSE-AUTH-TAKEOVER — OAuth, session, passkey, or recovery authority is expanded

- **Attacker:** Network/browser attacker, stolen session holder, or recovery-code holder.
- **Preconditions:** An authentication ceremony is active or credential is compromised.
- **Abuse:** CSRF OAuth, replay WebAuthn, accept wrong RP/origin, use GitHub as recovery, turn
  restricted recovery into a normal session, or reuse revoked provenance.
- **Impact:** Profile/account/device takeover and destructive actions.
- **Controls:** State plus PKCE, purpose cookies, exact WebAuthn verification, fresh action-bound
  step-up, one-time restricted recovery, session rotation, terminal revoke, and generic errors.
- **Detection:** Ceremony/replay/race tests, bounded security events, and user-visible credential
  inventory.
- **Recovery:** Revoke sessions/passkeys/devices, rotate recovery under valid authority, contain
  affected routes, and follow protected incident handling.
- **Residual risk:** Compromise of the authenticator or user browser/OS can exercise legitimate
  authority.

#### VR-ABUSE-AUTH-TAKEOVER — OAuth, session, passkey, or recovery abuse

Historical ADR anchor. The active structured authority-expansion case is immediately above.

#### VR-ABUSE-RECOVERY-ORACLE — Recovery enumeration, replay, or authority expansion

Historical ADR anchor. Restricted recovery is covered by VR-ABUSE-AUTH-TAKEOVER.

### VR-ABUSE-ORIGIN-BYPASS — Direct Ingest call forges Edge authority

- **Attacker:** A remote client or caller with stale/incorrect Edge material.
- **Preconditions:** Direct Ingest origin is network reachable.
- **Abuse:** Supply origin headers, replay HMAC, alter path/body/encoding after proof, exploit key
  rotation, or use cleartext transport.
- **Impact:** Bypass edge rate/framing controls and reach device verification/storage directly.
- **Controls:** Strip caller proof, exact path/body digest HMAC, short timestamp, nonce replay
  inside final transaction, key ID allowlist, certificate verification, no retry/redirect/proxy, and
  direct-origin denial.
- **Detection:** Direct-origin, tamper, skew, rotation, replay, and external route probes with
  generic output.
- **Recovery:** Remove route enablement, replace Edge/Ingest processes, rotate origin keys, verify
  old authority denial, and reopen one capability at a time.
- **Residual risk:** A compromised active Edge can create valid origin proofs; device signature and
  account binding remain independent.

### VR-ABUSE-DATABASE-ROLE — Runtime service exceeds its capability

- **Attacker:** Compromised Web, Ingest, Jobs, Admin, migration, or pool session.
- **Preconditions:** One deployment login can connect.
- **Abuse:** Inherit/widen roles, query private tables, invoke another function, own schema objects,
  retain assumed role across pool reuse, or run arbitrary SQL.
- **Impact:** Cross-profile disclosure/mutation, integrity loss, or deletion bypass.
- **Controls:** Distinct probed NOINHERIT logins, NOLOGIN capability roles, forced RLS, owner-only
  schema, fixed procedures, parameterized adapters, reset-before-reuse, and widened-login denial
  tests.
- **Detection:** Catalog/grant/RLS oracles, adapter confinement lint, `pg_stat` cleanup, and
  disposable role integrations.
- **Recovery:** Isolate the database/service, revoke/rotate login, restore exact grants through
  reviewed migration, assess mutation, and follow forward recovery.
- **Residual risk:** Owner or superuser compromise is a control-plane incident beyond runtime role
  isolation.

### VR-ABUSE-RESOURCE-EXHAUSTION — Bounded surfaces multiply work or state

- **Attacker:** Anonymous remote traffic, authenticated automation, or buggy scheduler/connector.
- **Preconditions:** Public reads, pairing, usage, snapshot refresh, or retention jobs are enabled.
- **Abuse:** Oversized bodies/files, many candidates/accounts/devices, queue growth, cache misses,
  repeated refresh, slow database locks, or process-signal storms.
- **Impact:** Availability loss, state growth, missed refresh/deletion, or expensive service work.
- **Controls:** Exact body/header/file/record/candidate/account/device/page limits, no-queue
  admission, rate windows, fixed pools/deadlines, coalesced dirty outbox, no-overlap Jobs, bounded
  batches, and shared public cache.
- **Detection:** Aggregate saturation, queue/outbox age, snapshot duration, pool/admission, and
  bounded failure metrics.
- **Recovery:** Close affected capability, settle processes, preserve last good snapshot, remove bad
  work through fixed Jobs commands, and restore gradually.
- **Residual risk:** Representative hosted capacity and DDoS controls are unproven until
  staging/production evidence exists.

### VR-ABUSE-DELETE-RESURRECTION — Deletion leaves or revives authority/data

- **Attacker:** Faulty service, stale cache/backup, operator error, or malicious credential holder.
- **Preconditions:** A deletion request, purge, snapshot refresh, or restore fails/interleaves.
- **Abuse:** Keep sessions/devices/accounts active, publish stale profile state, partially purge, or
  restore deleted authority from an older archive.
- **Impact:** Privacy violation and unauthorized post-deletion activity.
- **Controls:** Atomic immediate lock-down, bounded Jobs purge, terminal evidence, hidden-profile
  snapshot exclusion, isolated restore, explicit cache/backup/tombstone boundary, and protected
  aggregate verification.
- **Detection:** Request/purge race tests, residual relation checks, snapshot visibility tests,
  restore oracles, and protected operational monitoring when deployed.
- **Recovery:** Keep authority and routing contained, retry only through the reviewed fixed
  capability after root cause, purge new snapshot/cache, and replay deletion markers only when
  implemented.
- **Residual risk:** CDN purge, external backup expiry, stale-backup replay, notification, and
  real-user deletion are not proven by local tests.

### VR-ABUSE-ADMIN-MISUSE — Privileged action lacks independent authority or audit

- **Attacker:** Normal user, compromised Admin process, or authorized maintainer exceeding role.
- **Preconditions:** An Admin capability is enabled.
- **Abuse:** Use a normal session, service token, mutable email mapping, stale assertion, missing
  passkey, unacknowledged audit, or broad database role.
- **Impact:** Unauthorized invite, policy, user, or operational mutation.
- **Controls:** Exact human Access assertion, opaque member mapping, complete authorization, fresh
  passkey, reason, pre/post acknowledged audit, one-time narrow credential, and single-capability
  role.
- **Detection:** Denial matrix, audit ordering, member/token/clock regressions, and narrow/widened
  PostgreSQL integration.
- **Recovery:** Disable Admin host, revoke membership/login, preserve protected audit, assess
  mutations, and re-enable only after independent review.
- **Residual risk:** Current repository has no complete Admin host/passkey/audit backend or
  deployment evidence.

#### VR-ABUSE-ADMIN-MISUSE — Privileged action without independent authority

Historical ADR anchor. The active structured Admin case is immediately above.

## Infrastructure, administration, and supply-chain abuse

Historical ADR section anchor. The active infrastructure, Admin, dependency, release, and
trust-label cases are distributed across the preceding and following sections.

## Supply-chain and trust-label abuse

### VR-ABUSE-DEPENDENCY-PR — Contribution or dependency runs with excessive authority

- **Attacker:** Malicious contributor, package publisher, action author, container publisher, or
  compromised registry.
- **Preconditions:** CI installs/builds untrusted inputs.
- **Abuse:** Lifecycle script, mutable action/image, lockfile confusion, build script, workflow
  permission, or secret-bearing PR job executes attacker code.
- **Impact:** Repository, credential, artifact, or deployment compromise.
- **Controls:** Exact pins, frozen lockfiles, ignored npm lifecycle scripts, reviewed Rust build
  graph, license/inventory checks, full-SHA actions, digest containers, read-only secretless PR
  permissions, and protected release separation.
- **Detection:** Config/dependency/history/checker mutations, online advisories, provenance review,
  and complete diff inspection.
- **Recovery:** Stop release, revoke affected credentials, replace compromised pins/artifacts,
  repair sensitive history only through the approved incident process, use ADR 0077's forward-only
  same-author remediation only for an eligible DCO failure, and rerun clean protected builds.
- **Residual risk:** Compiler, runner image, OS packages, registry, and upstream maintainers remain
  trusted dependencies.

### VR-ABUSE-RELEASE-SUBSTITUTION — Local binary is presented as official

- **Attacker:** Distributor, compromised build actor, mirror, or social engineer.
- **Preconditions:** Users can obtain a connector binary.
- **Abuse:** Publish an unsigned/modified/unsupported artifact, omit SBOM/provenance, downgrade
  reader support, or retain plaintext key storage.
- **Impact:** Credential theft, false usage, local code execution, and project trust compromise.
- **Controls:** Protected build from supported revision, platform signature, checksum, SBOM,
  provenance, package inventory, clean-machine install/update/uninstall and credential-store tests,
  and explicit support matrix.
- **Detection:** Independent artifact verification and release metadata checks; no official claim
  from local tree alone.
- **Recovery:** Revoke release, rotate signing/deployment authority, publish a sanitized advisory
  through approved channels, and require a new protected version.
- **Residual risk:** No hosted release/signing evidence exists yet; the connector is not official.

### VR-ABUSE-TRUST-PROMOTION — Community data is labeled or ranked as Verified

- **Attacker:** Malicious client, compromised runtime, UI bug, or incomplete provider integration.
- **Preconditions:** Community and future Verified surfaces coexist.
- **Abuse:** Submit trust/provider/revision fields, reuse Community observations in Verified
  snapshots, or display a Verified label without server provider evidence.
- **Impact:** Materially false trust claim and possible future privilege/reward confusion.
- **Controls:** Reject unknown client fields, immutable server-owned trust, separate provider
  ingestion and storage, separate snapshots/ranks, default-disabled integration, exact UI copy, and
  no reward coupling.
- **Detection:** Contract, role, snapshot, copy, and provider-disabled tests plus public response
  schema checks.
- **Recovery:** Disable Verified capability, remove false snapshot publication, correct through
  reviewed provider integration, and disclose the evidence boundary.
- **Residual risk:** Provider APIs can themselves be wrong or delayed; Verified means
  server-obtained under the documented provider contract, not absolute truth.

#### VR-ABUSE-CAR-INJECTION — Executable or remote content in customization

Historical ADR anchor. VR-CAR-001 keeps CarRecipe enum-only and cosmetic; URL, file, markup, script,
and remote content remain rejected.

### VR-ABUSE-REPORT-DISCLOSURE — Sensitive evidence enters public collaboration

- **Attacker:** Accidental reporter, maintainer, automated log collector, or malicious submitter.
- **Preconditions:** A bug, incident, review, or support interaction occurs.
- **Abuse:** Post credentials, prompts, code, paths, real usage, database rows/errors, protected
  hostnames, private screenshots, or exploit details publicly.
- **Impact:** Credential/user-data exposure and increased active exploitation risk.
- **Controls:** Private vulnerability reporting, public-file/history/staged scans, synthetic
  reproduction policy, non-reflective logs/errors, and protected incident/change systems.
- **Detection:** Automated pattern checks plus human decoded/binary/diff review.
- **Recovery:** Stop publication, rotate exposed authority, remove or repair sensitive history
  through the approved incident process, use ADR 0077's forward-only same-author remediation only
  for an eligible DCO failure, notify affected owners privately, and publish only a sanitized
  summary.
- **Residual risk:** Automated scanners cannot identify every sensitive value or external copy;
  reviewers remain responsible for meaning.

## Verification mapping

Every case above requires at least one negative unit or contract test and, where persistence or
roles are involved, a disposable PostgreSQL integration. Reader cases require privacy sentinels
through the final signed body. Pairing and authentication cases require concurrency/replay tests.
Snapshot cases require failure injection and 10,000-profile evidence. Release cases require hosted
protected evidence before any official claim.

Passing local tests does not prove a provider reader against real data, a signed connector release,
production rate limits, deployed Edge/direct-origin routing, monitoring, cache purge, backup expiry,
incident response, capacity, or real-user deletion.
