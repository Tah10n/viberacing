# Abuse cases

This catalog turns the [threat model](THREAT_MODEL.md) into product and operational scenarios. It
contains public control shapes, not live rate limits, detection signatures, incident evidence, or
production capacity. Every implemented surface maps applicable cases to negative tests, alerts, and
an owner before public beta.

## Accepted-risk boundary

Community activity is self-reported. A user who controls a computer can fabricate usage, share a
device, create several GitHub identities, or declare the same Codex account as several sources. The
product contains rather than “solves” that behavior: no reward or privilege depends on score, source
count is visible, all sources share one profile daily cap, and Verified ingestion is unreachable.

The same behavior becomes a security or abuse defect when it crosses another profile, bypasses the
profile cap, gains authority, reaches Verified state, evades deletion/revocation, or creates
material availability cost.

## Identity, source, and scoring abuse

### VR-ABUSE-IDENTITY-SYBIL — Many enrollment identities

- **Attacker:** A person or automation controlling several upstream GitHub identities.
- **Preconditions:** Enrollment is available and the attacker can obtain or redeem invitations.
- **Abuse:** Create many profiles to occupy leaderboard positions, scrape invitations, or consume
  capacity.
- **Impact:** Reputation noise, invite depletion, moderation load, and infrastructure cost; no
  direct privilege if the Community boundary holds.
- **Controls:** Default-off enrollment, invite-only rollout, upstream immutable GitHub ID binding,
  one profile per ID, server-side Turnstile checks, private fair-use controls, and no score-backed
  benefit.
- **Detection:** Bounded enrollment telemetry, invite redemption anomalies, correlated source
  growth, and capacity alerts without publishing evasion thresholds.
- **Recovery:** Pause enrollment, revoke affected invites, hide abusive profiles, and preserve a
  minimal audited reason.
- **Current evidence:** ADR 0060 requires exact `VIBERACING_ENROLLMENT_ENABLED=true` independently
  in both enrollment pages, all four GitHub/initial-passkey route modules, and all four service
  methods. Disabled EN/RU pages omit both forms, and HTTP/service checks stop before private work.
  Returning login and restricted recovery stay available. This is a local module-load control, not
  distributed attempt policy, deployed worker coordination, invite revocation, or proof that
  already-running enabled requests were terminated. ADR 0061 separately permits only bounded Jobs
  cleanup after every retained enrollment authority expires. ADR 0063 includes that exact object in
  a default-off local hourly catalog, fixed-clock synthetic scheduler/PostgreSQL composition, an
  injected lifecycle path that settles an active real-runner call without starting the later job,
  and one real-clock emitted startup path through its terminal catalog marker. It does not prove
  OS-signal delivery, emitted-child controller settlement before forced termination, a recurring
  timer callback, or deployed cadence.
- **Residual risk:** Vibe Racing cannot prove one human per GitHub account.

### VR-ABUSE-SOURCE-DUPLICATION — Duplicate declared Codex sources

- **Attacker:** An enrolled user controlling their devices and source choices.
- **Preconditions:** The profile may create or attach more than one opaque CodexSource.
- **Abuse:** Represent the same real Codex account as separate sources so its reported usage is
  summed more than once.
- **Impact:** Higher Community score up to the profile cap and reduced leaderboard credibility.
- **Controls:** Honest Community labeling, explicit source count, profile-level cap after
  aggregation, creation budgets, and no claim of global account uniqueness.
- **Detection:** Source-growth and repeated-pattern signals may quarantine records but never relabel
  them Verified.
- **Recovery:** Pause or unlink sources, recompute an open season, and use an audited correction
  only when policy permits.
- **Current evidence:** The account page can pause an exact owned source immediately and reactivate
  only a paused source after a fresh required-UV passkey assertion. Raw source IDs stay server-only;
  the encrypted source-control token is session-bound and expires within 15 minutes. Quarantine
  remains outside normal reactivation authority. A distinct fresh context can terminally unlink an
  active, paused, or quarantined source and revoke all of its active devices without publishing a
  hidden profile. ADR 0058 additionally keeps new-source UI, approval initiation, and approval
  completion default-off unless the page and both approval modules resolve exact enablement. Active
  existing-source pairing remains available; this local gate is not a distributed source budget,
  deployed worker control, or proof of external route denial.
- **Residual risk:** Duplicate declarations remain possible without a server-verifiable upstream
  account identifier.

### VR-ABUSE-USAGE-FORGERY — Fabricated or inflated token buckets

- **Attacker:** A computer owner or modified connector.
- **Preconditions:** The attacker controls signed payload content for their own registered source.
- **Abuse:** Submit invented values, impossible ranges, decreases, or suspicious jumps.
- **Impact:** Community rank manipulation and operational review cost, but no authorization or
  monetary impact.
- **Controls:** Integer/date/size bounds, monotonic open-season state, quarantine instead of blind
  maximum, profile cap, server-derived score, and reward-free ranking.
- **Detection:** Rejection and quarantine metrics, bounded anomaly signals, and source-level audit.
- **Recovery:** Exclude quarantined values, allow a reasoned open-season correction, and keep
  finalized corrections separately authorized and audited.
- **Current evidence:** Revision 0007 rejects malformed or out-of-range input, quarantines a whole
  decrease or quarantined-source snapshot, and prevents current source/day state from decreasing.
  Revision 0009 excludes quarantined sources and derives open-season score only after one profile
  cap across eligible distinct sources. Revision 0010 also quarantines the whole late snapshot so it
  cannot change accepted historical state. The local Ingest kernel now validates the bounded exact
  request and source-bound device signature, and the local adapter proves only the closed submission
  mapping, but neither intentionally makes a usage-honesty claim. Suspicious-jump policy, live
  HTTP/database service execution, and correction authority remain unimplemented.
- **Residual risk:** A plausible forged value inside public bounds may be indistinguishable from an
  honest local reading.

### VR-ABUSE-SEASON-RACE — Duplicate or late mutation of season state

- **Attacker:** A malicious client or normal retries exploiting concurrency and timing.
- **Preconditions:** Parallel sync, job retry, retention cleanup, or a request near the
  grace/finalization boundary.
- **Abuse:** Double-count a source/date, reopen a closed season with client time, delete scoring
  input before terminal projection, or apply a job more than once.
- **Impact:** Persistent ranking corruption and loss of audit confidence.
- **Controls:** Unique source/date state, transactions, idempotency, server receipt time, versioned
  scoring, and database-enforced finalized immutability.
- **Detection:** Constraint violations, idempotency collisions, boundary-time metrics, and
  finalization reconciliation.
- **Recovery:** Idempotent rerun before finalization or a separately authorized correction record
  after finalization.
