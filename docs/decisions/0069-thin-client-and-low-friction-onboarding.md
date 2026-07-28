# ADR 0069: Thin auditable multi-agent client and low-friction hybrid onboarding

- Status: Superseded
- Date: 2026-07-21
- Decision owners: Connector, Web/Auth, Ingest, and Product owners
- Supersedes: None while Proposed (if accepted, would refine ADR 0068's connection path and
  partially supersede ADR 0003's GitHub-required enrollment framing)
- Superseded by: ADR 0076

## Context

[ADR 0068](0068-multi-agent-token-leaderboard-and-mcp.md) set the direction: an agent-neutral direct
token-total leaderboard, a thin-client primary path, an optional MCP submission transport, and a
hybrid Community/Verified honesty model, all built on the existing security foundation.

The baseline plan's connection path is heavy: a Rust connector that performs a version-specific
Codex App Server handshake, an exact-candidate admission machinery, platform-specific release
signing/provenance, and a passkey step-up to pair every source. That design is rigorous but:

- it is heavyweight to ship and to audit (a real dependency tree, a release pipeline, per-platform
  binaries);
- it handles only Codex through the handshake, so each additional agent needs comparable machinery;
- its enrollment (GitHub OAuth plus an initial passkey) and per-source passkey pairing create
  substantial friction before a user sees any value.

Prior art in the form of shipped, worldwide token-spend leaderboards demonstrates that a much
thinner approach is viable and has strong properties: a single, dependency-free, human-readable
client that reads each agent's local usage storage directly, submits bounded daily aggregates, and
onboards in seconds (including anonymously). Those products also ship and iterate quickly, which a
heavy client and a full security build-out do not.

This decision adopts the thin-client and low-friction onboarding model as the primary path while
preserving the project's security and privacy posture on the server and for sensitive actions. It is
a planning decision; nothing here is implemented, and each part requires its own focused ADR and
negative tests before it ships. Comparable products are referenced only as prior art; no external
product is named or linked in this repository.

## Decision

### 1. Thin, auditable client as the primary connection path

- The primary connection path is one **thin, minimal-dependency, human-auditable client**. The
  optional MCP transport from ADR 0068 is not required for the MVP and is not a token meter.
- The thin client reads each agent's **local usage storage directly** through bounded, read-only
  readers: Claude Code session logs, Codex rollout files, opencode SQLite storage, and similarly
  documented local storage for Qwen Code, Cline, Aider, and future agents. Adding an agent means
  adding one bounded reader, not a new protocol handshake.
- **Agent local storage is mixed-content untrusted input.** Session logs, rollout files, and SQLite
  databases also contain prompts, conversations, code, tool output, file paths, repository names,
  credentials, and email. Each reader MUST extract only the documented fields needed to derive one
  canonical daily token total under ADR 0068 and MUST discard all other content at parse time.
  Readers MUST enforce strict bounds: maximum file size, maximum record count, maximum field length,
  and a closed set of recognized keys/columns. A reader MAY ignore an explicitly recognized
  non-usage record type without inspecting its sensitive values. Malformed, oversized, ambiguous, or
  unrecognized usage-bearing input — including a missing record required by the documented
  deduplication rule — MUST invalidate the affected source/day. No partial daily total or signed
  request is emitted for that source/day. The process MAY continue with independently valid
  source/day units and a bounded local error. Symlinks, directory traversal, and paths outside the
  agent's documented storage root MUST be rejected. The focused implementation ADR for each reader
  MUST specify the exact extracted fields, parse bounds, recognized non-usage records, invalidation
  unit, and negative cases before the reader ships.
- The client submits **bounded daily aggregates** only. Prompts, conversations, code, file paths,
  repository names, credentials, API keys, account email, model names, session counts, and raw token
  components MUST NOT cross the reader extraction boundary into the submission payload (extends
  VR-CODEX-002 to every agent). This is a parsing and schema-enforcement requirement, not a claim
  that the underlying files lack sensitive content.
- A new trust boundary — **agent local storage → thin client reader** — MUST be added to
  [THREAT_MODEL.md](../security/THREAT_MODEL.md) before the first reader ships. It covers:
  mixed-content isolation, symlink and path-traversal denial, size and record bounds, malformed
  input fail-closed, and the absence of sensitive fields in the extracted output.
- The **Rust connector becomes an optional precision path**, not the primary requirement. It remains
  available where a signed, source-bound, exact-version path is wanted, but a user can participate
  fully without it.
- The client targets **zero or minimal dependencies** so the entire client can be read and audited
  quickly, minimizing supply-chain surface.

### 2. Low-friction hybrid onboarding

- **Anonymous/pseudonymous participation is allowed.** A user can join the reward-free Community
  leaderboard with a chosen handle and a valid admission proof (invite code during beta, Turnstile
  challenge after), without GitHub. Anonymous identity is backed by an opaque local identity
  credential; the admission gate — not the credential itself — is the primary Sybil control, because
  Ed25519 keys are cheap to generate. No upstream account is required.
- **GitHub device-flow is offered** for users who want a GitHub-linked identity, with minimal OAuth
  scope and the same beta admission requirement as anonymous enrollment. A fresh GitHub enrollment
  must also prove possession of the first device-bound sync key; resolving a GitHub ID alone does
  not create a source or submission authority.
- **Passkey step-up is required only for critical/sensitive actions** — profile deletion, source
  pairing/reactivation/unlink, device/passkey revocation, and recovery changes — not for basic
  participation, viewing, or ordinary sync. Anonymous users who need a sensitive action establish a
  passkey at that point. After that first passkey is active, an anonymous profile uses the same
  passkey-bound critical-action path as a GitHub-linked profile; linking GitHub is not an additional
  authorization prerequisite.
- This keeps the barrier to entry low while preserving strong authentication where authority
  matters. Because this ADR is Proposed, it would refine VR-AUTH-001 only after acceptance; the
  current GitHub-plus-passkey invariant remains authoritative until then.

#### Anonymous bootstrap and credential lifecycle

Anonymous enrollment uses **two separate credentials** with strictly separated authority:

- **Identity bootstrap credential** (Ed25519 key pair): generated through the OS CSPRNG and stored
  in the native credential store keyed to the service origin. It is temporary authority available
  only while the profile is anonymous, has no active passkey, the credential is not retired, and the
  server-owned anonymous ownership lease is current. During terminal promotion grace, only the two
  promotion proofs described below remain available. Its closed allowlist is: (1) establish a
  short-lived restricted bootstrap session, (2) register exactly the first passkey, and (3) complete
  an anonymous-to-GitHub upgrade. A bootstrap session may read basic private account state and
  perform privacy-reducing hide and pause actions only. It cannot add another source/device, unhide
  or resume collection, change recovery, add a subsequent passkey, revoke a credential, delete the
  profile, or reach Admin. The identity bootstrap credential is not a recovery credential and MUST
  NOT enter the restricted-recovery flow. No other operation may accept it. It is NEVER used for
  sync and NEVER transmitted in sync payloads. Each allowed operation uses its own action-bound
  server challenge with a distinct domain-separated signature context, so enrollment, bootstrap
  session, first-passkey, and GitHub-upgrade proofs are not interchangeable.
- **Device-bound, source-scoped sync key** (Ed25519 key pair): generated independently for each
  local installation/device authority and bound by the server to exactly one source (VR-DEVICE-001).
  A source may have multiple independently revocable device keys; product workflows never share,
  copy, or export a private key to attach a second device. The key is stored in the operating
  system's native credential store with no plaintext-file fallback, and the signer necessarily has
  signing access to it. This storage contract does not claim hardware-backed non-exportability:
  malware or another process running with the user's authority may extract or use the key. The key
  is used ONLY for signing sync payloads for its bound source. It cannot add passkeys, delete the
  profile, or perform any sensitive action. A stolen key can fabricate sync data for its one bound
  source until that device authority is revoked, but it cannot impersonate another device or
  escalate to profile-level authority.

Anonymous enrollment is a two-step challenge-response ceremony, not a pairing step:

1. The client generates the identity bootstrap credential and the first device-bound sync key
   through the OS CSPRNG and stores both in the native credential store. This key will become the
   first independently revocable device authority for the first source; it is not the source's
   shared key.
2. **Admission gate.** During the invite-only beta, the enrollment request MUST include a valid,
   unredeemed invite code (issued through the existing Admin invitation kernel). After the beta gate
   is lifted by a separate decision, a server-side Turnstile (or equivalent proof-of-humanity)
   challenge replaces the invite requirement. The admission gate is the primary Sybil control; the
   per-credential rate limit below is defense-in-depth, not the primary barrier, because new Ed25519
   keys are cheap to generate.
3. **Enrollment request and admission consumption.** The client sends a bounded enrollment request:
   chosen handle, the identity bootstrap public key, the first device's sync public key, the
   admission proof, and the first detected agent source (provider enum plus opaque source label).
   The server handles the two admission classes differently and issues no enrollment challenge until
   the relevant durable decision succeeds:
   - For an invite, the server immediately reduces the secret to its verifier and atomically moves
     one active, unexpired, unredeemed invite into a short-lived reservation bound to the enrollment
     transaction. A unique reservation rule makes concurrent use of the same invite produce exactly
     one reservation; every other request is rejected before challenge issuance.
   - For Turnstile or another external proof, the server validates the token with the provider and
     then atomically inserts a one-way keyed proof digest into a local consumption/replay record
     bound to the enrollment transaction. A unique digest rule makes concurrent completion produce
     exactly one local winner. The raw token is discarded after validation and never stored or
     logged. External validation cannot be rolled back or represented as a database lock. Only after
     that decision does the server create a one-time cryptographic challenge, with a short expiry,
     bound to the handle, both submitted public keys, the first source declaration, and the exact
     admission transaction.
4. **Proof of possession and atomic completion.** The client signs the server challenge with
   **both** private keys, using domain-separated signature contexts (`viberacing-enroll-identity`
   and `viberacing-enroll-sync`) so a sync-key signature cannot be replayed as an identity-key
   signature or vice versa. The client sends both signatures back. The server verifies both
   signatures against the submitted public keys and the issued challenge, then in a **single atomic
   transaction**: consumes the challenge, creates the profile (bound to the identity bootstrap
   public key), creates the first AgentSource, and creates its first device-authority binding to the
   submitted sync public key. The public key belongs to that device row, not to a singleton
   source-key field. It also sets `anonymous_owner_expires_at` to exactly the database clock plus 90
   days. The invite branch redeems the exact still-owned reservation in this transaction. The
   external-proof branch requires the previously committed local consumption record and marks its
   enrollment transaction complete; it does not pretend to undo or reuse the provider token. No
   passkey is required for this step.
5. The enrollment is rate-limited per identity bootstrap public key and per network origin as
   defense-in-depth. Request/numeric bounds, the source-count ceiling, and quarantine policy apply
   immediately.

If an invite-backed challenge fails or expires, one bounded compare-and-set transition may release
only that exact reservation when the invite is still active and unexpired. A revoked or expired
invite never becomes usable again. If an external-proof challenge fails or expires, the local
consumption record remains replay-blocking for its bounded retention and the user must obtain a new
provider token. No shared rollback rule applies to both proof classes.

**Anonymous ownership lease and terminal expiry.** A no-passkey anonymous profile has a **90-day
anonymous ownership lease** measured only by the server's database clock. Before it expires, a
successful action-bound identity proof that establishes the existing restricted bootstrap session
renews `anonymous_owner_expires_at` to exactly database-now plus 90 days. The client shows the
expiry and offers immediate first-passkey promotion. Ordinary sync, device-key possession, public or
private reads, failed bootstrap proofs, and client-supplied time never renew the lease.

At the lease deadline, the profile is expired by authoritative database time even if a background
job has not run. Public reads treat it as hidden, Ingest rejects every device submission, and Web
rejects restricted bootstrap sessions and renewal. One serialized transition marks the profile
`anonymous_expired`, hides it, pauses every source, invalidates outstanding bootstrap sessions and
challenges, and records a **30-day terminal promotion grace**. A concurrent pre-deadline renewal or
promotion and the expiry transition have exactly one database-ordered winner.

During that grace, the identity bootstrap credential can perform only first-passkey registration or
anonymous-to-GitHub upgrade through their existing action-bound proofs. It cannot create a general
bootstrap session or renew the lease. Successful promotion retires the bootstrap credential and
clears terminal-expiry state, but the profile remains hidden and its sources remain paused until the
new passkey-protected identity explicitly unhides or reactivates them. No source resumes
automatically.

After grace, an idempotent, bounded, **separate Jobs-only system-expiry capability** removes the
anonymous profile and its profile-owned source, device, usage, and public-projection state under the
reviewed deletion/retention mutex order. It records only the minimal redacted audit or tombstone
state justified by the privacy map and restore policy. It does not fabricate a user deletion
request, reuse the user-confirmed deletion job, or accept a device/sync key. Default-off scheduling,
maximum batch size, retry behavior, restore replay, and cleanup evidence require their own focused
implementation slice before anonymous enrollment can be enabled.

This bootstrap does **not** bypass VR-MCP-001 or the pairing model: VR-MCP-001 governs MCP-reported
source binding to an existing profile, not the initial enrollment ceremony. The enrollment creates
exactly one profile with exactly one source; every subsequent source addition, reactivation, or
unlink and every later device attachment requires a current session for that same profile plus a
fresh passkey step-up. The session may belong to an anonymous or GitHub-linked identity. GitHub is
not required after an anonymous profile has registered its first passkey.

**Terminal bootstrap retirement.** Registering the first passkey atomically activates that passkey
and sets one monotonic profile-level `first-passkey-complete` state. The same transaction marks the
identity bootstrap credential retired. A successful GitHub upgrade likewise atomically binds the
GitHub ID and retires the credential. The server rejects a retired credential for every operation,
including bootstrap login and first-passkey registration, even if the client fails to remove its
local copy. The client deletes the local bootstrap key only after an authenticated read-back
confirms retirement. The monotonic first-passkey state never resets after passkey revocation or
retention cleanup. Subsequent passkey addition uses the existing fresh-passkey ceremony; restricted
recovery uses the existing recovery-code flow. Neither path can fall back to a retired bootstrap key
or a new first-passkey ceremony.

**Credential loss and recovery.** If the user loses the identity bootstrap credential before first
passkey registration or GitHub upgrade, no replacement credential, sync key, new enrollment, or
support path can recover that profile. The client MUST warn at enrollment, display the ownership
lease, and offer immediate first-passkey promotion. Loss does not create a permanent orphan:
ordinary sync cannot renew ownership, the server hides and pauses the profile at lease expiry, and
the separate system-expiry capability removes it after terminal grace. Loss of a device-bound sync
key affects only that device's ability to submit for its bound source; another independently
approved device for the source remains usable. It does not affect profile ownership. After
promotion, the normal passkey and restricted-recovery lifecycle applies and the bootstrap credential
has no authority.

**Deletion.** Profile deletion always requires a fresh passkey step-up, consistent with VR-AUTH-001
and VR-DEVICE-002. An anonymous user who has not yet added a passkey must first register one
(proving ownership through the identity bootstrap credential, not a sync key); that registration
retires the bootstrap credential before the user requests deletion through the passkey-protected
flow. A device-bound sync key MUST NOT grant passkey-addition or deletion authority. Terminal
anonymous-expiry cleanup is a server-owned retention transition for abandoned no-passkey profiles,
not a user-requested deletion, and therefore has its own capability, audit reason, tests, and
restore behavior.

#### GitHub enrollment and upgrade

- A fresh GitHub device-flow enrollment uses the same beta admission-consumption rules, resolves one
  minimal-scope numeric GitHub ID, and requires an action-bound proof from the first device's sync
  key. One atomic completion creates the unique GitHub-bound profile, its first source, its first
  device-authority binding, a basic GitHub-authenticated session, and one bounded first-passkey
  authority. It does not create an anonymous identity bootstrap credential. That basic session can
  participate, read basic private account state, and perform privacy-reducing hide and pause
  actions, but every critical action is denied until a passkey is active.
- A GitHub-linked profile that has **never activated a passkey** may obtain a short-lived,
  single-purpose **GitHub first-passkey authority** from the exact device-flow transaction that
  creates or upgrades the profile, or from a later fresh returning device-flow transaction that
  resolves the exact already-bound numeric GitHub ID after an earlier authority expired. The server
  atomically consumes that transaction and creates one action-bound WebAuthn registration challenge.
  The authority can register exactly the first passkey and has no login, recovery, source/device,
  deletion, Admin, or general account authority. First-passkey completion atomically consumes both
  records, activates the passkey, sets the monotonic `first-passkey-complete` state, and rotates the
  basic session to a passkey-bound session.
- A returning GitHub device-flow may create another basic session, and—only while
  `first-passkey-complete` is still false—another bounded first-passkey authority after an expired
  attempt. Once any passkey has ever been activated, GitHub first-passkey authority is terminally
  unavailable even if every passkey is later revoked or aged provenance is cleaned up. Loss of all
  passkeys after that point uses only the existing recovery-code replacement-passkey flow; GitHub
  login cannot reset passkey history or become recovery.
- An anonymous profile with no passkey authorizes upgrade through an action-bound identity bootstrap
  proof. A profile with a passkey authorizes it through a fresh passkey; its bootstrap credential is
  already retired. Both paths also require an exact GitHub device-flow result. When the anonymous
  profile has never activated a passkey, the no-passkey upgrade atomically binds GitHub, retires the
  bootstrap credential, and creates the restricted basic session plus first-passkey eligibility
  described above, so authority is not stranded between the two identity kinds.
- If the resolved GitHub ID already belongs to any profile, enrollment or upgrade fails with one
  generic result and zero profile, source, score, session, or credential mutation. Profiles are
  never automatically merged, and sources or score history are never transferred. A future merge
  needs its own ADR, user-confirmation model, conflict rules, migration, rollback, and deletion
  analysis.
- A successful anonymous upgrade atomically binds the unique GitHub ID, retains the same profile,
  sources, and score history, and retires the identity bootstrap credential. Client key deletion
  follows the same authenticated retirement read-back described above.

### 3. Adopted client practices

These practices are adopted because they are simple, user-trusting, and proven by prior art:

- **Auto-submit on session end** where the agent exposes a session-end hook; otherwise periodic or
  manual submit.
- **Bounded, season-partitioned backfill** on first setup: eligibility is evaluated for each
  reported date's derived ISO season. The client includes dates from the current ISO week and may
  include dates from the immediately preceding ISO week only while that previous season can still
  arrive before its Wednesday 00:00 UTC grace deadline under ADR 0008. The 48-hour grace is a
  server-receipt deadline for the previous season, not two extra reported dates in the current
  season. For each source, the client partitions backfill into one independently signed
  `UsageSyncV1` request per derived ISO season and sends the current-season request independently
  from the previous-season request. At most those two season requests can exist during first setup.
  Server receipt time remains authoritative: if the previous-season request races the deadline it is
  quarantined as a unit and is not retried after closure, while the separately submitted
  current-season request remains eligible and cannot be quarantined by the older dates.
  Closed/finalized seasons are never added to a new request. A separate non-ranking historical
  import or correction contract—with its own ADR, migration, authorization model, and season
  policy—is required before older history can be displayed; ADR 0008 explicitly defers correction to
  a later ADR.
- **Sequential all-source submit**: `submit all` is local orchestration, not a multi-principal
  network envelope. The client enumerates at most the profile source ceiling, partitions each source
  by derived ISO season when required, and sends one complete, independently signed
  single-source/single-season `UsageSyncV1` request at a time through the existing Ingest boundary.
  Every request has its own source ID, device ID, sync ID, nonce, timestamp, body digest, signature,
  idempotency result, and existing body/entry bounds. There is no cross-source or cross-season
  atomicity, shared rollback, partial-envelope parser, or request-size multiplication. One request
  failure does not change another request's result; the local command reports a bounded
  per-source/per-season outcome and may retry only under that request's existing rules. Cross-source
  signing remains rejected.
- **Local dry-run (`status`)**: the client prints the exact ordered source/season requests that
  would be sent before anything leaves the machine.
- **Minimal payload by construction:** the service does not collect model names, session counts, or
  provider-shaped component fields for this feature. Avoiding optional telemetry removes the need
  for preference generations, historical cleanup jobs, and another privacy-control surface.

### 4. Release strategy: ship a thin MVP first, then layer

- **Phase A (thin MVP):** thin client, direct `weeklyTokenTotal` Community leaderboard, hybrid
  onboarding (anonymous or GitHub device-flow), and the adopted client practices. This is shippable
  on its own.
- **Phase B (layer on):** optional MCP submission for reviewed integrations, the Verified tier
  (provider usage API where available), passkey hardening beyond the critical-action minimum, and
  polish.
- Staging-readiness work may precede Phase A, but no participant cohort or public beta launches on
  the legacy Codex-only foundation. The complete Phase A artifact must pass staging and the public
  release gates first; Phase B remains optional and cannot be used as a substitute.
- The goal is to reach a working product early and deepen it, rather than completing the full
  security architecture before any release.

## Security and privacy consequences

The honest cost of this direction is concentrated in identity and abuse resistance; it is accepted
because the product is reward-free and the server retains integrity controls.

- **Sybil/abuse tradeoff (accepted, mitigated).** Anonymous participation weakens per-human sybil
  resistance relative to a GitHub-immutable-ID requirement (affects VR-ABUSE-IDENTITY-SYBIL).
  Primary mitigation: enrollment requires a valid invite code during the beta (or a Turnstile
  proof-of-humanity challenge after the beta gate is lifted), so bulk enrollment requires bulk
  admission proofs, not just cheap Ed25519 keys. Additional mitigations: the leaderboard is
  explicitly Community and reward-free (no money, prizes, authorization, or valuable privilege —
  VR-TRUST-001); source/request/numeric bounds apply before exact direct aggregation; the
  contributing-source count is public; anomalous records are quarantined; and creation/ingest are
  rate-limited per credential and origin as defense-in-depth. Anonymous profiles gain no privilege,
  and sensitive actions still require a passkey.
- **Identity model change.** "One profile per GitHub ID" would generalize to "one profile per
  identity," where an identity may be anonymous (opaque local credential) or GitHub-linked.
  Anonymous identities still need a local credential to raise the cost of bulk multi-accounting from
  one client, without requiring an upstream account.
- **Anonymous bootstrap (accepted risk, admission-gated, credential-separated).** The enrollment
  ceremony requires a valid admission proof and creates one profile and source without a passkey,
  using a temporary identity bootstrap credential and a separate device-bound, source-scoped sync
  key. The bootstrap key can establish only a restricted session, register exactly the first
  passkey, or complete a GitHub upgrade while the profile has no active passkey. It cannot perform
  restricted recovery or add a later passkey, and it is retired atomically by either promotion path.
  A stolen sync key cannot escalate to profile authority or impersonate a second device
  (VR-DEVICE-002 preserved). The 90-day server-clock ownership lease can be renewed only by a valid
  pre-expiry bootstrap-session proof; ordinary sync never renews it. Expiry immediately hides the
  profile and pauses sources, leaves only two promotion proofs for a 30-day grace, and then makes
  the profile eligible for separate bounded Jobs-only cleanup. Identity-key loss therefore remains
  unrecoverable but does not create indefinite retained or public state; after promotion the key has
  no authority. Invite reservation is transactionally releasable only for the same still-valid
  invite, while an external proof is locally consumed and cannot be rolled back or reused.
  VR-MCP-001 is not bypassed because it governs MCP-reported source binding to an existing profile,
  not initial enrollment.
- **Bootstrap-free GitHub first passkey.** GitHub enrollment and upgrade never invent an anonymous
  bootstrap key. The exact enrollment/upgrade device-flow transaction, or a later fresh returning
  transaction for the already-bound GitHub ID, may create only a short-lived first-passkey authority
  while the profile's monotonic `first-passkey-complete` state is false. That authority is consumed
  with one WebAuthn challenge and cannot log in, recover, manage sources/devices, or perform another
  critical action. Once any passkey has been activated, GitHub can continue to establish basic
  sessions but can never reset passkey history or replace restricted recovery.
- **Passkey-for-critical-only.** Reduces onboarding friction; the proposed step-up model still
  protects deletion, pairing, device/passkey revocation, and recovery (VR-AUTH-001 refined, not
  removed).
- **Direct local-file reading.** Agent local storage is mixed-content: the same files that carry
  usage totals also contain prompts, code, paths, and credentials. Readers are read-only and
  bounded; they MUST extract only fields needed to derive the documented canonical daily total and
  discard everything else at parse time, with strict size, record, and field bounds and fail-closed
  handling of malformed input (VR-CODEX-002 extended to all agents). A dedicated trust boundary
  (agent local storage → thin client reader) MUST be added to the threat model before the first
  reader ships.
- **Single-source/single-season transport.** Local all-source and backfill convenience do not create
  a new multi-principal or cross-season request format. Existing per-source body, signature, replay,
  admission, and idempotency bounds stay independently enforceable. A previous-season grace race
  cannot quarantine the separately submitted current-season dates, and one failure has no
  cross-source or cross-season rollback meaning.
- **GitHub collision safety.** Fresh GitHub enrollment and anonymous upgrade both fail generically
  without mutation when the numeric ID already belongs to a profile. Automatic merge or history
  transfer is forbidden until a separate accepted ADR exists.
- **Dry-run and payload minimization.** The local preview shows the exact canonical totals before
  send. Model names, session counts, and raw provider components are never submitted or retained, so
  no retroactive telemetry-cleanup workflow is needed.
- **Thin client supply chain.** Minimal/zero dependencies reduce the client's supply-chain surface
  and make full audit practical (supports VR-CI-001 and VR-RELEASE-001 goals for the client even
  before the optional Rust path is signed).

Proposed new/affected invariants (non-authoritative until this ADR is Accepted and the active
invariant table is changed through its review policy):

- **VR-CLIENT-001** — The primary client is thin, minimal-dependency, and auditable; each reader
  extracts only fields required to derive the documented canonical daily total from mixed-content
  agent local storage and discards all other content at parse time; prompts, code, paths, repository
  names, credentials, email, model names, session counts, and raw token components MUST NOT cross
  the extraction boundary into the submission payload; malformed, oversized, ambiguous, or
  unrecognized usage-bearing input invalidates its whole source/day and cannot produce a partial
  total or signed request.
- **VR-ENROLL-001** — Anonymous enrollment uses a temporary identity bootstrap credential and one
  independently revocable device-bound sync key. The bootstrap key may establish only a restricted
  bootstrap session, register exactly the first passkey, or complete a GitHub upgrade while no
  active passkey exists; either promotion retires it atomically, and it never grants restricted
  recovery. Its server-clock ownership lease is 90 days and can be renewed only by a valid
  pre-expiry bootstrap-session proof; ordinary sync never renews ownership. Expiry hides the
  profile, pauses every source, and leaves only first-passkey or GitHub promotion for 30 days.
  Promotion keeps state hidden/paused until a passkey-protected action; otherwise a separate bounded
  Jobs-only system-expiry capability removes the profile after grace. Each sync key may sign only
  for its one bound source and cannot add passkeys or delete the profile; one source may have
  multiple device keys and no private key is shared between devices. Invite admission is uniquely
  reserved before challenge issuance and may be released only for the same still-valid reservation;
  an external proof is validated, one-way locally consumed before challenge issuance, never stored
  raw, and cannot be rolled back for reuse. Completion atomically consumes the challenge and creates
  exactly one profile, source, and first device-authority binding; invite completion also redeems
  the exact reservation. A GitHub-linked profile may register its first passkey through a fresh
  single-purpose GitHub authority only while its monotonic first-passkey state is false; GitHub
  never resets that state or replaces recovery. Every proof has a distinct action-bound domain.
  Every subsequent source/device addition and sensitive action requires a fresh passkey, but never
  an additional GitHub link. This ceremony does not bypass VR-MCP-001.
- **VR-AUTH-001 (would be refined)** — Passkey step-up is required for critical/sensitive actions;
  basic participation may be anonymous or GitHub-linked without a passkey.
- **VR-SOURCE-001 (would be refined)** — An identity may be anonymous (opaque local credential) or
  GitHub-linked; an AgentSource remains opaque and self-declared in both cases.

## Alternatives considered

- **Heavy Rust connector as the primary path (baseline plan).** Rejected as primary: heavyweight to
  ship and audit, slow to reach multiple agents, and high-friction. Retained as an optional
  precision path.
- **GitHub-required enrollment plus full passkey (baseline plan).** Rejected: high barrier to entry
  that slows adoption for a reward-free product. Passkeys are kept for critical actions only.
- **No anonymous mode.** Rejected: higher barrier; anonymous participation is acceptable for a
  reward-free leaderboard given admission controls, visible source count, quarantine, and rate
  limiting.
- **Per-agent protocol handshakes only.** Rejected for the primary path: direct local-storage
  reading is a simpler, more version-robust supported-agent adapter; handshakes remain available
  through the optional Rust path where a documented stable surface exists.

## Migration and rollback

- This is a planning decision; no stored data changes yet.
- The thin client is additive and the optional Rust connector path remains. A later MCP transport is
  independently additive and cannot block the thin MVP. Anonymous identity is a new identity kind
  alongside GitHub-linked identity.
- The current `profiles.github_user_id NOT NULL UNIQUE` model cannot represent the proposal. A
  focused identity ADR must define an expand-and-contract migration to a closed, mutually exclusive
  anonymous/GitHub identity state; unique active identity-bootstrap public keys; terminal bootstrap
  retirement; server-owned `anonymous_owner_expires_at` and terminal-grace state; a nullable GitHub
  binding with uniqueness preserved; monotonic `first-passkey-complete` state; bounded GitHub
  first-passkey authority/challenge rows; a separate Jobs-only system-expiry procedure; and
  foreign-key/trigger behavior for abandoned enrollment, profile deletion, and restore. Application
  rollout cannot precede the compatibility and rollback matrix for old and new Web/Jobs processes.
- Invite reservations, external-proof consumption records, enrollment challenges, bootstrap
  sessions, GitHub first-passkey authorities, ownership lease/grace state, and retirement state
  require independent bounded expiry/cleanup rules. The monotonic first-passkey state is retained
  with the profile even after revoked-passkey provenance cleanup. An external proof consumption
  record is not converted back to unused during rollback. Rollback closes new enrollment and
  promotion gates while preserving already-created profiles, their existing lease deadlines, and
  rejection of retired or expired credentials; rollback never silently renews or reopens an expired
  profile.
- Model names, session counts, and raw token components are outside the contract, so rollback has no
  optional-telemetry preference or cleanup state to preserve.
- `submit all` and season-partitioned backfill add no server envelope or database transaction.
  Rollback can remove the local loops without a protocol or persistence migration because every
  request remains one single-source/single-season operation.
- Each new surface (thin client, token-total contract, anonymous identity, optional MCP connection,
  and Verified tier) ships behind its own exact default-off enable gate, consistent with the
  existing fail-closed pattern, so any one surface can be disabled independently.
- Rollback is forward-fix or supersession: mark this ADR `Superseded` by a later ADR rather than
  rewriting it; disable the relevant gates; keep anonymous and GitHub identities coexisting so
  neither is stranded.

## Verification

Before each part is called complete, its ADR must define positive, negative, compatibility,
concurrency, recovery, privacy, and operational evidence. At the direction level, the bar includes:

- Thin client: each reader derives the canonical daily total under ADR 0068 from mixed-content local
  storage; aggregate-vs-component and cumulative-snapshot fixtures prevent double counting; prompts,
  code, paths, repository names, credentials, email, model names, session counts, and raw components
  do not cross the extraction boundary; size, record, and field bounds are enforced; symlinks and
  path traversal are rejected; malformed, oversized, ambiguous, or unrecognized usage-bearing input
  suppresses the whole affected source/day and never emits a partial total or signed request; only
  explicitly recognized non-usage records may be ignored; the agent-local-storage trust boundary is
  present in the threat model; minimal/zero dependencies; the full client is auditable.
- Anonymous identity: enrollment uses two separate credentials (identity bootstrap credential with a
  closed allowlist of temporary bootstrap operations, independently generated device-bound sync key
  for sync only); a source may bind multiple independently revocable device keys, and a key cannot
  add a passkey, delete the profile, impersonate a second device, or sign for another source. The
  bootstrap key cannot enter restricted recovery, add a subsequent passkey, or perform a critical
  action; each bootstrap operation uses its own action-bound challenge and domain. First-passkey
  activation and GitHub upgrade each retire the bootstrap credential atomically; a retained/stolen
  local copy is rejected afterward; failure to delete the client copy does not restore authority.
  Fixed-clock and concurrency tests prove the 90-day lease is created and renewed only by a valid
  pre-expiry bootstrap-session proof, never by sync or client time; expiry immediately hides the
  profile, pauses every source, and rejects Ingest even before cleanup. During the 30-day terminal
  grace only first-passkey or GitHub promotion succeeds, and promotion leaves the profile
  hidden/paused until explicit passkey-protected recovery. After grace, the separate bounded
  Jobs-only system-expiry capability is idempotent, cannot accept a sync key or fabricate a user
  deletion request, follows the deletion/retention lock order, and has restore-replay evidence.
  Invite admission produces exactly one reservation/challenge under concurrency and releases only
  the same still-valid reservation on expiry. External proof admission produces exactly one local
  consumption/challenge under concurrency, retains no raw token, and cannot be rolled back or reused
  after failure. Completion consumes the exact challenge and creates one profile/source/first-device
  binding atomically; a replayed or cross-domain signature, missing admission, second enrollment by
  the same key, and bulk admission bypass are rejected. Loss before promotion is unrecoverable but
  converges to terminal cleanup rather than an indefinite orphan; after promotion the bootstrap key
  is terminal.
- GitHub identity: fresh device-flow enrollment requires beta admission, first-device key
  possession, and atomic unique profile/source/first-device creation. A profile with no passkey can
  establish a basic session and consume a fresh same-ID device-flow transaction plus an action-bound
  WebAuthn challenge to register exactly its first passkey. Activation sets monotonic
  first-passkey-complete state. Replays, wrong-ID flows, parallel authorities, authority expiry,
  attempts to reissue after activation, reset after revoking every passkey, and GitHub-as-recovery
  attempts are denied. Anonymous upgrade requires the bootstrap proof while no passkey exists or a
  fresh passkey after promotion. A GitHub ID collision returns one generic result with zero
  mutation; no automatic merge, source transfer, score transfer, or session replacement is
  permitted. Successful upgrade preserves the existing profile/history, retires the bootstrap key
  atomically, and leaves a no-passkey profile eligible for the bounded GitHub first-passkey path.
- Passkey-for-critical: basic participation works without a passkey; every critical action is
  rejected without a fresh step-up. An anonymous profile with an active passkey can add or manage a
  source/device without linking GitHub.
- Adopted practices: dry-run shows the exact ordered single-source/single-season payloads before
  send; fixed-clock Sunday, Monday, Tuesday, exact Wednesday 00:00 UTC, and delayed-request cases
  prove that backfill derives eligibility per date, sends current and previous ISO seasons
  separately, excludes closed/finalized seasons, and cannot quarantine current-season dates because
  a previous-season request crossed its grace deadline. `submit all` sends at most one independently
  signed source/season request at a time, keeps each request within existing bounds, reports
  independent outcomes, and rejects cross-source signing. The payload schema rejects model names,
  session counts, and provider-shaped raw components.
- Optional MCP: if implemented, pairing-bound submission is still enforced; an MCP client cannot
  submit for a source it does not own or make an unsupported accounting schema valid (VR-MCP-001
  from ADR 0068 still holds).
- Cross-cutting: updated threat model (anonymous sybil), abuse cases, privacy data map (minimal
  canonical daily total), and security invariants.

## References

- [ADR 0068](0068-multi-agent-token-leaderboard-and-mcp.md) — multi-agent token accounting,
  leaderboard, and optional MCP direction.
- [ADR 0001](0001-community-trust-tier.md) — Community-only launch and disabled Verified tier.
- [ADR 0003](0003-identity-step-up-and-device-authority.md) — identity, step-up, and device
  authority (refined here).
- [PROJECT_PLAN.md](../PROJECT_PLAN.md) — canonical plan updated by this direction.
- [SECURITY_INVARIANTS.md](../architecture/SECURITY_INVARIANTS.md),
  [THREAT_MODEL.md](../security/THREAT_MODEL.md), [ABUSE_CASES.md](../security/ABUSE_CASES.md),
  [PRIVACY_DATA_MAP.md](../security/PRIVACY_DATA_MAP.md) — to be updated as each part ships.
- The Model Context Protocol (MCP) specification for optional agent-native submission; its
  documentation host is not on the reviewed external-link allowlist and is intentionally not linked.
