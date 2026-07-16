# Implementation status

This page records only evidence that exists in the public working tree. The
[project plan](PROJECT_PLAN.md) remains the source of intended behavior.

## Current phase

Phase 1 product code is locally complete, with the manual release-evidence items below still open.
The Phase 2 language-neutral contract and SQL persistence foundations now include database-only
passkey login, multi-passkey management, restricted recovery, Community usage ingest, bounded
ingest-retention cleanup, open-season scoring, terminal season finalization, and a public score-only
database projection plus its server-only projection-to-contract mapper; Phase 3 database-only
source/device lifecycle, same-source deduplication, and bounded pairing-retention cleanup have also
started. A server-only public problem-response factory, closed query/OpenAPI operation, and locally
implemented public-score GET now exist. The visible home race now requests the current
server-selected Community week from that same-origin route, replaces only its race/leaderboard after
closed browser-side validation, and retains a labeled synthetic fallback on failure. Local identity
slices now implement exact same-origin bounded forms, GitHub OAuth state and S256 PKCE with no extra
scope, purpose-separated encrypted HttpOnly continuations, atomic profile/session creation, required
initial WebAuthn registration, returning discoverable-credential login, a session-scoped minimal
passkey inventory, an active account page, immediate public-profile hide/show, fresh backup-passkey
addition, revocation of an owned non-current passkey, a bounded active-device inventory with
immediate owned-device revoke, an exact-handle fresh-passkey profile-deletion request, and
database-backed logout. Login options retain the profile-free challenge only in a separate encrypted
cookie; valid proof alone reaches one atomic create-consume-session call. Its GitHub,
passkey-verifier, database, and browser evidence is injected or synthetic; no working invite issuer,
OAuth registration, secret, live authenticator/database login, deletion purge worker, edge abuse
control, recovery, or deployment is supplied. A local one-shot Jobs runner invokes only the four
existing maintenance procedures through a bounded least-privileged adapter. A local Ingest kernel
now bounds and authenticates the exact Community sync envelope, consumes an injected origin nonce,
parses bounded JSON, validates the generated contract, and strictly verifies the source-bound device
request. A separate bounded Ingest PostgreSQL adapter revalidates that output and exposes only
atomic origin-nonce consumption, device lookup, and submission through a probed least-privileged
pool. A protected local reader supplies one mandatory and one optional rotation origin key directly
to the verifier without returning raw configuration. A forced-RLS replay tuple, Ingest-only atomic
consume, and separate Jobs ingest and pairing cleanup paths now have real isolated PostgreSQL
evidence. A transport-free Ingest application now composes those exact verifier and database
capabilities, generates a server-owned request ID, waits for submission, and returns only a
validated acknowledgement or generic problem decision. A bounded local Fastify server factory now
preserves exact raw HTTP evidence, admits four application calls without a queue, applies fixed
parser/header/connection/deadline policies, and serializes only revalidated sync
acknowledgement/problem contracts. A library-only Rust connector foundation now bounds the stable
App Server handshake and a candidate `0.144.4` account/usage parser, discarding account/summary
fields and returning only bounded normalized daily usage in caller memory. An inaccessible one-shot
supervisor composes those exact states through fixed local pipes, a fixed child argument, no ambient
environment, bounded stdout/stderr/time, terminal-event draining, and reap-before-success cleanup.
An inaccessible reviewed sync context now lets a candidate-only composer consume those minimized
entries into the exact bounded JSON body, SHA-256 digest, nonce encoding, and device-signature
message shared with the production Ingest verifier. An isolated one-use signer removes public
unsigned access, consumes that value only with an inaccessible device-bound key capability, and
returns the same body plus five exact signed header values. The shared synthetic vector is strictly
verified across Rust and Ingest. A second inaccessible signer and pure Web verifier now agree on an
exact synthetic pairing-possession proof. A dormant transport-free Web/Auth start application now
generates fresh server identifiers, 32-byte poll/challenge material, a 60-bit human code, separate
protected poll/code verifiers, and a nine-minute pending transaction from closed device metadata
through one fixed call on the probed read-write Web pool. A second dormant application derives two
fixed-shape HMAC poll-verifier candidates, selects at most one approved row, runs that strict proof,
and alone invokes exact atomic activation with server-owned identifiers behind four-call admission
and a 250-millisecond settlement floor. Neither creates browser approval, an HTTP request, a real
key, or a live database connection. Candidate release, schema, fixture, synthetic-process, composer,
pairing, and request-signer evidence does not populate the support matrix. Phase 0
hosted-publication controls remain blocked on real maintainer identities and GitHub configuration.
No recovery or remaining critical-action Argon2id/WebAuthn application flow, production
secret-manager/edge key injection, Ingest host/port/TLS deployment entry point, production
deployment, live Web/Jobs/Ingest database login/TLS integration, released or operational connector,
supported Codex version, real-user ingestion, end-to-end public ranking, or finalization scheduler
exists.

## Implemented and locally verified

- Public-safe project, security, contribution, and agent guidance.
- Apache-2.0 source license.
- Local checks for relative Markdown links and duplicate heading anchors.
- Local checks for common credentials, private-key files, personal email addresses, non-reserved
  public IPv4 addresses, local user-home paths, and printable metadata inside binary files.
- Black-box regression cases for safe examples, secret-shaped values, personal email, local paths,
  environment files, and staged-snapshot isolation.
- Black-box documentation cases for valid links, missing files and anchors, duplicate anchors, and
  attempts to escape the repository root.
- Tracked symbolic links are rejected before repository checks can follow them.
- A complete-reachable-history gate that refuses shallow clones and scans refs, commit messages,
  every historical path/blob, forbidden modes, oversize objects, and printable binary metadata, with
  six black-box cases including deleted-history and unreachable-object scope.
- Pinned Node, pnpm, and Rust toolchains with committed pnpm and Cargo lockfiles.
- A pnpm workspace with release quarantine, trust and source policy, exact external direct
  dependencies in every bounded workspace, `workspace:*` internal references, private workspace
  manifests, and install-script denial by default.
- Prettier, Markdownlint, CSpell 10.0.1, YAML/configuration policy, and Rust formatting, check,
  test, and Clippy workspace gates.
- An offline external-link gate with 12 reviewed hosts, HTTPS/credential/port/query/address rules,
  no dormant host permissions, and eight black-box cases. A separate online mode pins public DNS
  results, sends no credentials, follows no redirects, and is excluded from deterministic PR CI.
- A deterministic dependency inventory covering 522 locked npm packages, thirty Cargo dependencies,
  two pinned GitHub Actions, and one pinned local-development container. License expressions,
  installed manifests, every root/workspace importer, dependency scopes, direct notices, and
  external-artifact usage are checked with ten black-box cases.