- **Current evidence:** Revision 0007 enforces one device/sync snapshot, one source/date current
  value, server-time freshness, and observed exact-retry/same-source device races. Revision 0009
  adds immutable formula/season definitions, atomic replacement of one open-season materialization,
  and an observed two-Jobs serialization race whose reruns converge on identical semantic state.
  Revision 0010 enforces the exact 48-hour server grace, terminal metadata/projection triggers,
  refresh denial after finalization, and an observed finalization-versus-late-Ingest race. That race
  exposed and then verified the canonical deadlock-free `season → profile → source → device` lock
  order; a second observed race proves opposing multi-season payload orders both lock seasons in
  ascending order. Revision 0039 captures a bounded UTC-day/count projection at finalization and
  admits exact source/day deletion only after 30 days, repeated live/captured inventory checks, and
  the existing scoring/Ingest-retention/profile-purge mutex order. Worker and finalization races
  preserve public freshness and prevent an open or newly finalized season from becoming eligible. A
  local one-shot Jobs runner now admits only canonical refresh/finalization commands, probes the
  exact role/login boundary, calls one prepared function, holds one client through settlement, and
  discards invalid results. The shared synthetic integration runs both emitted scoring commands
  through a disposable narrow login, rejects an extra-membership login, and checks open/finalized
  database state. ADR 0063 separately derives only the current and latest grace-eligible Monday from
  UTC time, marks slots before sequential invocation, prevents overlap and same-slot retry, and
  bounds shutdown. A second opt-in integration composes that production core under fixed injected
  UTC time with the real runner and disposable PostgreSQL. A third composes the production process
  lifecycle, starts the penultimate real-runner call before injecting its first handler, and proves
  that call settles without starting the later job. A fourth starts the built entry point under real
  host time, reaches the terminal startup-catalog marker without process output, then forcibly ends
  only its persistent test child. OS-signal delivery, emitted-child controller settlement before
  forced termination, correction authority, recurring timer-callback results, deployed scheduling,
  production database login/TLS, historical backlog recovery, and operational reconciliation remain
  unimplemented.
- **Residual risk:** Operational bugs can still require a visible correction; silent history rewrite
  is never acceptable.

## Pairing, device, and connector abuse

### VR-ABUSE-PAIRING-GUESS — Pairing code guessing or swapping

- **Attacker:** A remote client or nearby person who sees or guesses a short user code.
- **Preconditions:** A live device authorization transaction exists.
- **Abuse:** Approve the attacker's public key, swap source choice, or race the legitimate browser.
- **Impact:** Durable unauthorized submission authority for the selected source.
- **Controls:** One-time high-entropy poll token with a server-side keyed verifier, immutable
  pending public key, short-lived user code and challenge, bounded attempts, exact key/transaction
  display, authenticated GitHub session, fresh passkey approval, Ed25519 possession proof, and one
  independent default-off route gate. The poll token alone cannot approve or activate a device.
- **Current evidence:** Revision 0003 proves immutable key/challenge/poll-verifier binding, exact
  browser-approved state, wrong-poll denial, one-time activation, and lifecycle races at the SQL
  boundary. ADR 0026 adds one exact domain-separated transaction/challenge/public-key message, an
  inaccessible Rust signer, and a strict pure Web verifier. Their shared synthetic vector rejects
  changed IDs/challenges/keys/signatures, malformed shapes/encodings, zero material, and caller
  mutation. ADR 0027 adds exact 32-byte canonical poll tokens, protected primary/secondary
  HMAC-SHA-256 verifier derivation, a fixed two-candidate approved-material lookup through a probed
  read-write Web pool, mandatory strict proof, server-owned activation IDs, four-call admission, a
  250-millisecond settlement floor, and one generic local failure decision. ADR 0028 adds a closed
  transport-free start request, fresh server IDs, 32-byte poll/challenge material, a 60-bit human
  code, separate protected poll/code HMAC keys and primary verifiers, a nine-minute expiry, a fixed
  database call, four-call admission, and generic local failure. Revision 0021 and the local
  `/connect` flow add exact-session primary/secondary code lookup, a persisted attempt window shared
  across Web instances, bounded device/fingerprint rendering, explicit fresh-passkey approval, and
  one atomic new-source or active existing-source action. The browser uses only an encrypted
  session-bound source control, while the fixed database function rechecks source ownership and
  state and binds the exact choice against swapping. Malformed and non-matching codes return the
  same generic decision. ADR 0030 adds exact bounded start/poll routes, one shared four-call
  service, a native-store Rust client, and revision 0022's fixed operation-global plus 64-bucket
  rate windows. The client ID is self-asserted rate shaping only; rotating it still consumes the
  global row and creates no database row. ADR 0057 requires exact `VIBERACING_PAIRING_ENABLED=true`
  at each connector/browser pairing route module; disabled POST cancels an available body and
  reaches no parser, runtime/service, admission acquisition, protected key, WebAuthn, or database
  work. ADR 0058 separately requires exact source-creation enablement for `new` at the page plus
  both approval steps. It preserves active existing-source pairing, binds the exact choice into the
  sealed challenge and v2 digest, and blocks in-flight new-source completion after a disabled module
  reload. Neither gate proves deployed/dynamic route denial. Revision 0037 separately lets only Jobs
  reset a positive aggregate timestamp/count after the maximum one-hour window while preserving
  every fixed row and accepting no caller-selected scope. Revision 0013 adds a separate Jobs-only
  1-to-1000 cleanup for expired `pending`, `approved`, and `cancelled` transactions plus their exact
  still-pending keys; activated bindings and live rows are excluded. Live login/TLS integration,
  trusted edge controls, capacity evidence, deployed cleanup cadence, cross-platform execution, and
  release remain absent. Fixed-clock synthetic scheduler/PostgreSQL cleanup composition is proven.
- **Detection:** Failed-code and concurrent-approval events, device/source binding audit, and user
  device inventory.
- **Recovery:** Revoke the device, rotate source device authority where needed, and notify the
  profile through a non-sensitive channel.
- **Residual risk:** A user can knowingly approve the wrong device; the confirmation screen must
  make the binding understandable.

### VR-ABUSE-DEVICE-KEY-THEFT — Stolen device signing key

- **Attacker:** Malware or another local account able to extract credential-store material.
- **Preconditions:** A registered device private key is compromised.
- **Abuse:** Submit signed Community usage, replace a pending enum-only car proposal, or replay
  requests as that device.
- **Impact:** Source-level score manipulation, pending-presentation replacement, and request cost
  until revocation; no recipe activation or profile administration.
- **Controls:** OS credential store with no plaintext fallback, source-bound scope, nonce and
  idempotency checks, proposal-only browser review, version visibility, server revoke, bounded local
  credential removal, and rotation.
- **Detection:** Signature source, replay, platform/version, and unusual activity signals;
  user-visible device inventory.
- **Recovery:** Immediate device revoke, optional source key rotation, quarantine affected
  open-season records, and audited investigation.
- **Current evidence:** PostgreSQL verifies exact device/source binding, nonce/idempotency replay,
  revoke rejection, and revoke-versus-submit ordering. The local Ingest kernel verifies the exact
  body-bound request under strict Ed25519 semantics, takes unknown devices through a valid dummy-key
  path, compares the lookup source, and rejects the observed zero-key/zero-signature bypass. The
  local adapter proves the fixed lookup/submission mapping and relies on the procedure to close a
  revoke race. A signed synthetic request now proves the transport-free verifier-to-adapter order,
  settlement, and generic acknowledgement through a mock pool. The connector's isolated one-use
  signer now consumes an inaccessible device-bound capability, rejects a different device ID, signs
  only the exact prepared message, and shares a strictly verified synthetic signature with Ingest.
  The local account page now maps only the possessed session's active device credentials under the
  64-authority ceiling and sends one opaque device ID through an exact same-origin revoke form.
  PostgreSQL proves inventory and revoke remain available while public visibility is hidden;
  cross-profile IDs and replay stay closed. The separate pairing signer/verifier now proves only
  synthetic pending-key possession. The bounded connector now generates the pairing key from the OS
  CSPRNG, stores one versioned record only in the native credential store, and clears pending bearer
  material after local activation/expiry. Exact HTTP start/poll and retry-safe activation are
  locally tested. A separate opt-in synthetic gate now carries independently signed requests through
  the emitted host and a disposable least-privileged PostgreSQL login, proving accepted/duplicate,
  persistent replay, revoked-device denial, and exact stored state. ADR 0041 adds one idempotent
  `forget-local` command that deletes only the exact native origin/label entry without loading it or
  contacting the service, and warns that it did not revoke server authority. Key rotation, metrics,
  cross-platform runtime evidence, deployment credentials/TLS, release, edge routing, and real-user
  operation remain unimplemented. ADR 0038 separately binds an exact enum recipe body, fresh
  nonce/time, and device ID under another signature domain. Web performs dummy-key work for unknown
  devices, and revision 0028 rechecks active profile/source/device state before replacing only the
  pending recipe; browser approval remains mandatory. ADR 0059 keeps that device POST and browser
  creation/approval default-off; disabled device requests stop before signature/service/database
  work, while private browser review and exact rejection remain available.
- **Residual risk:** Request signatures cannot distinguish the legitimate connector from malware
  using the same unlocked local identity. Local deletion cannot erase copied key material and does
  not stop it until the registered server device is separately revoked.

### VR-ABUSE-DEVICE-ESCALATION — Device credential used as profile authority

- **Attacker:** A malicious connector or holder of a stolen device key.
- **Preconditions:** The service accepts device-authenticated requests.
- **Abuse:** Attempt to add devices, issue invites, unlink sources, change recovery, approve or
  activate a car, delete a profile, or reach admin functions through proposal-only authority.
- **Impact:** Account takeover or destructive cross-capability access.
- **Controls:** Separate routes and principals, deny-by-default device scope, fresh user-session
  passkey step-up, database capability separation, and IDOR tests.
- **Detection:** Authorization-denial metrics and audit for every sensitive attempted transition.
- **Recovery:** Revoke device authority, inspect affected profile state, and correct only through
  the user/admin audited path.
- **Current evidence:** The Ingest role can execute only device verification lookup and Community
  submission, has no direct table access, and is denied every current identity/lifecycle sample; the
  role matrix is exercised in real PostgreSQL. The pure verifier exposes only request verification
  and an allowlisted submission result; it owns no profile, pairing, recovery, passkey, admin, or
  database capability. ADR 0038 adds a separate Web route whose device authority reaches only
  minimal key lookup and pending-recipe replacement; it returns no proposal ID/state and has no
  approve/reject/activate call. The Web-role SQL function rechecks the active source-bound device,
  while every non-Web role is denied. The confined Ingest HTTP server exposes only the sync POST
  plus closed route/method failures, and the full synthetic loopback gate reaches only the three
  reviewed Ingest procedures. The local credential-removal command has no network or signer
  capability and cannot inspect, revoke, or administer server state.
- **Residual risk:** A future endpoint can accidentally reuse the wrong middleware; a scope matrix
  is required in CI.

### VR-ABUSE-CONNECTOR-LOCAL — Hostile local process or execution context

- **Attacker:** A local user, replaced Codex binary, hostile JSONL producer, writable path, or
  poisoned scheduler/environment.
- **Preconditions:** The connector launches or communicates with a local process.
- **Abuse:** Substitute an executable, exploit parsing, flood stdout/stderr, hang shutdown, inject a
  shell argument, or induce upload of prohibited fields.
- **Impact:** Local code execution under the user, resource exhaustion, key theft, or prompt and
  credential disclosure.
- **Controls:** The implemented library foundation has one fixed stable initialization exchange,
  then a candidate-only `0.144.5` account/usage state machine with fixed IDs/methods, 16 KiB LF-only
  frames, closed duplicate-rejecting fields, exact order, terminal hostile input, discarded
  account/summary values, 31 bounded normalized daily entries, and non-reflective errors. A one-shot
  supervisor now uses one fixed `app-server` argument, local pipes, a capability-owned working
  directory and allowlisted environment with ambient variables cleared, three bounded stdout frames,
  discard-only bounded stderr, fixed response/lifetime deadlines, terminal-event draining, and
  reap-before-success cleanup. A composer then accepts only production-normalized usage and an
  inaccessible reviewed context, revalidates every body and unsigned device-header input it owns,
  and fixes the exact JSON/digest/device-message bytes shared with Ingest. An isolated one-use
  signer removes public unsigned access, rejects a key capability bound to another device, signs
  only the fixed message, and returns the same body plus five header values. The Windows x86_64
  development sync command validates an active native record before selecting only two fixed
  executable names through at most 64 absolute `PATH` directories and four exact-size hashes, or
  accepting the explicit path fallback. Both require the same canonical exact artifact size/digest,
  retain the file against write substitution, create fresh context, and send one
  no-proxy/no-redirect/no-retry request to the fixed endpoint. The pairing command supplies OS key
  generation/native custody and only the two exact bounded start/poll paths. The separate
  `forget-local` command can only delete one derived native-store account, uses identical output for
  present and absent entries, and explicitly distinguishes that action from server revoke. The
  separate `check-codex` command reuses only exact candidate admission, releases the handle, and has
  no credential-store, child-process, account, persistence, or network capability. Its fixed success
  text explicitly preserves unsupported status, and failure reflects no path or operating-system
  detail. Its opt-in v1 preview adds only compile-time versions, fixed platform contract, a closed
  admission class, and empty support state. Failed admission remains nonzero; local values remain
  absent, and the connector can neither save nor send the preview. A separate release-profile smoke
  exclusively copies the repository-built connector to a random bounded temporary root, runs only
  exact help and missing-candidate behavior with no ambient credential/network environment, rechecks
  source/copy digests and inventory, and removes the copy. The operational connector still requires
  other-platform evidence, automated support-export review, broader release diagnostics, real
  packaging/lifecycle, provenance, release, and clean-machine privacy evidence.
- **Detection:** The local candidate check reports exact success or a stable generic failure without
  uploading content. Its explicit preview provides only one reviewed redacted class for user
  inspection. Release provenance, packaged-binary, broader failure-recovery, and real child-cleanup
  diagnostics remain separate gates.
- **Recovery:** Stop and clean the child, disable scheduling, reject sync, restore a verified
  binary, revoke the registered device after suspected compromise, remove the exact local
  credential, and rotate the device key when that lifecycle exists.
- **Residual risk:** A computer owner can replace all local components; official signing and clear
  diagnostics reduce accidental compromise, not owner control. Candidate schema/admission tests do
  not prove protected clean-machine provenance, real Codex account execution, cross-platform
  behavior, or release integrity. The synthetic supervisor tests prove bounded mechanics only and do
  not make the version supported. The shared signed vector and loopback POST prove synthetic byte,
  cryptographic, and transport agreement only; they do not prove real-user privacy or deployment.

## Web, privacy, and content abuse

### VR-ABUSE-AUTH-TAKEOVER — OAuth, session, passkey, or recovery abuse

- **Attacker:** A remote attacker with a crafted callback, stolen session, replayed ceremony, or
  recovery material.
- **Preconditions:** An enrollment, login, recovery, or step-up flow is active.
- **Abuse:** Bind the wrong GitHub identity, fix a session, replay a challenge, or skip user
  verification for a critical action.
- **Impact:** Profile takeover, device binding, source unlink, privacy change, or deletion.
- **Controls:** Default-off enrollment, state, PKCE, exact redirect, one-time code handling, secure
  session rotation, exact RP ID/origin, transaction-bound challenges, user verification, exact
  session/passkey provenance, fresh step-up, last-passkey protection, restricted recovery authority,
  and terminal credential revoke that closes stale browser and pending device authority.