- Positive and negative workflow-policy tests for action pins, permissions, secrets, shell
  interpolation, timeouts, complete-history checkout, checkout credentials, and forbidden triggers.
- A secretless, read-only GitHub Actions CI definition and bounded weekly Dependabot configuration.
  The Node job scans the public tree before installing anything, fetches the exact Cargo lock graph
  without builds for offline license metadata, and leaves compilation/tests to the separate Rust
  job.
- A loopback-only disposable PostgreSQL Compose service plus an opt-in portless `tmpfs` integration
  service, both pinned to the same version and index digest.
- Cross-platform root verification entry point: `pnpm run verify`.
- Governance, maintainer, conduct, DCO, support, roadmap, changelog, release, trademark, and
  third-party notice policies.
- Structured bug, feature, documentation, and pull-request forms that warn against sensitive data
  and do not request contact details, raw logs, screenshots, or account identifiers.
- Community-health policy validation and black-box regression cases for missing policies, invalid
  issue forms, automatic assignment, unresolved ownership, modified DCO text, and missing privacy
  warnings.
- A fail-closed publication-readiness checker with regression coverage for GitHub remote,
  MAINTAINERS/CODEOWNERS agreement, protected policy ownership, private conduct reporting, and
  private vulnerability reporting state.
- A repository-scoped design threat model with assets, attacker capabilities, trust boundaries,
  realistic/out-of-scope stories, required mitigations, implemented-versus-planned status, and
  severity calibration.
- Twenty-one structured abuse cases covering identity/source/scoring, pairing/device/connector,
  web/privacy/content, edge/database/admin/supply-chain, deletion, and resource exhaustion.
- A privacy classification and field inventory with prohibited data, provider boundaries, user
  controls, logging rules, retention decisions, deletion, restore, and launch review gates.
- Planned system/container and enrollment, login/recovery, pairing, sync, public-read, deletion, and
  trusted-release Mermaid views.
- A fail-closed Codex compatibility policy and empty support matrix; no upstream or connector
  version is claimed supported without pinned schema/fixture/process/platform/release evidence. A
  candidate `0.144.4` manifest records the official release tag, immutable commit and artifact
  metadata, full stable-bundle and client-request digests, three minimal source/checked-in schema
  extracts, nine synthetic JSONL fixtures, generated hostile cases, and three explicit blockers. A
  canonical/digest/path/method/fixture/matrix checker has fourteen black-box regression cases and
  prevents candidates from becoming supported rows.
- A library-only Rust connector protocol and candidate-adapter foundation. It emits one compile-time
  fixed `initialize` request with no capabilities, accepts only one LF-terminated frame up to 16
  KiB, manually rejects duplicate/unknown envelope and result fields, validates and discards the
  four bounded stable initialization strings, and emits `initialized` only after a matching ID `0`
  response. Hostile remote input permanently fails the instance and errors never reflect it. Seven
  integration tests cover exact bytes, state order, framing/UTF-8/size, envelope/result shape,
  duplicates, unknowns, string/path bounds, safe Unicode, and non-reflection. Only after that
  handshake, the candidate exact-version state machine emits fixed `account/read` ID `1` with
  refresh disabled and `account/usage/read` ID `2` with null parameters. It accepts only complete
  ChatGPT mode, validates then discards email/plan/summary fields, and returns at most 31 sorted
  unique real `20xx` dates with integers through the sync-safe maximum. Ten further integration
  tests use every checked-in fixture and generated duplicate/UTF-8/frame/ID/count/date/integer
  cases, prove terminal remote failure, and keep diagnostics to entry count. A one-shot supervisor
  then writes only those fixed messages to a child started with one `app-server` argument and a
  capability-owned working directory/environment. It clears ambient variables, admits only three 16
  KiB stdout frames, permits 8 KiB discard-only stderr and fails on the next byte, applies 10-second
  response and 45-second lifetime limits, detects terminal output after the usage response, and
  returns data only after the child is reaped. Nine unit cases launch only a target-built Rust
  fixture and cover exact composition, environment filtering, timeout, early exit, stdout/stderr
  overload before and after the final response, non-reflection, missing executable, nonzero terminal
  status, and forced cleanup. The opaque launch capability has no public constructor: there is no
  executable discovery/path-ownership review, official-artifact execution, supported Codex version,
  real device key generation/store, pairing client, upload, network transport, CLI, installer, or
  released binary. A candidate pairing signer now consumes inaccessible pending-key/challenge
  capabilities and signs one exact domain-separated transaction/challenge/public-key message. A
  server-only Web kernel independently validates exact approved material and the canonical signature
  under strict Ed25519 semantics. Five Rust and seven Web cases share the same synthetic key/vector,
  reject changed or malformed inputs and zero material, and prove copy-before-await behavior. There
  is now a protected primary/secondary poll-token verifier plus closed local start and activation
  database/application compositions, but still no pairing HTTP boundary, WebAuthn approval,
  connector pairing client, live database login, or real key. A separate candidate-only composer
  consumes the real parser output behind another capability with no public constructor. It
  revalidates source/sync/device IDs, canonical UTC time, and daily bounds; manually emits the exact
  seven-field body; computes the SHA-256 digest; and builds the exact unpadded base64url,
  LF-separated device message. An isolated one-use signer consumes that otherwise inaccessible value
  with a device-bound Ed25519 key capability, rejects an exact device mismatch, signs only the fixed
  message, and returns the same body plus five header values. Nine Rust sync cases plus one
  production-path Ingest case share and strictly verify an exact synthetic body, public-key, and
  signature vector. Prepared/signed private byte buffers and the upstream key are zeroed on drop. No
  source/device context provider, fresh entropy, clock, real key generation/store, end-to-end
  pairing, transport, retry, schedule, or support claim exists; the compatibility matrix remains
  empty.
- An ADR lifecycle/template and twenty-eight accepted design decisions covering Community trust,
  multi-source aggregation, identity/device authority, restricted recovery, edge/service/database
  isolation, CarRecipe, public repository safety, season finalization, and the public score
  projection/response/adapter, common HTTP problem boundaries, and the locally implemented public
  score operation, bounded maintenance runner, bounded Community sync verification kernel,
  least-privileged Ingest PostgreSQL adapter, protected origin-proof key configuration, persistent
  atomic origin replay, transport-free Community sync application composition, and the bounded local
  Fastify HTTP boundary, plus the fail-closed Codex handshake, candidate account/usage adapter, and
  inaccessible bounded one-shot process supervisor, exact-body sync composer, isolated one-use
  device signing boundary, bounded pairing-possession proof, bounded pairing activation composition,
  and bounded pairing start composition.