- **Current evidence:** The local identity slice accepts only one exact same-origin bounded form,
  immediately reduces the 256-bit invite secret to its digest, seals state and S256 PKCE in a
  ten-minute callback-path cookie, requests no extra OAuth scope, follows no upstream redirect, and
  retains only a positive numeric GitHub ID. Purpose-separated AES-GCM cookies reject tampering and
  duplicate names. Initial registration creates one session-bound five-minute challenge and requires
  a discoverable credential, user presence and verification, exact `webauthn.create`, RP ID, origin,
  challenge, and ES256/RS256 verification before atomic activation. Success rotates the 15-minute
  pending session to a fresh passkey-bound session and revokes the old verifier in the same query.
  Both enrollment pages and all four GitHub/initial-passkey route modules require exact
  `VIBERACING_ENROLLMENT_ENABLED=true`; disabled pages omit their forms, HTTP stops before
  request/runtime/admission/private work, and all four service methods repeat the decision before
  input/cookie/OAuth/WebAuthn/database work. Active-session redirects, returning login, restricted
  recovery, logout, and account security actions are intentionally independent. This does not clear
  existing continuations or prove deployed/dynamic operation. Returning-login options create no
  database state and seal only a profile-free five-minute challenge under a separate purpose key.
  Verification looks up only minimal active credential material, requires exact `webauthn.get`, RP
  ID, origin, challenge, UV, signature, counter, and backup semantics, then atomically creates and
  consumes the database challenge, advances credential state, and mints a fresh passkey-bound
  session. A post-commit cookie-sealing failure compensates by revoking that session. Route bodies
  are stream-bounded under admission held through settlement; overload cancels the body without a
  queue. Responses are generic/no-store/no-referrer, and the CSP permits only self plus GitHub for
  OAuth form navigation. Injected tests cover wrong state, origin, RP, type, UV, replay-shaped
  failures, cookie ambiguity, overload, continuation-before-write ordering, database-free login
  options, atomic completion, and compensation. The account revoke path accepts only an owned
  non-current active target from the session-derived inventory, binds a five-minute challenge and
  sealed continuation to that session/target/RP/origin context, requires a fresh exact user-verified
  assertion, and atomically consumes the challenge with terminal revoke. Tests cover current/foreign
  targets, closed body shapes, target binding, and replay-shaped database failure. The add path
  validates and seals the label before prompts, uses distinct five-minute existing-key assertion and
  registration challenges, verifies both exact ceremonies, and atomically consumes the
  session/profile/label/RP/origin-bound step-up while inserting the new credential. Closed shapes,
  mixed challenge-cookie types, replay-shaped failure, retained-record cap, and duplicate
  credentials fail closed. Recovery-code rotation binds a separate five-minute challenge to the
  exact active session/profile/RP/origin, requires a fresh exact assertion, derives ten independent
  Argon2id PHCs sequentially under a recovery-only protected pepper, and atomically consumes the
  challenge while replacing every previous code and active authority. Only commit returns the
  plaintext batch in a no-store response; the page holds it only in memory for one display.
  Cross-session, malformed, replay-shaped, and invalid-generator outcomes fail generically. The
  deletion path accepts only the session's exact typed handle before prompting, binds a five-minute
  fresh assertion to session/profile/handle/RP/origin, and uses one statement to consume the
  challenge with the existing atomic hide/revoke/unlink/enqueue call. Source pause accepts only the
  encrypted session-bound control token through a same-origin form. Reactivation binds a fresh
  required-UV assertion to the session, source, RP ID, and origin, then atomically consumes the
  challenge and reactivates only `paused`; tests reject token tampering, cross-session use,
  replay-shaped failure, quarantine, and malformed request shapes. A distinct fresh context
  atomically unlinks only active, paused, or quarantined owned sources and recursively revokes
  active source devices. All source controls remain available while the profile is hidden without
  publishing it. Local recovery verification now parses only the exact code, obtains one selected
  PHC, performs matching or dummy bounded Argon2id work under a protected pepper, returns generic
  admitted failures behind a configured floor, and grants only a five-minute replacement-passkey
  continuation. Exact WebAuthn verification and one atomic completion are required before a normal
  session exists. Revision 0023 now deletes expired challenges and restricted recovery authority in
  bounded profile-serialized Jobs batches while preserving live/unused state. Revision 0035 can
  delete only revoked passkeys at least 180 days old after every exact session, challenge, and
  pairing reference is absent; tests prove recovery first fails atomically at 32 retained rows and
  succeeds unchanged after cleanup removes only eligible rows. Aggregate edge rate policy, cleanup
  scheduling, notification, live OAuth/authenticator/database integration, cache/backup/tombstone
  purge, restore replay, and deployment remain absent. Revision 0024 locally executes only bounded
  primary deletion. The account read additionally revalidates exact session possession and accepts
  at most 32 closed, ordered rows with one current active authenticator; it renders no credential
  ID, key, sign counter, exact activity timestamp, or profile ID. Only a revocable target's opaque
  passkey ID enters the authenticated control and options request.
- **Detection:** Failed and replayed ceremony events, sign-counter risk signals, identity-binding
  changes, recovery use, and sensitive-action audit without credential material.
- **Recovery:** Revoke exact passkeys, sessions, and devices; restore control only through a
  restricted recovery flow; rotate recovery material; and inspect destructive actions.
- **Residual risk:** Compromise of all registered passkeys and recovery material may require a
  manually governed recovery path with strong anti-social-engineering controls.

### VR-ABUSE-RECOVERY-ORACLE — Recovery enumeration, replay, or authority expansion

- **Attacker:** Anonymous automation, a holder of one stolen recovery code, or a compromised
  Web/Auth runtime role.
- **Preconditions:** Recovery lookup or completion is reachable, or an unused recovery code is
  disclosed.
- **Abuse:** Enumerate selectors, distinguish known profiles by response or timing, brute-force
  returned PHCs, reuse a consumed code, race code rotation, replay a registration ceremony, or use
  recovery authority as a normal session or device-administration credential.
- **Impact:** Profile takeover, targeted account discovery, recovery denial of service, or durable
  unauthorized browser/device authority.
- **Controls:** High-entropy opaque selectors and secrets, Argon2id with protected deployment
  pepper, bounded body/collection shapes, generic unknown/used responses and timing, edge/service
  attempt limits, immediate PHC scrub, one active authority per profile for at most ten minutes,
  exact challenge/context binding, no session before replacement WebAuthn, and profile-serialized
  rotation/completion that dominates old-code start and old-passkey login, a 32-retained-passkey
  ceiling, and bounded cleanup only for aged unreferenced revoked rows.
- **Detection:** Coarse lookup failure and saturation metrics, recovery start/completion audit
  without selectors or verifier material, unusual code rotation, and repeated completion failure
  signals.
- **Recovery:** Disable only the recovery endpoints, rotate the code batch from an existing passkey,
  revoke affected sessions/passkeys and explicitly review activated connectors, then restore the
  bounded flow after investigation.
- **Residual risk:** The database trusts Web/Auth to report Argon2id and WebAuthn success. A
  compromised service role can misuse its recovery procedures until credentials are rotated or the
  service is isolated; database scope limits but cannot remove that trust. The local four-call
  admission, configured response floor, and unscheduled bounded expiry cleanup do not replace a
  distributed edge attempt policy, notification, monitoring, or live capacity evidence.

### VR-ABUSE-PUBLIC-SCRAPE — Profiling work habits from public data

- **Attacker:** A visitor or scraper collecting public profiles over time.
- **Preconditions:** Public ranking and profile fields are available.
- **Abuse:** Correlate exact sync time, token totals, GitHub identity, and activity to infer a
  person's schedule or workload.
- **Impact:** Privacy harm, unwanted profiling, or harassment.
- **Controls:** Exact totals private by default, freshness rounded to a day, optional GitHub link,
  minimal public fields, hide control, cache purge, and rate policy.
- **Detection:** Scrape and enumeration patterns at the edge without invasive behavioral analytics.
- **Recovery:** Hide the profile immediately, purge public caches, delete on request, and
  investigate bypass of non-public fields.
- **Current evidence:** Revision 0011 returns only ten reviewed score fields, excludes private IDs,
  raw/daily values, and exact timestamps, filters current profile state to `active`, and re-ranks
  after that filter. `CommunityScorePageV1` preserves the same allowlist, fixes Community and
  self-reported trust metadata, and rejects unknown/private fields. Its server-only mapper requires
  the exact SQL column set and never reflects projected values in mapping errors. The server-only
  adapter selects only those columns with a fixed top-32 parameterized call and reflects no input,
  row, SQL, configuration, or driver error. The stable local GET closes one public Monday season
  query, body/method/media handling, no-store/same-origin semantics, admission, generic errors, and
  final response validation. Revision 0027 and `CommunityRacePageV1` add a separate compatible route
  that repeats those fields and may include only one exact current active enum recipe; proposal
  state and timestamps remain private. Revision 0029 and `CommunityRaceStatusPageV1` add a third
  compatible route that derives complete-UTC-day freshness from accepted server receipt time and
  exposes a consecutive positive-score streak only when the active profile enables it. Exact
  timestamps, daily score rows, the preference, and private IDs remain absent. The visible browser
  consumer lazily validates that complete status response, uses fixed project-owned presentation
  cars for recipe absence, sends no credentials, and falls back to explicitly synthetic rows after
  any invalid or unavailable response. ADR 0056 keeps all three GET compositions unavailable unless
  exact `VIBERACING_PUBLIC_RANKING_ENABLED=true` was resolved at module load; every alternate state
  returns generic 503 before query/header parsing, admission acquisition, or store work. It does not
  prove deployed route/cache denial, worker reload, or scraping protection after enablement.
  Revision 0015 lets only the exact possessed session read and set the closed `public`/`hidden`
  state; the same-origin form carries no profile ID and repeated state is a no-op. Because the
  public read already filters current state, a committed hide removes the profile from the next
  no-store response while source sync may continue. Deployment, enumeration controls, cache purge,
  edge rate policy, query-plan/load evidence, and monitoring are still unimplemented.
- **Residual risk:** Any intentionally public score and active-day history can be observed and
  archived by others.

### VR-ABUSE-HANDLE-IMPERSONATION — Misleading or abusive public identity

- **Attacker:** An enrolled user choosing a confusing, abusive, or brand-like handle.
- **Preconditions:** Handle creation or change is allowed.
- **Abuse:** Impersonate another participant, evade moderation with Unicode, inject markup, or claim
  OpenAI/project endorsement.
- **Impact:** Harassment, deception, brand confusion, or browser injection if rendering is unsafe.
- **Controls:** Bounded normalization, reserved names, plain-text rendering, no HTML, optional
  verified GitHub link shown separately, moderation state, and conduct policy.
- **Detection:** User reports and normalization collision checks; no broad content surveillance.
- **Recovery:** Rename or hide the profile through an audited action and preserve only the minimum
  abuse-prevention record.
- **Residual risk:** Similar-looking names cannot be eliminated without collecting stronger identity
  evidence that the product does not need.

### VR-ABUSE-CAR-INJECTION — Executable or remote content in customization

- **Attacker:** A user, connector, or agent proposing a crafted car configuration.
- **Preconditions:** A CarRecipe proposal endpoint exists.
- **Abuse:** Submit markup, script, URL, path, arbitrary color, oversized seed, unknown enum, or
  unlicensed asset.
- **Impact:** XSS, SSRF, supply-chain content, nondeterminism, privacy leak, or legal exposure.
- **Controls:** Versioned enum-only schema, project-owned assets, strict server validation, browser
  preview, explicit user approval, exact-session PostgreSQL authority, opaque decision control,
  forced RLS, a one-command agent workflow with shell-safe inputs, and deterministic snapshots.
- **Current evidence:** Contract, HTTP/service, mapper/pool, renderer, role-denial, IDOR, replay,
  replacement, approval/rejection, hidden-profile, profile-purge, and separate public race tests
  pass locally. The stable score response rejects `carRecipe`; the race response rejects malformed
  or arbitrary nested content and exposes no proposal state. The dedicated device route and fixed
  connector command share one exact body/signature vector, reject prompt/free-text/unknown fields,
  stale or replayed proof, inactive authority, and can replace only pending state. The local Agent
  Skill reduces styling intent to the canonical enums, rejects unsafe shell input, calls only that
  command once, and has eleven fail-closed checker mutations. It never approves or activates. ADR
  0059 additionally requires exact enablement for both proposal origins and browser approval before
  request or state work; disabled EN/RU UI preserves private review/reject and omits editor/approve.
- **Detection:** Schema rejection metrics, generated-asset drift, provenance and license review;
  operational metrics and alerting are still pending.
- **Recovery:** Reject or disable the recipe/version, restore a safe default, and remove invalid
  generated artifacts.
- **Residual risk:** Project-owned combinations may still resemble protected trade dress and need
  visual review.

### VR-ABUSE-REPORT-DISCLOSURE — Sensitive data posted to public support

- **Attacker:** Usually an accidental reporter; potentially someone publishing another person's
  data.
- **Preconditions:** Public issue, pull-request, discussion, or support channel is available.
- **Abuse:** Paste credentials, local paths, raw logs, screenshots, account IDs, usage, exploit
  details, or private messages.
- **Impact:** Irreversible public disclosure and possible credential compromise.
- **Controls:** Structured forms with warnings and required confirmations, no fields for contact or
  raw diagnostics, private vulnerability/conduct channels, moderation procedure, and public scans.
- **Detection:** Maintainer review and platform secret scanning; avoid echoing the content into more
  systems.
- **Recovery:** Restrict or redact using platform capability, rotate exposed secrets, notify
  affected parties privately, and retain only a non-sensitive incident reference.
- **Residual risk:** GitHub notifications and third-party archives may retain already published
  content.

## Infrastructure, administration, and supply-chain abuse

### VR-ABUSE-ORIGIN-BYPASS — Direct Railway access or forged edge identity

- **Attacker:** A network client aware of an origin route or able to send arbitrary headers.
- **Preconditions:** The service origin is reachable or forwarding trust is misconfigured.
- **Abuse:** Bypass WAF/request shaping, spoof a client address, replay an edge proof, or alter the
  body after proof generation.
- **Impact:** Unauthorized ingestion, weaker abuse controls, misleading audit, or denial of service.
- **Controls:** Cloudflare-only ingress, fresh method/path/body-bound proof, replay store, exact
  clock policy, direct-origin negative tests, and protected origin configuration.
- **Detection:** Missing/invalid proof, direct-origin probes, forwarding anomalies, and rotation
  events.
- **Recovery:** Deny the origin route, rotate proof keys, invalidate the replay window, and
  quarantine affected writes.