- Architecture-contract validation and black-box regression cases for missing threat sections,
  duplicate/incomplete abuse cases, privacy-class drift, invalid/orphaned ADRs, unclosed Mermaid
  fences, and accidental compatibility claims.
- Five canonical JSON Schema 2020-12 contracts for a bounded Community connector sync, a
  non-sensitive sync acknowledgement, stable problem details, a one-field public score season query,
  and a response-only top-32 Community score page with constant trust metadata. Every object is
  closed; scalar and collection values are bounded; reviewed date-range/ISO-weekday extensions make
  the score calendar executable; connector input has an executable writable-field allowlist that
  excludes identity, trust, rank, score, season, moderation, credentials, and prohibited data.
- Deterministically generated readonly TypeScript types, embedded validator wrappers, source digest,
  and an OpenAPI 3.1 document with explicitly `implemented-local`
  `GET /v1/community/scores?seasonStart=...` and `POST /v1/community/sync` operations. Their exact
  method-specific query/body, response/problem, admission, authentication-reference, `no-store`,
  `Vary: Accept`, generated request ID, and same-origin CORS policies are manifest-driven without
  claiming deployment. Both inventoried authentication policies participate in the generated source
  digest. A manifest/schema/drift checker has 39 black-box cases covering generated
  operation/status/evidence semantics, unsafe/duplicate/drifted operations, unknown fields, missing
  bounds, client-derived score aliases, Community trust/problem/date drift, private response fields,
  unlisted/path-traversing schemas, unsupported keywords, missing date deduplication, and stale
  generated output.
- A dependency-free runtime contract validator with fail-closed reflection handling; strict
  calendar/range/ISO-weekday/UTC timestamp and safe-integer checks; depth, node, key, item, and
  issue budgets; and privacy-safe issue output that never echoes unknown property names or submitted
  values. Twenty-two unit/security cases cover valid/invalid query boundaries, hostile structures,
  response trust/privacy, connector input, and validator resource limits at 100% statement/line/
  function and 97.22% branch coverage.
- A pure local Community sync verifier over a closed copied raw request envelope. It admits only
  exact `POST /v1/community/sync` JSON with bounded raw bytes and header pairs, rejects duplicate
  required headers, authenticates a body-bound HMAC-SHA-256 origin proof before parser or device
  work, applies a one-time injected origin-nonce capability, parses strict UTF-8 JSON under explicit
  depth/node/fanout/string/number budgets with decoded duplicate-key rejection, and validates
  `ConnectorSyncV1`. It binds the device timestamp and idempotency header to the body, accepts only
  minimal source-bound device material, verifies the exact-body Ed25519 request with strict RFC
  8032/FIPS semantics, and returns one frozen database-ready allowlist. One hundred seventeen
  adversarial tests cover policy drift, grammar/encoding/bounds, proxy/accessor/sparse/shared-buffer
  input, mutation after call, origin rotation/time/tamper/replay/dependency order, contract and
  source binding, malformed/unknown device material, backend failure, and the native
  zero-key/zero-signature bypass at 100% statement/branch/function/line coverage. The kernel itself
  has no HTTP listener, public response, log sink, rate limit, socket deadline,
  admission/backpressure, connector, live integration, or deployment.
- A protected origin-proof configuration boundary. It reads exactly one mandatory primary ID/key
  pair and at most one complete secondary rotation pair from four namespaced process values. IDs use
  the versioned `edge_` grammar; keys are canonical unpadded base64url for exactly 32 bytes; and
  both IDs and key material must differ. The config-backed factory accepts only exact nonce, clock,
  and device-lookup dependencies, constructs the verifier internally, exposes no reusable key
  container, overwrites temporary decoded buffers, and emits only generic bounded configuration
  errors. Twenty-eight adversarial config/dependency/proof-path cases remain in the 426-test Ingest
  suite at 100% statement/branch/function/line coverage. Synthetic environment values prove no
  secret-manager binding, edge signer, real rotation, or deployment.
- A bounded local Ingest PostgreSQL configuration/pool/adapter boundary. It accepts only six
  namespaced fields, permits cleartext solely on explicit loopback development/test, otherwise
  requires certificate-verified TLS, hides its password from enumeration/JSON, and caps one process
  at four clients with 2/6/31/32-second checkout/lock/server/client deadlines. Every checkout probes
  the exact Ingest role, distinct non-privileged login scope, database CONNECT without
  CREATE/TEMPORARY, sole role membership, and safe search path. The adapter exposes no general
  query: it maps an exact origin key ID/digest/expiry to one boolean consume row, a canonical device
  ID to zero/one strict verification row, and a reconstructed, contract-revalidated verifier
  allowlist to the fixed 13-parameter submission procedure. It copies bytes/arrays, generates a
  server UUID, validates coherent accepted/duplicate/quarantined output, destroys failed clients,
  and emits only bounded internal errors. One hundred eighteen
  configuration/pool/mapper/import-isolation cases remain in the current 426-test Ingest suite at
  100% statement/branch/function/line coverage. Mock pools prove the application contract; no
  working login, certificate, or live connection is claimed.
- A persistent origin replay database boundary. Revision 0012 stores only the closed key ID,
  domain-separated 32-byte digest, and millisecond expiry behind forced RLS. The Ingest-only
  function atomically inserts or replaces an expired tuple, returns `false` for an unexpired replay,
  and deletes its own row if expiry elapses while blocked. Jobs cleanup independently caps origin
  nonces, device nonces, and snapshots at the requested 1-to-1000 batch. Static scenarios and three
  observed PostgreSQL races prove exact one-time consumption, live-row preservation, cleanup
  serialization, role isolation, and database deadlines. Expiry does not schedule physical purge;
  production scheduling, monitoring, backup handling, and capacity remain open.
- A bounded pairing-retention database boundary. Revision 0013 extends the partial expiry index to
  cancelled state and gives only Jobs a separate 1-to-1000 oldest-first deletion under a private
  mutex, five-second lock wait, and 30-second statement deadline. It selects only expired pending,
  approved, or cancelled transactions whose exact key remains pending and unbound, cascades
  pairing-bound approval challenges, deletes the transaction before its key, and rolls back on any
  changed-row mismatch. Live pending and activated rows, bound devices, sources, profiles,
  credentials, and audit events remain. Static scenarios and an observed two-worker race prove
  bounds, idempotency, role isolation, serialization, and live/activated preservation. No scheduler,
  live Jobs login, production cadence, backup proof, capacity result, or broader ceremony cleanup is
  claimed.