- **Current evidence:** The local Ingest kernel accepts one or two exact proof keys, verifies a
  method/path/exact-body/time/nonce-bound HMAC before parsing or device lookup, permits only a
  strictly younger-than-60-second age and inclusive five-second future skew, and requires one
  injected nonce-consumption result. Tests cover unknown keys, rotation, stale/future proof, replay,
  body/header mutation, and failing nonce dependencies. A protected local reader now requires one
  exact primary and at most one complete, distinct secondary key pair, constructs only the verifier,
  and has no default or checked-in value. A forced-RLS table now stores only its key-bound digest
  and expiry; one Ingest-only function atomically consumes or replaces an expired tuple, an ordered
  race yields one fresh result, and Jobs can delete bounded expired tuples. Cloudflare signing,
  secret-manager/edge key injection, Railway direct-origin denial, trusted forwarding, and
  production cleanup scheduling remain unimplemented. The local Fastify boundary preserves the exact
  body/header evidence, sets proxy trust to false, ignores inbound request IDs, and returns only
  generic contract-validated errors. The transport-free composer binds the same replay/device/
  submission adapter and maps origin rejection to one generic unauthorized decision. The separate
  host additionally requires an exact default-off enable latch before any other host/protected
  application configuration or resource. That startup gate does not prove a deployed route denial,
  dynamic disable, or old-instance drain. The local host accepts production startup only for exact
  `0.0.0.0:$PORT` with an explicit `railway-edge` declaration, but that declaration neither trusts
  forwarding nor proves the route; the origin HMAC remains mandatory. The full synthetic loopback
  gate proves an HTTP replay of the same origin nonce is rejected without another stored snapshot,
  but it does not prove an edge signer or direct-origin policy.
- **Residual risk:** Infrastructure metadata exposure can increase probing but must not be the only
  protection.

### VR-ABUSE-DATABASE-ROLE — Service or query exceeds its database capability

- **Attacker:** A compromised Web, Ingest, Jobs process, malicious input, or operator using the
  wrong role.
- **Preconditions:** A runtime reaches PostgreSQL.
- **Abuse:** Ingest edits profiles/passkeys, Web mutates finalized scores, a query injects SQL, or a
  runtime role changes schema/grants.
- **Impact:** Cross-profile compromise, credential loss, ranking corruption, deletion bypass, or
  persistent control.
- **Controls:** Separate non-owner roles, procedure-only ingest, parameterization, constraints,
  transaction boundaries, migration-only ownership, and full forbidden-capability tests.
- **Detection:** Database audit, denied grants, unusual procedure failure, migration drift, and role
  inventory.
- **Recovery:** Revoke/rotate the role, isolate the service, restore from verified state, replay
  deletions, and audit affected rows without exporting private data.
- **Current evidence:** The integration runner proves all four runtime roles lack direct identity
  and usage/scoring-table reads or API-schema mutation, and proves 64 cross-capability denials.
  Ingest has exactly three reviewed functions; Jobs has exactly seventeen reviewed functions:
  bounded authentication-, abandoned-enrollment-, audit-event-, invite-, CarRecipe-proposal-,
  ingest-, pairing-, session-, and finalized-source-day retention cleanup, terminal deletion-job
  cleanup, aged revoked-passkey cleanup, aged minimized revoked-device cleanup, pairing
  approval-provenance redaction, fixed pairing-rate-window reset, primary profile deletion,
  open-season scoring refresh, and terminal season finalization. Web alone receives the bounded
  public score and separate race functions; Ingest, Jobs, and Admin are explicitly denied. The Web
  adapter uses one dedicated pool, fixed parameterized function calls, and checks effective role,
  distinct non-privileged login, exact Web-only membership, database capability, search path, and
  read-only state before every pooled read. Failed sessions are destroyed and raw driver errors are
  not forwarded. The local Jobs adapter independently checks an exact Jobs-only login/membership,
  CONNECT without CREATE/TEMPORARY, and safe search path before exactly one of the seventeen
  prepared function calls. Its pool maximum is one, input/result shapes are closed, failed clients
  are destroyed, and CLI output reflects no configuration, command, SQL, count, or error detail. The
  separate default-off scheduler can construct only that runner, selects only a frozen maximum-17
  fixed UTC catalog, and validates each object again through the runner; it adds no SQL or database
  capability. The local Ingest adapter independently caps its pool at four, probes the exact Ingest
  login/role and safe search path before each capability, exposes only fixed parameterized origin
  replay, device lookup, and submission calls, reconstructs and revalidates inputs, copies mutable
  values, accepts only closed rows, and destroys failed clients without forwarding
  driver/configuration details.
- **Residual risk:** A migration owner is highly privileged and belongs only in a protected
  migration workflow. Web deployment login/TLS integration has not been exercised. Jobs now has a
  disposable synthetic least-privileged login, all seventeen emitted commands, a widened-login
  denial, and exact-state evidence; Ingest similarly has a disposable synthetic least-privileged
  loopback login and full HTTP integration result. Jobs additionally has fixed-clock production
  scheduler-core composition, injected process-lifecycle settlement with its disposable PostgreSQL
  boundary, and one real-clock emitted startup path through its terminal catalog marker. None proves
  OS-signal delivery, emitted-child controller settlement before forced termination, a deployment
  credential/certificate, external TLS/edge route, external audit sink, capacity, recurring
  timer-callback results, deployed scheduler operation, monitoring, or real-user behavior.

### VR-ABUSE-ADMIN-MISUSE — Privileged action without independent authority

- **Attacker:** A normal user attempting escalation or a malicious/compromised operator.
- **Preconditions:** Admin or moderation capabilities exist.
- **Abuse:** Quarantine, correct, reveal, delete, invite, or change security state without policy,
  reason, or trace.
- **Impact:** Broad integrity/privacy harm and loss of governance trust.
- **Controls:** Separate origin behind Access, individual least-privileged roles, fresh passkey,
  reason, external append-only audit, conflict rules, and no shared account.
- **Detection:** Audit completeness checks, access review, anomaly alerts, and independent review of
  sensitive actions.
- **Recovery:** Revoke the role, rotate credentials, reverse only reversible actions through an
  audited process, notify affected users, and perform incident review.
- **Residual risk:** A single bootstrap maintainer concentrates authority; external review
  substitutes for self-approval until roles can be separated.

### VR-ABUSE-DEPENDENCY-PR — Malicious contribution or upstream dependency

- **Attacker:** A fork author, compromised maintainer account, package publisher, action, image, or
  toolchain.
- **Preconditions:** CI installs or executes source and dependencies.
- **Abuse:** Exfiltrate credentials, alter checks, run install scripts, poison a cache, or publish
  from an untrusted revision.
- **Impact:** CI compromise, source backdoor, or a path to production/release authority.
- **Controls:** Secretless read-only PR CI, `pull_request_target` ban, full-SHA actions, image
  digests, frozen locks, install scripts denied, no writable cache, protected review, and dependency
  policy.
- **Detection:** Workflow/config policy tests, lockfile review, advisory and provenance checks, and
  hosted secret scanning.
- **Recovery:** Close the contribution, rotate any exposed credential, remove the dependency,
  invalidate affected artifacts, and audit protected history.
- **Current evidence:** The exact `pg`, Fastify, type-package, and `@noble/ed25519` versions,
  complete transitive graph, declared licenses, registry integrity metadata, direct notices, absence
  of install lifecycle scripts, and optional native peer were reviewed; deterministic
  inventory/license gates pass. The Ed25519 package is confined to one strict verification call, has
  no dependencies, and is regression-tested against the native zero-key/zero-signature gap. The
  registry advisory audit reported no known vulnerability at review time. Fastify 5.10.0 is confined
  to one Ingest server file; its 42 added MIT/BSD-3-Clause package records have no lifecycle or
  native build scripts, and import-boundary plus transport regressions prevent an unreviewed second
  listener. The Windows portable connector job is fixed to public scan, pinned Node/Rust setup, one
  locked release-profile build, and one no-upload smoke. Configuration mutations reject a missing
  job, runner drift, a missing smoke, and an added artifact action. No hosted pass is claimed.
- **Residual risk:** A malicious change can modify its own tests; test success never authorizes
  merge or release by itself.

### VR-ABUSE-RELEASE-SUBSTITUTION — Unofficial or compromised connector presented as official

- **Attacker:** A release-account attacker, mirror operator, compromised runner, or deceptive fork.
- **Preconditions:** Users download a connector binary or installer.
- **Abuse:** Replace the artifact, omit verification, reuse branding, or sign malware with stolen
  authority.
- **Impact:** Code execution on participant computers and theft of local Codex or project data.
- **Controls:** Protected revision, isolated trusted build, platform and project signatures,
  checksums, SBOM, provenance, trademark clarity, and clean-machine verification instructions.
- **Current evidence:** The untrusted Windows job may build only ephemeral test input, runs a
  bounded portable copy/removal smoke, and has no artifact upload or release authority. This is
  useful lifecycle regression evidence but satisfies none of the protected-build, package,
  signature, checksum, SBOM, provenance, or hosted release requirements. The local diagnostic
  preview likewise states no supported Codex version and is not accepted as artifact identity,
  provenance, or release evidence.
- **Detection:** Signature/provenance validation, reproducibility comparison, release audit, and
  reports of signer or checksum mismatch.
- **Recovery:** Revoke the artifact/signer, publish an advisory, disable affected connector
  versions, rotate device keys, and ship a verified replacement.
- **Residual risk:** Users who ignore verification can install deceptive third-party builds.

### VR-ABUSE-DELETE-RESURRECTION — Partial deletion or restore revives a profile

- **Attacker:** Usually a failure or operator error; possibly a user racing ingestion against
  deletion.
- **Preconditions:** Deletion, backup, restore, cache, or retry is in progress.
- **Abuse:** Continue submitting after confirmation, show cached profile data, leave a copy, or
  restore deleted rows and keys.
- **Impact:** Violation of user control, privacy commitments, and revoked authority.
- **Controls:** Transactional immediate hide/revoke/reject, idempotent purge, cache invalidation,
  bounded tombstone, backup expiry, and deletion replay before restored service opens.
- **Detection:** Deletion job age/failure, post-delete request denial, residual-data reconciliation,
  and restore drills.
- **Recovery:** Re-hide and revoke synchronously, rerun purge, replay markers, purge caches, and
  report honest progress without record identifiers.
- **Current evidence:** Revision 0011 filters `active` profile state on every score read and
  re-ranks the surviving public rows after a committed hide. The local deletion endpoint requires
  the exact active session and typed handle, verifies a fresh session/profile/handle/RP/origin-bound
  passkey challenge, and atomically consumes it with revision 0002's immediate
  hide/revoke/unlink/enqueue transaction. Negative application and route tests cover handle
  mismatch, malformed/replayed proof shapes, database refusal, cross-origin and cookie denial, and
  cookie clearing only after success. Revision 0024 and the local one-shot Jobs command then purge
  at most ten due `deletion_pending` profiles atomically, removing restrictive pairings and cascaded
  primary identity/credential/source/device/usage/personal-score rows while retaining only the
  opaque terminal job and redacted audit linkage. Static scenarios cover due/retry/future work,
  committed-state drift rollback, exact role denial, batch bounds, idempotency, and no invented
  tombstone; observed races cover purge workers and purge versus authentication cleanup. Revision
  0032 makes the terminal job cleanup-eligible after 30 days; revision 0033 makes the redacted audit
  reference cleanup-eligible after 180 days. No external audit sink is supplied. Cache invalidation,
  deployed scheduler/monitoring, keyed tombstone policy, backup expiry, and restore replay remain
  unimplemented.
- **Residual risk:** Immutable backup media may retain encrypted data until documented expiry.

### VR-ABUSE-RESOURCE-EXHAUSTION — Expensive endpoint or state-table growth

- **Attacker:** Anonymous automation, enrolled clients, compromised devices, or accidental retry
  storms.
- **Preconditions:** Public reads, anonymous login/pairing ceremonies, ingest, nonce/idempotency
  records, jobs, or database pools are available.
- **Abuse:** Send oversized/slow input, create unbounded state, force expensive ranking, or
  synchronize many devices concurrently.
- **Impact:** Increased cost, degraded service, job delay, or unavailable deletion and security
  actions.
- **Controls:** Body and collection bounds, edge and account rate limits, 8-to-16 recovery-code
  batches, one active recovery authority, 32-passkey and 32-active-session database ceilings,
  deadlines, concurrency and connection limits, backpressure, quotas, cache, jittered retries, table
  cleanup, and independent kill switches.
- **Detection:** Latency, saturation, queue age, rejection, source growth, state-table size, and
  cost alerts.
- **Recovery:** Load shed, disable the narrow feature, drain queues, expire bounded state, and
  restore service without weakening authentication or signature checks.