- A transport-free Community sync application boundary. Its configured factory creates one bounded
  Ingest database object, injects that same object's atomic origin consume and minimal device lookup
  into the protected-key verifier, binds its submission capability, closes the pool after startup
  failure, and exposes only `execute` plus `close`. Each execution creates one server-owned 128-bit
  request ID before verification, requires the frozen verifier allowlist, waits for database
  settlement, reconstructs coherent accepted/duplicate/quarantined output, and validates either a
  frozen null-prototype `ConnectorSyncResultV1` or the closed generic `ProblemDetailsV1` subset.
  Origin/device rejection is one unauthorized result; dependency outages are generic retryable 503;
  internal drift and unknown failures are non-reflective 500. Fifty-four new adversarial and
  composition cases bring the Ingest suite to 317 tests at 100% statement/branch/function/line
  coverage. One signed synthetic request passes through the actual production verifier, replay and
  device capabilities, adapter mapper, and submission order using a mock pool. No HTTP object,
  serialization/header policy, or socket belongs to this application layer; no log sink, working
  login/certificate, live PostgreSQL, edge path, connector, or deployment is claimed.
- A bounded local Community sync Fastify server factory. Only one reviewed Ingest module may import
  the exact-pinned framework. It registers exact `POST /v1/community/sync`, copies at most 8192 raw
  body bytes and the original raw-header sequence, disables proxy trust, inbound request IDs, and
  framework logging, and admits four unsettled application calls without a queue. Explicit 16384
  header-byte, 64 raw-header-pair, 32-connection, 16-request-per-socket, and 5/33/34-second request/
  handler/connection policies bound one process. Closed content/`Accept`/route/method handling,
  generic 400/404/405/406/500/503 transport problems, `no-store`, `Vary: Accept`, `nosniff`, no CORS
  grant, CSPRNG request IDs, and final generated-contract validation prevent request or framework
  reflection. 108 additional adversarial injection and real-loopback framing cases bring the Ingest
  suite to 426 tests at 100% statement/branch/function/line coverage, plus strict lint, type
  checking, and production build. The handler limit is bound and classified but is not a production
  capacity result. No edge signer, direct-origin denial, trusted deployment route, host/port/TLS
  entry point, working database credential, monitoring, connector, load evidence, or deployment is
  claimed.
- A server-only public HTTP problem boundary that requests exactly 16 cryptographic random bytes,
  returns a frozen opaque request token, owns all eleven status/title/retry mappings including
  explicit 405/406 semantics, validates the complete `ProblemDetailsV1`, and emits only
  `application/problem+json`, `no-store`, and matching `x-request-id` headers. It accepts no inbound
  ID string, CORS setting, cookie, title, status, detail, or cause;
  malformed/accessor-backed/revoked inputs, inherited `toJSON`, and internal failures are
  non-reflective. The local score route consumes the factory; no log sink retains the token.
- A dynamic Node.js `GET /v1/community/scores` route that creates one request token at entry,
  rejects bodies and every missing/duplicate/unknown/non-canonical query, validates the one-field
  contract, performs bounded JSON `Accept` negotiation, and dispatches every other supported method
  through a closed 405 plus `Allow: GET`. It acquires one of four no-queue leases before lazily
  constructing the store, holds the lease until adapter work and serialization settle, revalidates
  the final page, and emits only `no-store`, `Vary: Accept`, request-ID, and content-type headers
  without CORS. Adapter/configuration availability and admission exhaustion map to 503;
  projection/invariant or unknown failures map to a non-reflective 500. The deadline policy uses the
  existing two-second connect, six-second client-query, and five-second PostgreSQL statement
  ceilings rather than returning early from an outer promise race. The reserved 429 does not claim a
  client-rate limiter.
- A visible public-score consumer. The dynamic server page derives the current ISO Monday and passes
  only that public label to the client. The browser issues one credential-free, `no-store`,
  same-origin request to the exact score route, accepts at most 32 dense rows with the closed public
  field set and constant Community/self-reported metadata, and replaces only the race and
  leaderboard. Fixed repository-owned cars are presentation fallback because CarRecipe is not in the
  response; streak and freshness remain unavailable. Invalid, oversized, non-JSON, failed, or
  unavailable responses retain the clearly labeled synthetic preview. The demo garage stays
  synthetic, and no retry, cookie, browser persistence, analytics, or third-party destination is
  added.
- An idempotent cluster-role bootstrap for separate `NOLOGIN`, non-owner Web, Ingest, Jobs, Admin,
  and schema-owner groups. The default database and `public` schema capabilities are revoked;
  database and runtime-role search paths are scoped to `pg_catalog, pg_temp`; the migration
  principal retains explicit connection authority; unexpected group-role memberships fail closed.
- Sixteen checksum-ledgered, transactional SQL migrations with bounded lock/statement execution and
  24 forced-RLS private tables for profiles, invites, sessions, passkeys, recovery codes and
  restricted authorities, session-bound challenges, opaque sources, pending/active/revoked device
  keys, pairing, bounded audit references, deletion work/tombstones, three fixed maintenance mutex
  rows, origin and device nonces, bounded raw Community snapshots, monotonic current source/day
  values, immutable score versions and season definitions, derived season entries/daily scores, and
  schema revisions. There is intentionally no GitHub token, account email, prompt, repository,
  credential, arbitrary JSON, or free-form diagnostic column.
- Database constraints and triggers enforce unique GitHub bindings, normalized handles, keyed
  verifier lengths, Argon2id recovery-verifier shape, exact device-key/source/pairing binding,
  terminal unlink/deletion states, state-dependent timestamps, and bounded lifecycle values. The
  public-key record itself moves from authority-free pending state to one source/device, then only
  to revoked.
- A database policy checker with 23 black-box cases for migration drift/path/revision, transaction
  and timeout omissions, unsafe SQL features, `PUBLIC`/direct runtime grants, unsafe
  `SECURITY DEFINER`, role options, passwords, and owner membership. The real PostgreSQL gate runs
  deterministic synthetic fixtures in rollbacks and proves four runtime roles cannot read identity
  or usage tables or create API objects.
- A closed procedure-only API boundary: Admin can issue bounded, reasoned invites; Web can
  atomically redeem an invite, create an enrolling profile/session, create and consume exact-session
  challenges, register the initial passkey, rotate/revoke a possessed session, and request immediate
  profile lock-down plus a deletion job. Web can also start a bounded pairing, approve its exact
  immutable key and new/existing opaque-source choice after a consumed pairing step-up, expose
  minimal external signature-verification material, activate one exact source-bound device, and poll
  only bounded status. Web can privately list its own sources/devices, immediately pause an active
  source or revoke an owned device, and reactivate/unlink one exact source only after a fresh,
  consumed, source-bound step-up. Unlink atomically revokes all active source devices, cancels
  approved pairings, and invalidates unused source actions; normal user authority cannot lift
  quarantine. Web additionally has one bounded public Community score projection. Ingest has only
  atomic origin-nonce consumption, minimal active-device verification lookup, and bounded Community
  sync submission; Jobs have only bounded expired ingest- and pairing-state cleanup plus Community
  scoring refresh and finalization. Ingest has no identity, passkey, recovery, pairing, lifecycle,
  admin, or direct-table capability. Profile-scoped functions derive identity from an active session
  ID plus keyed verifier and do not accept a caller-selected profile ID.
- The same boundary can create a five-minute profile-free login challenge, expose only minimal
  active-passkey verification material, atomically mint a passkey-bound session after application
  verification, and return only profile ID, handle, and locale after success. Revision 0014 composes
  challenge creation and consumption with that session so options requests retain no database state.
  The boundary can also privately list owned passkeys and add or revoke an exact passkey after a
  fresh target-bound step-up. Stored sign counters never decrease; the last active key cannot be
  removed; revocation closes the key's sessions, unused challenges, and pending pairing authority
  while preserving unrelated keys and already activated devices.
- The Web boundary can rotate an 8-to-16-code recovery batch only after a fresh exact-passkey
  `recovery_change` step-up, read only one opaque selector plus unused PHC for application
  verification, consume and scrub one code into a single recovery-only authority for at most ten
  minutes, and atomically complete exact replacement-passkey registration. Completion revokes old
  browser/passkey authority, cancels approved pairings, clears codes/challenges, and creates the
  normal session only after the replacement key exists. Activated source-bound devices remain
  separate and explicitly revocable; profile deletion revokes active recovery authority.
- PostgreSQL scenarios prove invalid invite rollback, absolute invite/session/challenge lifetimes,
  wrong-verifier denial, cross-profile challenge denial, one-time challenge/action use, old-session
  invalidation after rotation, typed-handle deletion binding, full rollback after failed deletion,
  synchronous browser/passkey/device revoke, source unlink, approved-pairing cancellation, opaque
  job queueing, audit-link redaction on profile purge, new/existing-source pairing, wrong-poll and
  replay denial, post-approval competing-profile rollback, exact activation, immutable pairing
  binding, inventory isolation, lifecycle IDOR/replay denial, quarantine separation, stale challenge
  invalidation, approved-pairing cancellation, recursive device revoke, audit-failure rollback, and
  the public ceilings of 32 lifetime sources and 64 active/unexpired-approved device authorities per
  profile. Passkey scenarios additionally prove exact credential/profile binding, unknown/revoked
  lookup equivalence, one-time login, atomic audit rollback, monotonic usage state, inventory
  isolation, add/revoke replay denial, last-key protection, and the public ceilings of 32 lifetime
  passkeys and 32 active sessions. Recovery scenarios additionally prove bounded batch rotation,
  minimal profile-free lookup, immediate used-PHC scrub, one-code/one-authority use, exact
  challenge/context completion, terminal authority, deletion revoke, activated-device preservation,
  oversized/replay/role denial, atomic rollback, and fail-closed behavior at the lifetime-passkey
  provenance ceiling. These identity/pairing procedures do not perform OAuth, Argon2id, WebAuthn, or
  pairing-possession Ed25519 cryptographic verification internally. The closed Web pairing adapter
  now derives the keyed poll lookup, obtains only one matching approved tuple, runs the separate
  strict verifier, and calls activation only on success; the SQL procedure independently rechecks
  the full binding atomically. No HTTP route can reach that composition, and the separate later
  request-signature kernel does not approve or activate a pairing.
- Community ingest PostgreSQL scenarios prove exact activated device/source binding, minimal lookup,
  strict identifier/version/date/token/digest and 31-entry bounds, canonical millisecond time,
  server-time freshness, exact duplicate acknowledgement, mutated idempotency and nonce replay
  rejection, whole-snapshot decrease quarantine, quarantined-source retention, paused/revoked/
  deletion-pending rejection, same-source multi-device replacement without summing, owner-level
  monotonic and exact accepted-snapshot/entry provenance triggers, 15-minute nonce expiry markers,
  30-day raw-snapshot expiry markers, and a Jobs-only server-time cleanup procedure with strict
  1-to-1000 batches, idempotent reruns, live-row preservation, entry cascade, and raw-reference
  clearing that preserves current values. Pairing-retention scenarios separately prove bounded
  oldest-first removal of expired pending, approved, and cancelled transactions plus their pending
  keys, approval-challenge cascade, idempotency, live/activated preservation, role denial, and
  private-mutex failure. Ingest also applies the server grace deadline before its
  profile/source/device locks: a late whole snapshot is retained as `season_closed` but updates no
  accepted source/day state. No deployed/live HTTP Ingest API, live Ingest/Jobs database
  integration, or scheduler exists; the local server/application composition has only synthetic,
  mock-pool, injection, and loopback evidence, and the local runner described below is the only Jobs
  application boundary.
- Community scoring PostgreSQL scenarios prove immutable `community_v1` formula parameters and
  season binding, ISO Monday-to-Sunday grouping, exact logarithmic rounding, numeric overflow
  protection, one profile cap after distinct-source aggregation, weekly caps, active-day and
  contributing-source counts, shared rank without a raw-token tie breaker, deterministic
  noncompetitive display order, hidden-profile and quarantined-source exclusion, seven daily rows
  per participant, a state-free no-op for open weeks without source data, semantic idempotency,
  generic failure, rollback, a 30-second statement deadline, and Jobs-only authority. The private
  materialization stores no raw token total or source ID. Finalization scenarios additionally prove
  the exact Wednesday 00:00 UTC boundary after a 48-hour grace period, early-finalization rollback,
  bounded no-data closure, terminal idempotency, refresh denial, direct metadata/score mutation
  denial, late-snapshot quarantine, and profile-purge compatibility. Public-read scenarios prove an
  exact ten-field allowlist, active-only filtering, post-hide shared-rank/display re-numbering, a
  100-row result ceiling, open/finalized metadata, a five-second statement deadline, generic input
  failure, Web-only authority, and Ingest/Jobs/Admin denial. The response-only contract separately
  proves constant Community/self-reported metadata, the same ten-field allowlist, a top-32 ceiling,
  empty results, bounds, unique display positions, private-field rejection, and generated drift. A
  server-only Web mapper additionally rejects malformed or accessor-backed adapter output, unknown
  columns, more than 32 rows before row traversal, contract drift, inconsistent season metadata,
  non-contiguous display positions, duplicate handles, and invalid SQL rank/order semantics. It
  returns a frozen canonical response or throws one generic non-reflective message with a bounded
  cause code. A server-only `pg` adapter now adds namespaced Web-login settings, loopback-only
  development cleartext, certificate-verified production TLS, a four-connection pool, fixed
  connect/query/statement/lock/idle/lifetime ceilings, and one parameterized top-32 query with
  explicit date-to-text casts. It verifies the effective Web role, distinct non-privileged login
  with only Web membership, database capability, search path, and read-only state before every
  query; destroys a failed client; releases a healthy client before mapping; and returns only stable
  non-reflective error/signal codes. Config, pool, and store tests cover positive and negative
  boundaries without a live deployment credential. The local route is wired to this adapter, but no
  cache, live login/certificate, audited correction flow, or scheduler exists.