- **Current evidence:** Connector input is limited to 31 entries and safe integers; origin/device
  nonce and raw snapshot rows carry bounded expiry markers. Before contract traversal, the local
  Ingest kernel limits the exact body to 8192 bytes, raw header pairs to 64, and JSON to depth 8,
  128 values, 64 object members or array items, 64 number characters, and 256 decoded string code
  units. Origin proof verification precedes parser and device dependency work. One Jobs-only
  procedure independently deletes each expired ingest row class in 1-to-1000 batches, preserves
  live/current state, and serializes two workers in observed PostgreSQL evidence. Revision 0013 adds
  a separate oldest-first 1-to-1000 cleanup for expired non-activated pairing rows and their exact
  pending keys, including cancelled state, while preserving live and activated bindings. Its own
  observed two-worker race proves serialization and live-row preservation. Revision 0023 adds an
  independently bounded cleanup for expired auth challenges and restricted recovery authorities plus
  their still-present used/scrubbed code rows. Its worker race and recovery-start race prove
  serialization, live/unused-state preservation, and profile-first cross-capability lock order.
  Revision 0030 adds an oldest-first 1-to-1000 cleanup for expired session rows with no retained
  predecessor and no pairing approval reference. It reuses the authentication-retention mutex,
  cascades only the selected row's challenges, and has an observed two-worker race proving
  serialization and live-session preservation. Revision 0034 permits only Jobs to redact both exact
  approval references together from activated pairings after 180 days under the authentication and
  pairing mutexes. Partial or pre-activation redaction fails; the pairing, profile/source/device
  binding, active device, and passkey remain, and a separate session cleanup can then progress.
  Revision 0035 adds oldest-first 1-to-1000 deletion for passkeys revoked at least 180 days earlier
  only after all four session/challenge/pairing reference paths are absent. It shares the existing
  authentication and pairing mutex order, repeats eligibility at deletion, and has an observed
  two-worker race proving serialized progress while active, recent, and referenced rows remain.
  Revision 0036 adds oldest-first 1-to-1000 paired deletion for activated pairings and their exact
  device keys only after both activation and revocation are at least 180 days old, approval
  provenance is minimized, and no authorization challenge, nonce, or raw snapshot remains. It uses
  the existing Ingest and pairing mutex order, repeats every predicate, avoids configured cascades,
  and has an observed two-worker race proving serialized progress while active, recent, and
  referenced rows remain. Revision 0031 adds a shared-mutex oldest-first 1-to-1000 cleanup for
  expired active or revoked invite verifier rows. Its observed worker race proves exact progress
  while live invites and redeemed enrollment provenance remain. Revision 0032 adds oldest-first
  1-to-1000 cleanup for profile-free terminal deletion jobs only after 30 days, and revision 0033
  adds the same bound for database audit events only after 180 days under a separate mutex. Their
  worker races preserve recent rows; the audit slice does not imply an external append-only sink.
  Revision 0038 adds oldest-first 1-to-1000 deletion for a canonical `enrolling` profile only after
  every exact enrollment-session/registration-challenge expiry is past, one redeemed invite remains,
  and no other recovery, passkey, source, deletion, scoring, or recipe state exists. It locks the
  authentication and profile-purge mutexes in their existing order, repeats every predicate, retains
  audit evidence with null profile linkage, and has worker plus activation-overlap races proving
  that live enrollment authority, an in-flight initial-passkey activation, and every non-canonical
  profile-bound state remain safe. Scoring refresh/finalization use one private mutex, per-season
  locks, a five-second database lock bound, numeric overflow protection, a 30-second statement
  deadline, bounded no-data terminal state, and one atomic global-rank rebuild. The public score
  projection returns at most 100 rows and has a five-second statement deadline; the response-only
  contract narrows one future page to 32 rows, and the mapper rejects row 33 before traversing
  projected rows. The Web adapter adds a four-connection ceiling, two-second checkout/connect wait,
  one-, five-, and six-second lock, server, and client-query deadlines, idle/lifetime recycling, and
  a fixed limit 32. Ranking still evaluates all currently visible season entries. The generated
  query validator now rejects malformed, out-of-range, and non-Monday seasons before the route may
  call the store. All three local ranking GETs first require the exact default-off module-load
  decision; disabled state returns generic 503 before query/header parsing, admission acquisition,
  or store/database work. Once enabled, the route rejects bodies and oversized/malformed URL or
  `Accept` work, admits at most four active reads with no queue, holds each lease through adapter
  settlement, and returns 503 on exhaustion. The visible home page makes one current-week request
  per navigation with no client retry loop and retains its synthetic fallback after failure. The
  operation reserves a 429 response without claiming a client-rate limiter exists. The local
  identity routes separately admit at most four unsettled calls without a queue, reject malformed or
  over-limit bodies before database work, and create no database state for login options. A valid
  login proof performs one bounded atomic completion, while failure to seal the resulting browser
  cookie revokes the new session. These are local process ceilings, not distributed or
  client-identity rate limits. The four pairing routes first require exact
  `VIBERACING_PAIRING_ENABLED=true` at module load; disabled POST cancels an available body and
  returns generic 503 before parsing, runtime/service construction, admission acquisition, protected
  configuration, or database work. New-source growth separately requires exact
  `VIBERACING_SOURCE_CREATION_ENABLED=true`; false UI and repeated service checks preserve
  existing-source pairing while preventing new-source challenge and completion work. This is a local
  gate, not a distributed creation rate limit. CarRecipe proposal creation and approval separately
  require exact `VIBERACING_CAR_PROPOSALS_ENABLED=true`; disabled browser/device mutation stops
  before parsing, admission, proof, or database work while private read/reject remains. This is also
  a local gate, not a distributed proposal rate limit. Enrollment separately requires exact
  `VIBERACING_ENROLLMENT_ENABLED=true` in both pages, all four route modules, and all four service
  methods; disabled UI omits its forms and disabled HTTP/service paths stop before private work.
  Returning login/recovery remain available. This is a local gate, not a distributed enrollment rate
  limit, cleanup invocation, or deployed worker control. ADR 0061 separately provides an explicit
  Jobs cleanup after retained authority expires, and ADR 0063 includes only that fixed object in its
  default-off local catalog. Once pairing is enabled, the transport-free pairing-start application
  bounds labels, metadata, keys, entropy, and HMAC work, admits four unsettled attempts without a
  queue, holds each lease through a 250-millisecond floor, and makes no database call for malformed
  input. Revision 0022 now adds one Web-only fixed-storage admission before start/poll database
  work: every request locks/increments one operation-global row and one of 64 digest-selected
  buckets under a five-second deadline. Counts saturate, windows reset in place, and neither raw
  client ID nor digest is retained. Revision 0037 adds a zero-argument Jobs-only reset after the
  maximum one-hour window, preserves the 130 fixed rows, and proves worker/worker plus
  reset/admission serialization. The shared service retains the four-call no-queue ceiling across
  both operations. This is distributed across Web instances using one database, but the
  self-asserted ID is not a trusted edge/IP identity and still needs capacity evidence. Physical
  pairing cleanup exists as a separate local capability and in the default-off local hourly catalog,
  and the combined synthetic scheduler/PostgreSQL integration exercises it; deployed scheduling and
  edge controls are still pending. The local Jobs runner adds a one-client ceiling, 2/31/32-second
  connect/server/client deadlines, twelve fixed 1000-row cleanup commands, one zero-argument
  maximum-130 rate-window reset, one fixed 1000-row approval-provenance redaction, one fixed
  maximum-10 primary-purge command, canonical season validation, closed one-row results, and
  destructive release on failure. Its synthetic integration executes those commands sequentially
  against one disposable database. The scheduler separately limits execution to one non-overlapping
  sequential cycle, ignores timer ticks while it runs, and starts no later object after shutdown. A
  second opt-in synthetic integration composes that production scheduler core under fixed injected
  time with the real runner/database, proves exact dependency order, and proves a widened login
  cannot mutate any private table. A third composes the production process lifecycle, starts an
  active real-runner call before injecting its first handler, and proves graceful settlement without
  starting the later job. A fourth starts the built entry point under the real host clock, reaches
  the terminal startup-catalog marker without process output, forcibly ends only its persistent test
  child, and then verifies exact state. These do not prove OS-signal delivery, emitted-child
  controller settlement before forced termination, recurring timer-callback behavior, deployed
  cadence, or production-load capacity. The kernel itself has no socket/stream authority. The
  separate Ingest adapter adds a four-client ceiling, 2/6/31/32-second checkout/lock/server/client
  deadlines, idle/lifetime recycling, exact one-row origin consume, zero-or-one device lookup, and
  one-row submission results, with destructive release on failure. The transport-free application
  generates request correlation before verification, submits only after verification, waits for
  settlement, and contains dependency failures without a retry loop. The local Fastify boundary caps
  the raw body at 8192 bytes, parsed headers at 16384 bytes, raw header pairs at 64, connections at
  32, and requests per socket at 16; it sets 5/33/34-second request/handler/connection deadlines and
  a five-second keep-alive, admits four unsettled application calls without a queue, holds each
  lease through settlement, and returns generic 503 on exhaustion. Real loopback tests close
  malformed and partial requests; injection tests cover overload and response policy. The separate
  host closes that composition under a 36-second first-signal deadline, forces failure on a second
  signal/deadline/close error, and requires the Railway drain declaration to leave at least four
  seconds beyond its local close bound. It also stays default-off unless exact
  `VIBERACING_INGEST_ENABLED=true` is read before every other host/protected-application field or
  resource; the tracked example remains false. This is no deployed/dynamic kill-switch result. There
  is no live identity or deployment database integration, distributed rate/backpressure policy,
  monitoring, or combined capacity evidence. The full synthetic Ingest gate proves correctness under
  four sequential signed requests, not load capacity. Deployed scheduling, cache, scoring/read
  capacity evidence, quotas, edge shaping, and production load evidence remain unimplemented.
- **Residual risk:** Public availability always permits some resource pressure; beta capacity and
  thresholds remain deployment-specific.

## Verification mapping

Each case is covered by one or more [security invariants](../architecture/SECURITY_INVARIANTS.md).
Implementation pull requests identify the case IDs they affect and provide positive, negative,
concurrency, and recovery evidence. A case can be accepted only when its residual risk matches the
Community trust model and grants no hidden privilege.