- A local server-only enrollment application now parses one exact 1 KiB invite form, immediately
  reduces the canonical 256-bit secret to SHA-256, and seals the digest/preferences with independent
  32-byte OAuth state and S256 PKCE material in a ten-minute callback-path AES-256-GCM cookie.
  GitHub authorization requests no extra scope. The callback has an exact host/path/query, a
  ten-second deadline, fixed no-redirect/no-cache/no-browser-credential requests, and returns only a
  positive safe numeric GitHub ID while discarding the access token and every other response field.
  It seals a 15-minute pending session before one fixed atomic `enroll_profile` call on the probed
  read-write Web/Auth pool. Initial passkey options create one five-minute session/context-bound
  database challenge; the verifier requires a discoverable credential, user presence and
  verification, attestation `none`, ES256 or RS256, and exact challenge/origin/RP/type before one
  atomic consume-register-and-session-rotate query. Success creates a fresh 30-day passkey-bound
  session and revokes the pending session. Returning login generates a profile-free discoverable
  challenge with no credential allowlist and keeps it only in a separate encrypted cookie. After
  canonical credential lookup, exact `webauthn.get` challenge/origin/RP/type/signature/UV and backup
  verification, one fixed call creates and consumes the challenge while minting a 30-day
  passkey-provenance session. Failed cookie sealing compensates by revoking that new session. Every
  account render can use the exact possessed session for fixed `read_passkey_inventory`,
  `read_profile_visibility`, and active-only `read_source_inventory` calls. The device mapper
  accepts at most 64 rows under the database authority ceiling, groups at most 32 opaque sources,
  rounds activation to a UTC date, and renders only source ordinal/state plus device
  label/platform/version. Source IDs, internal key/profile IDs, public keys, and exact lifecycle
  times stay out of HTML; only the exact opaque device ID enters its hidden revoke form. Revision
  0016 preserves both private inventory and immediate owned-device revoke while public visibility is
  hidden. One fixed materialized statement invokes `revoke_device`, returns only a boolean, and
  appends a bounded audit reference. The passkey mapper accepts 1-to-32 ordered closed rows,
  requires one current active authenticator, rounds creation to a UTC date, and keeps credential
  IDs, keys, sign counters, exact activity timestamps, and profile IDs out of HTML; only a revocable
  target's opaque passkey ID enters the authenticated control. A same-origin bounded form maps only
  `public`/`hidden` to the fixed `set_profile_visibility` capability. Hiding immediately removes the
  profile from public score reads without pausing source sync, publishing restores visibility, and
  repeated state is a no-op. Addition validates and seals the bounded NFC label before prompting,
  generates independent five-minute existing-key assertion and new-key registration challenges, and
  binds both to the session/profile/RP/origin context. Exact verification of both responses reaches
  one materialized consume-and-add statement; failed consume never invokes add, while insert/audit
  failure rolls back consume. The existing database lifetime cap closes concurrent additions.
  Revocation accepts one owned non-current active target, seals a five-minute
  session/target/RP/origin-bound continuation before the fixed challenge call, requires a fresh
  exact user-verified assertion, and uses one atomic consume-and-revoke query. Current, last,
  foreign, malformed, expired, and replayed attempts fail generically; activated devices remain
  separately revocable. Profile deletion accepts only the session's exact typed handle before the
  prompt, seals a five-minute continuation, and binds a fresh required-UV assertion to the exact
  session/profile/handle/RP/origin context. One materialized statement consumes that challenge and
  invokes the existing atomic hide/revoke/unlink/enqueue procedure with server-generated job/audit
  IDs and a fresh opaque 32-byte purge reference. Success clears all browser auth cookies; failure
  remains generic and retains them. No purge worker, cache invalidation, or restore replay is
  implemented. Inventory dependency failure renders a generic unavailable state without removing
  logout. Every POST body is stream-bounded, compressed bodies and duplicate cookies fail closed,
  and admission is held from the first body read through dependency settlement; overload cancels the
  body without a queue. Cookies are HttpOnly/SameSite=Lax/secure-on-HTTPS with narrow paths,
  callback URLs are excluded from Next development request logs, and responses are generic,
  `no-store`, and `no-referrer`. EN/RU join, passkey, returning-login, passkey-inventory,
  active-account, profile-visibility, active-device inventory/revoke, passkey add/revoke, deletion,
  and logout UI is present. Each route has four-call local admission. The CSP permits GitHub only as
  the exact OAuth `form-action`; no remote script/connect/asset/frame capability is added. The two
  exact-pinned SimpleWebAuthn packages are confined by effective lint policy to one server verifier
  and one browser component; licenses, full 23-record lock addition, production asset budget, and
  online advisory state were reviewed. Tests cover configuration, cookie purpose/tamper/ambiguity,
  invite grammar/minimization, state, PKCE, token minimization, fixed SQL and role probes,
  continuation-before-write ordering, replay and dependency failure shapes,
  profile-free/database-state-free login options, atomic login settlement, closed account inventory,
  exact-session idempotent visibility change, independent-challenge atomic add, session/target-bound
  revoke, current/foreign/replay denial, exact-handle/session-bound deletion, atomic consume/delete
  settlement, active-only device mapping, hidden-profile inventory/revoke,
  cross-origin/duplicate-form denial, origin/body/admission/logout policy, actual browser-adapter
  calls, EN/RU, and accessibility. A `localhost` Next dev-server smoke also proves the join page,
  exact no-scope GitHub redirect and callback-only cookie, state-bound cancellation, cross-origin
  rejection, missing-session denial, cookie-clearing logout, and callback-query suppression in
  development logs. This is HTTP/runtime evidence only, not visual browser, OAuth-provider,
  authenticator, or database E2E. There is no invite issuer UI, recovery, pairing approval,
  aggregate/distributed attempt policy, abandoned-state cleanup, live OAuth/authenticator/database
  integration, monitoring, or deployment evidence.
- A second dormant server-only Web pairing adapter reuses the same environment-owned narrow Web/Auth
  login through a separate four-connection read-write pool. The start application accepts only a
  closed canonical public-key/label/version/OS/architecture request, generates fresh pairing and
  pending-key UUIDs, a 32-byte poll token/challenge, a 12-symbol 60-bit code, and a nine-minute
  expiry, derives separate primary poll/code HMAC digests, and invokes only the fixed start
  procedure. The human-code primary/optional-secondary keys must also differ from every poll key.
  Malformed admitted input performs fixed-shape local material/HMAC work without a database write.
  Every checkout verifies the exact Web role, distinct narrow login, sole membership, database
  capability, search path, and read-write state. One fixed activation query returns at most one
  approved/unexpired pairing ID/challenge/public key; for every structurally valid lookup outcome,
  the high-level adapter runs the strict ADR 0026 proof and alone invokes the exact activation
  procedure with a server-generated `dev_` ID, audit UUID, and common `req_` ID. Each transport-free
  application admits four unsettled attempts, holds each through a 250-millisecond floor, and
  returns only its frozen success shape or generic failure plus a request ID. The Web suite now
  contains 495 tests; pairing coverage includes material/code bounds, HMAC vectors/rotation and key
  separation, hostile configuration/input/result shapes, fixed start/lookup/activation queries,
  driver confinement, role drift, strict proof selection, IDs, admission/timing, generic failure,
  clearing, release, and close. No pairing approval/HTTP route, client identity or distributed rate
  limit, live login/TLS connection, cleanup schedule, capacity evidence, real key, or deployment is
  claimed.
- A private TypeScript Jobs workspace now accepts exactly either fixed 1000-row ingest/pairing
  cleanup command or one canonical Monday refresh/finalization command. It revalidates closed plain
  job data, reads only redacted `VIBERACING_JOBS_DATABASE_*` configuration, permits cleartext only
  for explicit development/test loopback, and otherwise requires certificate-verifying TLS with a
  DNS hostname. Its pool maximum is one; client connect/statement/query deadlines are 2/31/32
  seconds, outside the database functions' 30-second deadline. Every checkout probes the exact
  `viberacing_jobs` effective role, a distinct non-privileged login with only that membership,
  CONNECT without CREATE/TEMPORARY, and `pg_catalog,pg_temp` search path. It then selects one of
  four fixed prepared function calls, requires one exact allowlisted result row, holds the client
  through settlement, destroys it after failure, and closes the pool on every acquired CLI path.
  Success and failure output are stable sentences without command/date/count/config/SQL/exception
  reflection. One hundred seven focused tests cover config, TLS, pool/signal behavior, hostile
  command/object/array/result inputs, exact SQL parameters, role mismatch, settlement/release/close,
  CLI output, and failure translation at 100% statement/branch/function/line coverage. A lint-policy
  regression also prevents every production module except the fixed pool adapter from importing
  `pg`. A TypeScript production build passes. No live Jobs login, Node-to-PostgreSQL integration,
  scheduler, monitoring backend, retry policy, capacity result, correction, deletion purge, or
  deployment is claimed.
- Twenty-three deterministic cross-connection races hold a relevant invite, challenge, session,
  source, device, pairing, or profile row, or a season advisory lock; tag every session; and observe
  every contender in the holder's transitive PostgreSQL blocker chain before releasing it.
  Protective races additionally prove the first contender is blocked before the competitor starts.
  PostgreSQL proves exactly one winner for a shared invite, initial-passkey registration challenge,
  active-session rotation, pairing, concurrent creation at the 32-source ceiling, concurrent
  approval at the 64-live-authority ceiling, passkey-login challenge, and recovery code. Protective
  races prove profile deletion dominates concurrent session rotation, source pause dominates
  concurrent pairing approval, source unlink dominates concurrent device activation, passkey revoke
  dominates concurrent login, recovery-code rotation dominates concurrent old-code start, and
  recovery completion dominates concurrent old-passkey login. Ingest races prove concurrent exact
  retries create one snapshot, two devices for one source/date converge on the monotonic maximum
  rather than sum, source pause precedes a later submission, and device revoke precedes a later
  submission. Opposing-order multi-season payloads both block first on the same lower season and
  complete without an advisory-lock cycle. An ordered origin-replay race proves two contenders for
  one locked expired tuple produce exactly one fresh consume and one replay rejection. A second
  origin race holds the row past a two-second proof expiry, returns `false`, and removes the tuple
  written after that wait. A cleanup race proves one Jobs call retains its transaction lock while a
  second call waits, after which both bounded ingest batches complete without removing live state. A
  separate pairing-cleanup race proves two Jobs callers serialize, delete each expired
  transaction/key pair once, and preserve live pending state. A scoring race proves two Jobs
  refreshes serialize on a private mutex and converge on one semantic open-season state. A
  finalization versus late Ingest race proves the shared `season → profile → source → device` lock
  order is deadlock-free, the final projection is terminal, and the late payload remains
  quarantined. No losing enrollment or rotation artifact survives, and no protective race leaves
  browser, recovery, or pending device authority attached to a deleted profile, revoked credential,
  old code, or protected source. The recovery races also prove terminal timestamps are captured
  after lock acquisition, and missing expected challenge, credential, authority, session, code, or
  pairing rows fail closed rather than passing through SQL `NULL` semantics.
- A strict Next.js 16 and React 19 web workspace with a synthetic EN/RU race, accessible
  leaderboard, demo profile, three repository-owned CSS/canvas themes, reduced-motion controls, and
  a deterministic 16-by-8 pixel-car renderer.
- A client payload that contains bounded daily scores and public presentation fields, never raw
  token buckets, account identifiers, source identifiers, URLs, email addresses, or local paths.
- A closed-enum CarRecipe boundary with fixed sprites and palettes; arbitrary HTML, CSS, SVG, URLs,
  colors, text, and uploads are not accepted.
- Per-response nonce CSP, browser-isolation and capability headers, no remote image patterns,
  globally disabled Next.js image optimization, production HSTS, disabled framework branding, and an
  explicit Turbopack repository root that prevents parent-workspace inference.
- Device-local persistence limited to locale, theme, and motion preferences. The synthetic preview
  has no accounts, analytics, trackers, remote fonts, or runtime secrets. Its only environment
  setting is a strictly parsed, server-only public origin for absolute social metadata; hosted
  deployment without a real HTTPS DNS value remains forbidden. The separate enrollment slice stores
  account state only in encrypted HttpOnly cookies and reads its exact server-only configuration
  lazily; the default preview still needs none of it.
- Four hundred ninety-five unit, component, interaction, security-header, localization, scoring,
  HTTP-route/admission, database-adapter configuration/pool/store, and accessibility tests. The
  coverage gate currently reports 88.30% statements, 86.74% branches, 95.54% functions, and 88.43%
  lines over product components and libraries; framework entrypoints are verified by the production
  build instead of artificial unit coverage.
- A root verification pipeline that now includes contract generation/drift; contract, Ingest, and
  Jobs lint, strict type checking, coverage, and production compilation; plus web lint, strict type
  checking, coverage, and a production Next.js build on every deterministic CI run.
- A manifest-driven production artifact gate with nine black-box cases and enforced limits for
  initial raw/gzip bytes, application/CSS gzip bytes, asset count, source maps, fonts, path safety,
  and standalone output. The current initial route is 183,720 gzip bytes across eight assets;
  application JavaScript remains within its separate 10,000-byte budget at 8,983 gzip bytes and CSS
  remains within 5,000 bytes at 3,303 gzip bytes.
- A lock-integrity-bound metadata cache for platform-specific npm packages, ten license-checker
  regression cases, and two expiring reviewed overrides: one resolves Next.js to patched
  `postcss@8.5.19`, and one removes unused `sharp`/libvips code while Next.js image optimization
  remains disabled. The official registry audit reports zero known vulnerabilities after resolution.
- A project-generated social preview with accessibility text, checksum/source record, explicit AI
  disclosure, and byte-preserving removal of service C2PA metadata. The public-file gate now parses
  PNG structure and CRCs and rejects unreviewed ancillary chunks; seven focused policy assertions
  and a malformed-PNG black-box case cover the boundary.

The local Compose smoke test pulled the pinned index, reached `healthy`, exposed only
`127.0.0.1:54329`, returned the expected synthetic database and user from a read-only query, and
then removed its test container, network, and volume. The separate database integration project also
reached `healthy`, validated and applied revisions 0001 through 0016 from the checksum manifest,
passed 24-table state/ownership/RLS assertions, twenty-three observed lock-wait races, eight
relation-denial checks, twenty-eight cross-capability denials, and the identity, passkey, recovery,
pairing, source/device lifecycle, Community ingest, origin replay, ingest-retention,
pairing-retention, scoring, finalization, and public score scenarios, then removed its portless
container, network, and ephemeral storage.

These checks are defense in depth. They do not prove that a file is safe, fully decode every binary
format, fully parse/render Mermaid, perform legal analysis, or replace manual staged-diff review and
GitHub secret scanning. Deterministic verification validates external-link policy but does not make
network requests. The hardened online link mode is currently blocked here because this environment
resolves public hosts through a non-public proxy address; it correctly failed closed. The CI
definition is locally parsed and policy-tested but has not run on GitHub because no remote
repository is configured yet.

Local responsive, computed-contrast, interaction, browser-console, development-header, and
production-header observations are recorded in the
[Phase 1 browser matrix](testing/PHASE1_BROWSER_MATRIX.md), including the light-theme contrast
defect found and corrected during review. The report names its local-only limitations.

## Phase 0 still pending

- A confirmed public maintainer identity, conduct-reporting channel, CODEOWNERS entry, and remote
  GitHub security/branch settings; private details will not be inferred from the workstation.
- Hosted CI evidence and a successful hardened online-link run from a public-DNS runner.

## Phase 1 still pending

- Browser-level responsive visual snapshots for all themes and both languages.
- Keyboard-only, screen-reader, forced-colors, and cross-browser release evidence.
- Runtime Core Web Vitals for animation-on and reduced-motion modes.

## Not implemented yet

Invite issuance UI, recovery Argon2id/pepper and replacement-passkey application handling, pairing
browser approval and connector client, remaining source lifecycle step-up applications,
client-identity and distributed admission/rate/deadline policy, anonymous login/pairing/recovery
edge limits, cleanup for abandoned enrollment/recovery challenges and consumed login ceremonies, an
Ingest host/port/TLS deployment entry point, trusted edge routing and direct-origin denial, live
secret-manager/edge key injection, the Ingest live PostgreSQL login/TLS connection, distributed
rate/backpressure controls and load evidence, scheduled execution/monitoring of ingest- and
pairing-retention cleanup, cleanup for other expiring state, the Jobs scheduler/live login and
application-to-PostgreSQL integration, audited corrections, deployed public-score delivery, purge
workers, connector executable discovery/link/ownership and artifact/version admission, live Codex
and cross-platform process evidence, supported operational account/usage integration, secure
device-key storage, upload/CLI/packaging, release signing, deployment, and public beta operations
remain proposed. The local Ingest key reader, kernel, adapter, application composer, and Fastify
server now prove bounded protected configuration, raw-envelope/JSON/HTTP framing, origin-proof,
contract, strict Ed25519 device, least-privileged pool, fixed-query, orchestration,
no-queue/deadline policy, and result/problem serialization behavior, but not those deployed edge,
live persistence, capacity, or operational boundaries. A bounded database score projection,
versioned response-only schema, fail-closed server mapper, bounded PostgreSQL adapter, and local
HTTP route now exist, including URL/media parsing, admission/deadline policy, store translation, and
final serialization. Cache/invalidation, CarRecipe, streak/freshness, profile detail, client-rate
and production-capacity controls, monitoring backend, deployment login, certificate, edge policy,
and live adapter integration do not. The visible web scoring and ranking experience now consumes a
validated current-week response from the local route when its separately provisioned database login
works, but local defaults and every unavailable/error path remain clearly synthetic. No working
database/OAuth login, deployed data, cache, or end-to-end real-user ranking evidence exists.

## Evidence commands

Run from the repository root:

```text
pnpm run verify
pnpm run check:contracts
pnpm run check:database
pnpm run test:database:integration
pnpm run test:ingest:coverage
pnpm run build:ingest
pnpm run test:jobs:coverage
pnpm run build:jobs
cargo test --workspace --all-targets --all-features --locked
pnpm run check:web-build
pnpm run check:public:staged
git diff --cached --check
```

`pnpm run check:publication` is intentionally failing in this pre-public tree. It becomes a required
passing gate only after the public maintainer identity, CODEOWNERS, GitHub remote, and private
reporting settings are real and verified.

The staged check reads blobs from the Git index, not potentially different working-tree copies.
Review `git diff --cached` manually before every commit.
