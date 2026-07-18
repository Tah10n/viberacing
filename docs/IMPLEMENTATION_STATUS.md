# Implementation status

This page records only evidence that exists in the public working tree. The
[project plan](PROJECT_PLAN.md) remains the source of intended behavior.

## Current phase

Phase 1 product code is locally complete, with the manual release-evidence items below still open.
The Phase 2 language-neutral contract and SQL persistence foundations now include database-only
passkey login, multi-passkey management, restricted recovery, Community usage ingest, bounded
ingest- and authentication-retention cleanup, primary profile deletion, open-season scoring,
terminal season finalization, a public score-only database projection, and a separate compatible
active-CarRecipe race projection plus a third compatible rounded-freshness/optional-streak status
projection and their server-only projection-to-contract mappers; Phase 3 database-only source/device
lifecycle, same-source deduplication, and bounded pairing-retention cleanup have also started. A
server-only public problem-response factory, closed query/OpenAPI operations, and locally
implemented public score/race/status GETs now exist. The visible home race requests the current
server-selected Community week from the separate same-origin status route, replaces only its
race/leaderboard after closed browser-side validation, uses an exact current approved recipe or
repository-owned absence fallback, shows only complete-UTC-day freshness and an optional
preference-gated streak, lets a handle select a same-page summary from those public fields, exposes
that selection through a canonical public-handle URL and public-account link, and retains a labeled
synthetic fallback on failure. Local identity slices now implement exact same-origin bounded forms,
GitHub OAuth state and S256 PKCE with no extra scope, purpose-separated encrypted HttpOnly
continuations, atomic profile/session creation, required initial WebAuthn registration, returning
discoverable-credential login, a session-scoped minimal passkey inventory, an active account page,
immediate public-profile hide/show, source inventory and pause, fresh-passkey paused-source
reactivation and terminal unlink, fresh backup-passkey addition, revocation of an owned non-current
passkey, a bounded active-device inventory with immediate owned-device revoke, fresh-passkey
recovery-code rotation with one-time display, an exact-handle fresh-passkey profile-deletion
request, one-time recovery-code replacement-passkey sign-in, and database-backed logout. Login
options retain the profile-free challenge only in a separate encrypted cookie; valid proof alone
reaches one atomic create-consume-session call. Its GitHub, passkey-verifier, database, and browser
evidence is injected or synthetic; no working invite issuer, OAuth registration, secret, live
authenticator/database login, distributed edge abuse control, scheduled recovery/deletion cleanup,
cache/backup/tombstone purge, restore replay, notification, or deployment is supplied. A local
one-shot Jobs runner invokes only the seven existing maintenance procedures through a bounded
least-privileged adapter. A local Ingest kernel now bounds and authenticates the exact Community
sync envelope, consumes an injected origin nonce, parses bounded JSON, validates the generated
contract, and strictly verifies the source-bound device request. A separate bounded Ingest
PostgreSQL adapter revalidates that output and exposes only atomic origin-nonce consumption, device
lookup, and submission through a probed least-privileged pool. A protected local reader supplies one
mandatory and one optional rotation origin key directly to the verifier without returning raw
configuration. A forced-RLS replay tuple, Ingest-only atomic consume, and separate Jobs ingest,
pairing, authentication cleanup, and primary profile deletion paths now have real isolated
PostgreSQL evidence. A transport-free Ingest application now composes those exact verifier and
database capabilities, generates a server-owned request ID, waits for submission, and returns only a
validated acknowledgement or generic problem decision. A bounded local Fastify server factory now
preserves exact raw HTTP evidence, admits four application calls without a queue, applies fixed
parser/header/connection/deadline policies, and serializes only revalidated sync
acknowledgement/problem contracts. A library-only Rust connector foundation now bounds the stable
App Server handshake and a candidate `0.144.5` account/usage parser, discarding account/summary
fields and returning only bounded normalized daily usage in caller memory. An inaccessible one-shot
supervisor composes those exact states through fixed local pipes, a fixed child argument, no ambient
environment, bounded stdout/stderr/time, terminal-event draining, and reap-before-success cleanup.
An inaccessible reviewed sync context now lets a candidate-only composer consume those minimized
entries into the exact bounded JSON body, SHA-256 digest, nonce encoding, and device-signature
message shared with the production Ingest verifier. An isolated one-use signer removes public
unsigned access, consumes that value only with an inaccessible device-bound key capability, and
returns the same body plus five exact signed header values. The shared synthetic vector is strictly
verified across Rust and Ingest. A second inaccessible signer and pure Web verifier now agree on an
exact synthetic pairing-possession proof. A transport-free Web/Auth start application now generates
fresh server identifiers, 32-byte poll/challenge material, a 60-bit human code, separate protected
poll/code verifiers, and a nine-minute pending transaction from closed device metadata through one
fixed call on the probed read-write Web pool. A second activation application derives two
fixed-shape HMAC poll-verifier candidates, selects at most one approved row, runs that strict proof,
and alone invokes exact atomic activation with server-owned identifiers behind four-call admission
and a 250-millisecond settlement floor. The authenticated `/connect` flow supplies browser approval.
Two closed local POST routes now compose both applications behind one shared four-call admission
boundary, versioned request/response validation, generic problems, and revision 0022's fixed
global-and-64-bucket distributed rate windows. A bounded Rust `connect` command generates a key and
client rate ID with the OS CSPRNG, persists resumable state only in a native credential store, and
performs the exact start/proof/poll sequence. A separate Windows x86_64 `sync` command now
canonicalizes and hash-admits one explicit exact `0.144.5` artifact, holds its file against write
substitution through launch, uses a fresh empty working directory and the existing bounded
supervisor, creates fresh context from the active native record, and sends one exact signed body to
the fixed endpoint without retry or edge-origin headers. Its loopback HTTP evidence validates only
the five device headers and closed acknowledgement. A separate exact `forget-local` command derives
the same native-store account from a canonical origin and bounded label, invokes only idempotent
credential deletion, and emits one fixed warning that server device authority was not revoked. It
does not load the record, construct a signer, start Codex, or make a network call. No live database
connection, real-account end-to-end result, released artifact, or deployment is claimed. Candidate
release, schema, fixture, synthetic-process, admission, composer, pairing, signer, and
loopback-upload evidence does not populate the support matrix. Phase 0 hosted-publication controls
remain blocked on real maintainer identities and GitHub configuration. No production-ready anonymous
edge perimeter, distributed recovery perimeter or cleanup, production secret-manager/edge key
injection, trusted external Ingest TLS/edge route, production deployment, live Web/Jobs/Ingest
database login/TLS integration, released or operational connector, supported Codex version,
real-user ingestion, end-to-end public ranking, or finalization scheduler exists.

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
- A complete-reachable-history gate that refuses shallow clones; structurally validates one
  non-placeholder Author and Committer identity plus one exact author-matching final DCO sign-off;
  and scans refs, ordinary commit-message text, every historical path/blob, forbidden modes,
  oversize objects, and printable binary metadata. Eleven black-box cases include missing,
  duplicate, mismatched, and placeholder DCO/identity state plus deleted-history and
  unreachable-object scope.
- The 67 pre-policy bootstrap commits now use the owner-confirmed public Git identity for Author,
  Committer, and one exact matching DCO sign-off. The reviewed rewrite preserved every tree, parent,
  author/committer date, subject/body, and the non-commit Codex capture ref; no remote was
  configured during the rewrite.
- Pinned Node, pnpm, and Rust toolchains with committed pnpm and Cargo lockfiles.
- A pnpm workspace with release quarantine, trust and source policy, exact external direct
  dependencies in every bounded workspace, `workspace:*` internal references, private workspace
  manifests, and install-script denial by default.
- Prettier, Markdownlint, CSpell 10.0.1, YAML/configuration policy, and Rust formatting, check,
  test, and Clippy workspace gates.
- An offline external-link gate with 12 reviewed hosts, HTTPS/credential/port/query/address rules,
  no dormant host permissions, and eight black-box cases. A separate online mode pins public DNS
  results, sends no credentials, follows no redirects, and is excluded from deterministic PR CI.
- A deterministic dependency inventory covering 522 locked npm packages, 209 Cargo packages, two
  pinned GitHub Actions, and one pinned local-development container. License expressions, installed
  manifests, every root/workspace importer, dependency scopes, direct notices, and external-artifact
  usage are checked with ten black-box cases.
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
  candidate `0.144.5` manifest records the official release tag, immutable commit and artifact
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
  status, and forced cleanup. The opaque launch capability has no public constructor. The private
  Windows x86_64 sync command can construct it only after an explicit canonical path matches the
  exact candidate artifact size and SHA-256 while a no-write-sharing handle remains open. There is
  no automatic discovery, macOS/Linux admission, clean-machine real-account result, supported Codex
  version, installer, or released binary. A candidate pairing signer now consumes inaccessible
  pending-key/challenge capabilities and signs one exact domain-separated
  transaction/challenge/public-key message. A server-only Web kernel independently validates exact
  approved material and the canonical signature under strict Ed25519 semantics. Five Rust and seven
  Web cases share the same synthetic key/vector, reject changed or malformed inputs and zero
  material, and prove copy-before-await behavior. There is now a protected primary/secondary
  poll-token verifier plus closed local start and activation database/application compositions. The
  signed-in `/connect` path supplies WebAuthn approval, and the versioned HTTP routes plus
  native-store Rust client complete a local pairing path. There is still no live database login,
  deployed edge, cross-platform result, or released connector. A separate candidate-only composer
  consumes the real parser output behind another capability with no public constructor. It
  revalidates source/sync/device IDs, canonical UTC time, and daily bounds; manually emits the exact
  seven-field body; computes the SHA-256 digest; and builds the exact unpadded base64url,
  LF-separated device message. An isolated one-use signer consumes that otherwise inaccessible value
  with a device-bound Ed25519 key capability, rejects an exact device mismatch, signs only the fixed
  message, and returns the same body plus five header values. Nine Rust sync cases plus one
  production-path Ingest case share and strictly verify an exact synthetic body, public-key, and
  signature vector. Prepared/signed private byte buffers and the upstream key are zeroed on drop.
  The one-shot sync command now constructs those private capabilities only from an active record,
  fresh OS-random sync ID/nonce, and canonical `20xx` millisecond UTC. It performs one no-proxy,
  no-redirect fixed-path POST and validates a bounded request-ID/sync-ID-matched acknowledgement;
  five focused cases cover time, binding, exact HTTP egress, excess accepted-count rejection, and
  refusal before connection. The pairing command supplies fresh OS entropy, a bounded local
  clock/retry policy, native key custody, and exact pairing transport. The separate sync command
  supplies only the local candidate context and one upload; no schedule, deployed egress, packaging,
  release, or support claim exists, and the compatibility matrix remains empty. A third fixed
  `propose-car` command starts no Codex process: it accepts only explicit recipe enums and a
  canonical bounded seed, loads the active native device key, creates a fresh nonce/time, signs the
  proposal-specific exact body message, sends one no-retry fixed-path POST, and validates only a
  generic acknowledgement. Four Rust proposal cases share the exact body/message/key/signature
  vector with Web. A self-contained repository Agent Skill now reduces an existing styling request
  to only those exact enums and seed, requires explicit shell-safe origin/label values, invokes the
  fixed command once, and recognizes only its exact generic success line. A dedicated checker
  derives the schema/CLI expectations from production sources, and twelve mutation cases prove enum,
  shell, invocation-allowlist, retry, authority, output, front matter, and UI-metadata drift fail
  closed. No released connector, live endpoint, edge policy, or deployment is claimed.
- An ADR lifecycle/template and forty-one accepted design decisions covering Community trust,
  multi-source aggregation, identity/device authority, restricted recovery, edge/service/database
  isolation, CarRecipe, public repository safety, season finalization, and the public score
  projection/response/adapter, common HTTP problem boundaries, and the locally implemented public
  score operation, bounded maintenance runner, bounded Community sync verification kernel,
  least-privileged Ingest PostgreSQL adapter, protected origin-proof key configuration, persistent
  atomic origin replay, transport-free Community sync application composition, and the bounded local
  Fastify HTTP boundary, plus the fail-closed Codex handshake, candidate account/usage adapter, and
  inaccessible bounded one-shot process supervisor, exact-body sync composer, isolated one-use
  device signing boundary, bounded pairing-possession proof, bounded pairing activation/start
  compositions, bounded pairing cleanup, bounded connector pairing transport/native key custody,
  one-shot candidate Community sync, bounded authentication cleanup, the local Railway-shaped Ingest
  host, bounded primary deletion purge, the session-owned CarRecipe proposal boundary, and bounded
  CarRecipe-proposal cleanup, public active-recipe projection, bounded device proposal ingress, and
  bounded local agent proposal orchestration, and the bounded public race-status projection.
- Architecture-contract validation and black-box regression cases for missing threat sections,
  duplicate/incomplete abuse cases, privacy-class drift, invalid/orphaned ADRs, unclosed Mermaid
  fences, and accidental compatibility claims.
- Agent-skill validation and eleven black-box regressions for schema/CLI drift, command widening,
  contradictory invocation input, unsafe shell input, retry permission, stale success output,
  front-matter widening, and UI metadata.
- Thirteen canonical JSON Schema 2020-12 contracts for bounded Community connector sync and pairing
  start/poll requests and responses, a non-sensitive sync acknowledgement, stable problem details, a
  one-field public score season query, a response-only top-32 Community score page with constant
  trust metadata, a separate compatible race page with one optional exact recipe, a third compatible
  status page with required rounded freshness and optional streak, plus the exact nine-field
  `CarRecipeV1`. Every object is closed; scalar and collection values are bounded; the recipe
  accepts only project-owned enums and a 0-to-65535 seed; reviewed date-range/ISO-weekday extensions
  make the score calendar executable; connector input has an executable writable-field allowlist
  that excludes identity, trust, rank, score, season, moderation, credentials, and prohibited data.
- Deterministically generated readonly TypeScript types, embedded validator wrappers, source digest,
  and an OpenAPI 3.1 document with seven explicitly `implemented-local` Community
  score/race/status/sync, device CarRecipe proposal, and connector pairing start/poll operations.
  Their exact method-specific query/body, response/problem, admission, authentication-reference,
  `no-store`, `Vary: Accept`, generated request ID, and same-origin CORS policies are
  manifest-driven without claiming deployment. All four inventoried authentication/transport
  policies participate in the generated source digest. A manifest/schema/drift checker has 53
  black-box cases covering generated operation/status/evidence semantics, unsafe/duplicate/drifted
  operations, unknown fields, missing bounds, client-derived score aliases, Community
  trust/problem/date drift, private response fields, unlisted/path-traversing schemas, unsupported
  keywords, missing date deduplication, and stale generated output.
- A dependency-free runtime contract validator with fail-closed reflection handling; strict
  calendar/range/ISO-weekday/UTC timestamp and safe-integer checks; depth, node, key, item, and
  issue budgets; and privacy-safe issue output that never echoes unknown property names or submitted
  values. Thirty-two unit/security cases cover valid/invalid query boundaries, hostile structures,
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
  100% statement/branch/function/line coverage. Focused tests use mock pools; the separate opt-in
  integration exercises the same adapter through a synthetic dedicated loopback login. No deployment
  credential, certificate/TLS result, or production connection is claimed.
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
- A bounded authentication-retention database boundary. Revision 0023 gives only Jobs one 1-to-1000
  cleanup under a separate private mutex and independently caps expired challenge and
  restricted-recovery-authority deletion. It removes an authority's source recovery code only when
  that exact row remains used with its verifier already scrubbed; live challenges/authorities,
  unused codes, sessions, passkeys, profiles, and audit evidence remain. Candidate profiles are
  locked in stable order before authority/code rows, matching recovery and deletion transitions.
  Static scenarios, an observed two-worker race, and an observed cleanup-versus-recovery-start race
  prove bounds, role isolation, live-state preservation, worker serialization, and the
  cross-capability lock order. No scheduler, live Jobs login, production cadence, backup proof,
  capacity result, or deployed retention policy is claimed.
- A bounded primary profile deletion database boundary. Revision 0024 gives only Jobs one maximum-10
  due queue/retry purge under stable acquisition of its fixed five maintenance mutexes. It requires
  committed `deletion_pending` state, removes every restrictive profile-bound pairing and only its
  still-authority-free pending key first, marks the exact opaque job terminal, then cascades the
  profile's invite, sessions, passkeys, recovery state, sources, devices, usage, and personal score
  rows in the same transaction. Audit and job profile links are nulled; the opaque terminal job
  remains and no unkeyed tombstone is invented. End-to-end request/purge, batch, retry/future,
  state-drift rollback, role-denial, idempotency, two-worker, and purge-versus-auth- cleanup
  scenarios pass in real isolated PostgreSQL. No scheduler, live Jobs login, published deletion
  window, terminal-job retention, cache/backup purge, keyed tombstone, restore replay, monitoring,
  capacity result, or deployment is claimed.
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
  serialization/header policy, or socket belongs to this application layer; the separate opt-in
  integration composes it through the host and disposable PostgreSQL. No log sink, deployment
  login/certificate, edge path, connector, or deployment is claimed.
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
  capacity result. This factory still owns no listener or process lifecycle. No edge signer,
  direct-origin denial, trusted deployment route, external TLS evidence, deployment database
  credential, monitoring, connector, load evidence, or deployment is claimed.
- A separate local Ingest host workspace that owns only closed listener configuration, one bind,
  startup composition, and process shutdown. Development/test admits cleartext only on exact IPv4 or
  IPv6 loopback; production requires exact `0.0.0.0:$PORT`, the explicit `railway-edge` external-
  TLS declaration, and a canonical 40-to-300-second Railway drain window. It composes only the
  reviewed configured application and Fastify factories, closes every completed lower boundary on
  startup failure, and returns one idempotent close controller. Signal handlers are installed before
  startup; the first SIGINT/SIGTERM starts a 36-second close deadline, while a second signal,
  deadline, or close failure forces unsuccessful exit. Runtime ESM package exports and a black-box
  emitted-entrypoint check prevent a TypeScript-only or reflective startup failure. Its 121 tests
  have 100% statement/branch/function/line coverage with strict lint, type checking, and production
  builds. The `railway-edge` value is an operator assertion, not proof of Railway, external TLS,
  Cloudflare routing, direct-origin denial, protected secrets, a deployment login, capacity, or
  deployment.
- An opt-in full local Ingest HTTP-to-PostgreSQL gate. It builds emitted contracts, Ingest, and host
  code; starts one disposable `postgres-test` container with an ephemeral loopback-only port;
  applies all 27 reviewed migrations; creates a synthetic login with only `viberacing_ingest`; and
  seeds one synthetic source-bound Ed25519 device. Independently composed signed requests prove an
  accepted write, an exact duplicate under a fresh origin nonce, persistent origin replay denial,
  revoked-device denial, the closed success/problem headers, and four unique server request IDs.
  Owner-only state verification then proves three consumed origin nonces, one device nonce, one
  accepted snapshot/entry/current value, terminal device revocation, and no revoked-device snapshot.
  The command removes its host, container, network, and storage and is required by CI. It proves no
  external TLS/edge route, protected secret delivery, production credential, real-user input,
  monitoring, distributed load control, capacity, or deployment.
- A server-only public HTTP problem boundary that requests exactly 16 cryptographic random bytes,
  returns a frozen opaque request token, owns all eleven status/title/retry mappings including
  explicit 405/406 semantics, validates the complete `ProblemDetailsV1`, and emits only
  `application/problem+json`, `no-store`, and matching `x-request-id` headers. It accepts no inbound
  ID string, CORS setting, cookie, title, status, detail, or cause;
  malformed/accessor-backed/revoked inputs, inherited `toJSON`, and internal failures are
  non-reflective. The local score/race/status routes consume the factory; no log sink retains the
  token.
- Dynamic Node.js `GET /v1/community/scores`, `GET /v1/community/race`, and
  `GET /v1/community/race/status` routes share one boundary with independent fixed response
  validators and database calls. Each creates one request token at entry, rejects bodies and every
  wrong path or missing/duplicate/unknown/non-canonical query, validates the one-field contract,
  performs bounded JSON `Accept` negotiation, and dispatches every other supported method through a
  closed 405 plus `Allow: GET`. Each acquires one of four no-queue leases before lazily constructing
  its store, holds the lease until adapter work and serialization settle, revalidates the final
  page, and emits only `no-store`, `Vary: Accept`, request-ID, and content-type headers without
  CORS. Adapter/configuration availability and admission exhaustion map to 503; projection/invariant
  or unknown failures map to a non-reflective 500. The deadline policy uses the existing two-second
  connect, six-second client-query, and five-second PostgreSQL statement ceilings rather than
  returning early from an outer promise race. The reserved 429 does not claim a client-rate limiter.
- A visible public-race consumer. The dynamic server page derives the current ISO Monday and passes
  only that public label to the client. After hydration, the browser lazily loads its compact
  independent validator and issues one credential-free, `no-store`, same-origin request to the exact
  status route. It accepts at most 32 dense rows with the closed public field set, constant
  Community/self-reported metadata, required complete-UTC-day freshness, optional preference-gated
  streak, and at most one exact current active `CarRecipeV1`, then replaces only the race and
  leaderboard. An absent recipe receives a fixed repository-owned presentation fallback; an omitted
  streak remains absent. Invalid, oversized, non-JSON, failed, or unavailable responses retain the
  clearly labeled synthetic preview. A Community handle selects a same-page summary containing only
  weekly score, rank, active days, source count, rounded freshness, optional streak, and an explicit
  visual-marker car; daily detail, device counts, exact usage or receipt time, and identifiers
  remain absent. The selection uses only one canonical `/?profile=handle#profile` URL value. A
  normal click updates the summary and URL in place while modified clicks retain native behavior.
  Invalid/duplicate values are ignored, a missing current top-32 row stays missing rather than
  selecting the leader, and only a public account renders its own link. The fallback demo garage
  stays synthetic, and no retry, cookie, browser persistence, analytics, or third-party destination
  is added.
- An idempotent cluster-role bootstrap for separate `NOLOGIN`, non-owner Web, Ingest, Jobs, Admin,
  and schema-owner groups. The default database and `public` schema capabilities are revoked;
  database and runtime-role search paths are scoped to `pg_catalog, pg_temp`; the migration
  principal retains explicit connection authority; unexpected group-role memberships fail closed.
- Twenty-nine checksum-ledgered, transactional SQL migrations with bounded lock/statement execution
  and 27 forced-RLS private tables for profiles, invites, sessions, passkeys, recovery codes and
  restricted authorities, session-bound challenges, opaque sources, pending/active/revoked device
  keys, pairing, bounded audit references, deletion work/tombstones, six fixed maintenance mutex
  rows, origin and device nonces, bounded raw Community snapshots, monotonic current source/day
  values, immutable score versions and season definitions, derived season entries/daily scores,
  active CarRecipes and pending proposals, and schema revisions. There is intentionally no GitHub
  token, account email, prompt, repository, credential, arbitrary JSON, or free-form diagnostic
  column.
- Database constraints and triggers enforce unique GitHub bindings, normalized handles, keyed
  verifier lengths, Argon2id recovery-verifier shape, exact device-key/source/pairing binding,
  terminal unlink/deletion states, state-dependent timestamps, and bounded lifecycle values. The
  public-key record itself moves from authority-free pending state to one source/device, then only
  to revoked.
- A Web-only CarRecipe database boundary. Revision 0025 repeats every version/enum/seed constraint
  in two forced-RLS tables, derives `active` or `hidden` profile authority only from the exact
  session proof, permits one pending and one active recipe per profile, and grants only fixed
  propose/read/ approve/reject functions. Approval atomically inserts or replaces the active row and
  deletes the proposal; rejection deletes only that exact proposal. Cross-profile IDs, replays,
  wrong verifier, device, Ingest, Jobs, Admin, direct-table, arbitrary
  color/URL/markup/conversation, and seed/version drift are rejected. Profile purge cascades both
  rows. Expiry is logically enforced for at most 24 hours. Revision 0026 gives only Jobs a separate
  oldest-first, 1-to-1000 physical cleanup serialized by the sixth fixed mutex; it preserves live
  proposals and active recipes. No cleanup schedule or deployed retention evidence exists.
- A separate Web-only device CarRecipe proposal database boundary. Revision 0028 exposes only
  minimal active-device key material and one fixed proposal call to the probed Web role. It locks
  and rechecks active/hidden profile, active source, and active device, consumes a seven-minute
  domain-separated nonce digest, and creates or replaces the same pending server-owned 24-hour
  recipe without touching the active row. Replay, stale/future time, key/device mismatch, paused or
  terminal authority, and every non-Web role are denied in isolated PostgreSQL.
- A separate Web-only Community race projection. Revision 0027 calls the unchanged score read,
  resolves only the current `active` profile behind each visible handle, and left-joins its one
  approved recipe into an exact JSON object. Absence remains SQL `NULL`; proposal rows, IDs, state,
  timestamps, daily/raw usage, and arbitrary content are never returned. The function keeps the
  five-second deadline and 100-row database ceiling. Ingest, Jobs, Admin, and `PUBLIC` are denied.
- A third Web-only Community race-status projection. Revision 0029 calls the unchanged race read,
  derives saturated complete-UTC-day freshness from the latest accepted server receipt in the
  requested season, and derives consecutive positive-score streak from materialized daily scores
  through the closed Sunday or current-day/yesterday grace anchor. The streak crosses prior
  materialized seasons but is omitted when the current active profile disables visibility. A future
  season is suppressed even if score state is materialized outside the reviewed scoring lifecycle.
  Exact timestamps, daily rows, preferences, and private identifiers remain absent. A partial
  positive-score index supports the lookup; the function retains the five-second deadline and
  100-row ceiling. Ingest, Jobs, Admin, and `PUBLIC` are denied.
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
  quarantine. Web additionally has bounded public Community score, compatible race, and compatible
  race-status projections. Ingest has only atomic origin-nonce consumption, minimal active-device
  verification lookup, and bounded Community sync submission; Jobs have only four bounded retention
  cleanup calls, primary profile purge, Community scoring refresh, and finalization. Ingest has no
  identity, passkey, recovery, pairing, admin, or direct-table capability. Profile-scoped functions
  derive identity from an active session ID plus keyed verifier and do not accept a caller-selected
  profile ID.
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
  accepted source/day state. No deployed HTTP Ingest API, deployment Ingest/Jobs credential/TLS
  integration, or scheduler exists. The local Ingest composition now has synthetic mock-pool,
  injection, loopback framing, and full disposable HTTP-to-PostgreSQL evidence; the local runner
  described below is the only Jobs application boundary.
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
  failure, Web-only authority, and Ingest/Jobs/Admin denial. The stable score response separately
  proves constant Community/self-reported metadata, the same ten-field allowlist, a top-32 ceiling,
  empty results, bounds, unique display positions, private-field rejection, and generated drift. The
  separate compatible race response repeats those constraints, accepts only an optional exact
  `CarRecipeV1`, and rejects proposal/private/arbitrary fields while proving the score component
  still rejects `carRecipe`. The third compatible status response adds required rounded freshness
  and optional preference-gated streak, rejects exact timestamp/daily/private fields, and proves
  both legacy components reject the new status fields. Server-only Web mappers additionally reject
  malformed or accessor-backed adapter output, unknown ten/eleven/thirteen-column rows, more than 32
  rows before row traversal, contract drift, inconsistent season metadata, non-contiguous display
  positions, duplicate handles, invalid SQL rank/order semantics, malformed nested recipes, and
  invalid status bounds. They return frozen canonical responses or throw one generic non-reflective
  message with a bounded cause code. A server-only `pg` adapter now adds namespaced Web-login
  settings, loopback-only development cleartext, certificate-verified production TLS, a
  four-connection pool, fixed connect/query/statement/lock/idle/lifetime ceilings, and three fixed
  parameterized top-32 queries with explicit date-to-text casts. It verifies the effective Web role,
  distinct non-privileged login with only Web membership, database capability, search path, and
  read-only state before every query; destroys a failed client; releases a healthy client before
  mapping; and returns only stable non-reflective error/signal codes. Config, pool, and store tests
  cover positive and negative boundaries without a live deployment credential. The local routes are
  wired to this adapter, but no cache, live login/certificate, audited correction flow, or scheduler
  exists.
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
  `read_profile_visibility`, and `read_source_inventory` calls. The source mapper accepts at most 95
  projection rows representing at most 32 opaque sources and 64 active devices, preserves a source
  with no active device, rounds activation to a UTC date, and renders only source ordinal/state plus
  device label/platform/version. Source IDs, internal key/profile IDs, public keys, and exact
  lifecycle times stay out of HTML; only the exact opaque device ID enters its hidden revoke form.
  Revision 0016 preserves both private inventory and immediate owned-device revoke while public
  visibility is hidden. Revision 0017 preserves immediate source pause and fresh-passkey
  reactivation under the same hidden profile state; revision 0018 does the same for terminal source
  unlink. Source actions expose only a 15-minute encrypted control token bound to the active
  session. Pause uses one same-origin form. Reactivation accepts only `paused`, binds a required-UV
  assertion to the session/source/RP/origin context, and reaches one atomic consume-and-reactivate
  statement; it cannot lift quarantine or change visibility. A distinct fresh context reaches one
  atomic consume-and-unlink statement for an active, paused, or quarantined source. Unlink revokes
  all active source devices and never publishes a hidden profile. One fixed materialized statement
  invokes `revoke_device`, returns only a boolean, and appends a bounded audit reference. The
  passkey mapper accepts 1-to-32 ordered closed rows, requires one current active authenticator,
  rounds creation to a UTC date, and keeps credential IDs, keys, sign counters, exact activity
  timestamps, and profile IDs out of HTML; only a revocable target's opaque passkey ID enters the
  authenticated control. A same-origin bounded form maps only `public`/`hidden` to the fixed
  `set_profile_visibility` capability. Hiding immediately removes the profile from public score
  reads without pausing source sync, publishing restores visibility, and repeated state is a no-op.
  Addition validates and seals the bounded NFC label before prompting, generates independent
  five-minute existing-key assertion and new-key registration challenges, and binds both to the
  session/profile/RP/origin context. Exact verification of both responses reaches one materialized
  consume-and-add statement; failed consume never invokes add, while insert/audit failure rolls back
  consume. The existing database lifetime cap closes concurrent additions. Revocation accepts one
  owned non-current active target, seals a five-minute session/target/RP/origin-bound continuation
  before the fixed challenge call, requires a fresh exact user-verified assertion, and uses one
  atomic consume-and-revoke query. Current, last, foreign, malformed, expired, and replayed attempts
  fail generically; activated devices remain separately revocable. Recovery-code rotation likewise
  requires the exact active session and a fresh required-UV assertion bound to its
  session/profile/RP/origin context. The server generates ten independent selector/secret codes and
  sequentially derives their Argon2id PHCs with deployment-selected bounded work factors and a
  distinct protected 32-byte pepper. One materialized statement consumes the challenge and replaces
  every old code and active recovery authority. Only a successful commit returns the plaintext batch
  in a no-store response; the client holds it only in component memory and shows it once. The
  tracked pepper, work-factor, and response-floor settings remain non-working placeholders. The
  separate `/recover` flow accepts one exact selector/secret plus a bounded replacement label,
  retrieves only the matching unused PHC, and performs one bounded Argon2id derivation for known,
  unknown, wrong, or malformed attempts under the recovery-only pepper. An admitted options request
  has a 512-byte body, four-call local no-queue admission, generic failure, and a configured minimum
  response floor. Success seals a purpose-separated five-minute authority continuation only after
  the database consumes and scrubs the code. The verify route accepts a bounded registration
  response, verifies exact WebAuthn RP/origin/challenge/context and required UV, then invokes one
  atomic replacement-passkey/session call. Revision 0020 returns only profile ID, handle, and locale
  after that commit so Web/Auth can seal the normal session; cookie-sealing failure revokes that new
  session. The code input is cleared after the options response and is never logged, cached, or
  persisted in the browser. Profile deletion accepts only the session's exact typed handle before
  the prompt, seals a five-minute continuation, and binds a fresh required-UV assertion to the exact
  session/profile/handle/RP/origin context. One materialized statement consumes that challenge and
  invokes the existing atomic hide/revoke/unlink/enqueue procedure with server-generated job/audit
  IDs and a fresh opaque 32-byte purge reference. Success clears all browser auth cookies; failure
  remains generic and retains them. The Web boundary itself runs no background work; revision 0024
  plus the separate local Jobs command now provide bounded primary purge. Scheduling, cache/backup
  purge, keyed tombstone policy, and restore replay remain unimplemented. Inventory dependency
  failure renders a generic unavailable state without removing logout. Every POST body is
  stream-bounded, compressed bodies and duplicate cookies fail closed, and admission is held from
  the first body read through dependency settlement; overload cancels the body without a queue.
  Cookies are HttpOnly/SameSite=Lax/secure-on-HTTPS with narrow paths, callback URLs are excluded
  from Next development request logs, and responses are generic, `no-store`, and `no-referrer`.
  EN/RU home-session navigation, join, passkey, returning-login, passkey-inventory, active-account,
  profile-visibility, source inventory/pause/reactivation/unlink, active-device revoke, passkey
  add/revoke, recovery-code rotation, recovery sign-in, deletion, and logout UI is present. Each
  route has four-call local admission. The CSP permits GitHub only as the exact OAuth `form-action`;
  no remote script/connect/asset/frame capability is added. The two exact-pinned SimpleWebAuthn
  packages are confined by effective lint policy to one server verifier and one browser component;
  licenses, full 23-record lock addition, production asset budget, and online advisory state were
  reviewed. Tests cover configuration, cookie purpose/tamper/ambiguity, invite grammar/minimization,
  state, PKCE, token minimization, fixed SQL and role probes, continuation-before-write ordering,
  replay and dependency failure shapes, profile-free/database-state-free login options, atomic login
  settlement, closed account inventory, exact-session idempotent visibility change,
  independent-challenge atomic add, session/target-bound revoke, current/foreign/replay denial,
  exact-handle/session-bound deletion, recovery generator/configuration, fresh-step-up atomic batch
  replacement and one-time client display, exact-code/dummy-work verification, restricted-authority
  replacement registration, generic/timing HTTP behavior, atomic consume/delete settlement, bounded
  empty-source/device mapping, hidden-profile inventory/pause/reactivation/unlink/revoke, encrypted
  session-bound source targeting, cross-session and replay denial, cross-origin/duplicate-form
  denial, origin/body/admission/logout policy, actual browser-adapter calls, local-session home
  navigation, EN/RU, and accessibility. A `localhost` Next dev-server smoke also proves the join
  page, exact no-scope GitHub redirect and callback-only cookie, state-bound cancellation,
  cross-origin rejection, missing-session denial, cookie-clearing logout, and callback-query
  suppression in development logs. Recovery component and axe cases use synthetic browser adapter
  responses only. The same local identity boundary now exposes `/connect` plus two exact same-origin
  JSON steps for pairing approval. A passkey-registered session submits one canonical code, revision
  0021 counts the admitted attempt on the session across application instances under
  deployment-private bounds, and the browser receives only bounded device metadata plus a full
  SHA-256 public-key fingerprint. The same session-derived bounded inventory supplies only active
  source ordinals, active device labels, and encrypted session-bound source controls, so the form
  can explicitly select a new or existing owned source while raw source IDs remain server-only.
  WebAuthn begins only after a second explicit approval action; its challenge binds the session,
  pairing, exact source choice and ID, RP, and origin, and one fixed statement rechecks and consumes
  it while approving atomically. The code is cleared from the form after lookup, the raw public key
  never reaches the client, and raw pairing/source IDs exist only inside encrypted source-control or
  HttpOnly approval continuations rather than client-readable plaintext or logs. This is
  HTTP/runtime evidence only, not visual browser, OAuth-provider, authenticator, or database E2E.
  There is no invite issuer UI, anonymous pairing-start or recovery edge attempt policy,
  expired-state cleanup scheduling or notification, live OAuth/authenticator/database integration,
  monitoring, or deployment evidence.
- A private current-week account score slice now reuses the exact possessed session and one combined
  Web/Auth pool checkout for visibility plus revision 0019's derived-score read. The server-only
  mapper accepts one empty sentinel or exactly seven consecutive 0–1000 daily scores with coherent
  weekly/season metadata, rejects raw or inconsistent fields, and renders no score while hidden.
  EN/RU component tests cover score, hidden, and unavailable states. There is no client fetch,
  browser storage, working database credential, or live-user evidence.
- A second server-only Web pairing adapter reuses the same environment-owned narrow Web/Auth login
  through a separate four-connection read-write pool. The start application accepts only a closed
  canonical public-key/label/version/OS/architecture request, generates fresh pairing and
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
  returns only its frozen success shape or generic failure plus a request ID. Pairing coverage
  includes material/code bounds, HMAC vectors/rotation and key separation, hostile
  configuration/input/result shapes, fixed start/lookup/activation queries, driver confinement, role
  drift, strict proof selection, IDs, admission/timing, generic failure, clearing, release, and
  close. The same Web workspace now adds exact start/poll body/header routes, one aggregate service,
  domain-separated anonymous client digests, mandatory deployment-private global/bucket/window
  limits, and retry-safe activation result reads that require a fresh valid possession proof before
  returning the existing binding. Revision 0022 retains only 130 fixed aggregate counter rows and
  never the client ID or digest. These local boundaries still do not prove a live login/TLS
  connection, edge capacity, cleanup schedule, monitoring, or deployment.
- A Rust connector binary exposes a bounded `connect` command that accepts only a canonical HTTPS
  origin or explicit loopback HTTP development origin and a bounded label. It disables proxies and
  redirects, uses platform TLS verification, bounds request/response/time, generates an Ed25519 key
  and 16-byte anonymous client ID through the OS CSPRNG, and stores one fixed versioned
  prepared/pending/active record only in the native credential store. It persists before displaying
  authority, resumes pending polling, signs the exact ADR 0026 message, clears pending material
  after activation/expiry, and never prints key, token, challenge, source, or device IDs. The
  separate local-only `forget-local` command deletes the exact origin/label native entry without
  loading or decoding it, treats an absent entry as the same success, and states that server revoke
  remains separate. Rust tests cover command/origin/record/response, start-to-active behavior,
  delete-only invocation, identifier-free output, missing/extra/duplicate arguments, and native
  result mapping under format/check/Clippy. Tests use an injected store and do not touch a real OS
  credential entry. The separate candidate sync path is documented above; there is no cross-platform
  runtime result, real HTTP/Web/database pairing result, key rotation, server-revoke composition,
  package, signed release, or support claim.
- A private TypeScript Jobs workspace now accepts exactly either a fixed 1000-row
  authentication/CarRecipe-proposal/ingest/pairing cleanup command, a separate fixed 10-profile
  primary purge, or one canonical Monday refresh/finalization command. It revalidates closed plain
  job data, reads only redacted `VIBERACING_JOBS_DATABASE_*` configuration, permits cleartext only
  for explicit development/test loopback, and otherwise requires certificate-verifying TLS with a
  DNS hostname. Its pool maximum is one; client connect/statement/query deadlines are 2/31/32
  seconds, outside the database functions' 30-second deadline. Every checkout probes the exact
  `viberacing_jobs` effective role, a distinct non-privileged login with only that membership,
  CONNECT without CREATE/TEMPORARY, and `pg_catalog,pg_temp` search path. It then selects one of
  seven fixed prepared function calls, requires one exact allowlisted result row, holds the client
  through settlement, destroys it after failure, and closes the pool on every acquired CLI path.
  Success and failure output are stable sentences without command/date/count/config/SQL/exception
  reflection. One hundred forty-four focused tests cover config, TLS, pool/signal behavior, hostile
  command/object/array/result inputs, exact SQL parameters, role mismatch, settlement/release/close,
  CLI output, and failure translation at 100% statement/branch/function/line coverage. A lint-policy
  regression also prevents every production module except the fixed pool adapter from importing
  `pg`. A TypeScript production build passes. No live Jobs login, Node-to-PostgreSQL integration,
  scheduler, monitoring backend, automatic retry policy, capacity result, correction,
  cache/backup/tombstone purge, restore replay, or deployment is claimed.
- Twenty-nine deterministic cross-connection races hold a relevant invite, challenge, session,
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
  transaction/key pair once, and preserve live pending state. Authentication cleanup has a separate
  two-worker serialization race plus a cross-capability race proving cleanup waits on the same
  profile-first order as recovery start, removes only the old expired authority/code, and preserves
  the new live authority. Primary deletion has a two-worker race plus a cross-capability race
  proving purge locks its fixed five maintenance mutexes in stable order before cascading a profile
  and before authentication cleanup can proceed. A separate CarRecipe-proposal cleanup race proves
  two bounded workers serialize, delete each expired proposal once, and preserve live proposal and
  active-recipe state. A scoring race proves two Jobs refreshes serialize on a private mutex and
  converge on one semantic open-season state. A finalization versus late Ingest race proves the
  shared `season → profile → source → device` lock order is deadlock-free, the final projection is
  terminal, and the late payload remains quarantined. No losing enrollment or rotation artifact
  survives, and no protective race leaves browser, recovery, or pending device authority attached to
  a deleted profile, revoked credential, old code, or protected source. The recovery races also
  prove terminal timestamps are captured after lock acquisition, and missing expected challenge,
  credential, authority, session, code, or pairing rows fail closed rather than passing through SQL
  `NULL` semantics.
- A strict Next.js 16 and React 19 web workspace with a synthetic EN/RU race, accessible
  leaderboard, demo profile, three repository-owned CSS/canvas themes, reduced-motion controls, and
  a deterministic 16-by-8 pixel-car renderer.
- A client payload that contains bounded daily scores and public presentation fields, never raw
  token buckets, account identifiers, source identifiers, URLs, email addresses, or local paths.
- A closed-enum CarRecipe boundary with fixed sprites and palettes; arbitrary HTML, CSS, SVG, URLs,
  colors, text, and uploads are not accepted.
- A local account CarRecipe flow. Three exact same-origin form routes share four-call no-queue
  admission; the server revalidates `CarRecipeV1`, hashes and clears session proof material, creates
  proposal identity/expiry, and exposes only a purpose-separated encrypted control bound to that
  session. The raw proposal/profile IDs never enter HTML. Active and pending recipes are rendered as
  semantic code-native pixels in all three themes with deterministic snapshots. The schema runtime
  stays server-side. The separate public race response exposes only the current approved exact
  recipe of an active profile; proposal state stays private. A separate exact-body signed device
  route can create or replace only the pending recipe and cannot inspect or decide it. The local
  Agent Skill can reduce style intent to that fixed command but gains no read, decision, or
  activation authority. No live database credential, edge policy, monitoring, capacity result,
  released connector, or deployment is claimed.
- Per-response nonce CSP, browser-isolation and capability headers, no remote image patterns,
  globally disabled Next.js image optimization, production HSTS, disabled framework branding, and an
  explicit Turbopack repository root that prevents parent-workspace inference.
- Device-local persistence limited to locale, theme, and motion preferences. The synthetic preview
  has no accounts, analytics, trackers, remote fonts, or runtime secrets. Its only environment
  setting is a strictly parsed, server-only public origin for absolute social metadata; hosted
  deployment without a real HTTPS DNS value remains forbidden. The separate enrollment slice stores
  account state only in encrypted HttpOnly cookies and reads its exact server-only configuration
  lazily; the default preview still needs none of it.
- Six hundred eighty-three unit, component, interaction, security-header, localization, scoring,
  HTTP-route/admission, database-adapter configuration/pool/store, and accessibility tests. The
  coverage gate currently reports 86.83% statements, 85.17% branches, 95.31% functions, and 86.95%
  lines over product components and libraries; framework entrypoints are verified by the production
  build instead of artificial unit coverage.
- A root verification pipeline that now includes contract generation/drift; contract, Ingest, and
  Jobs lint, strict type checking, coverage, and production compilation; plus web lint, strict type
  checking, coverage, and a production Next.js build on every deterministic CI run.
- A manifest-driven production artifact gate with nine black-box cases and enforced limits for
  initial raw/gzip bytes, application/CSS gzip bytes, asset count, source maps, fonts, path safety,
  and standalone output. The current initial route is 184,559 gzip bytes across eight assets;
  application JavaScript remains within its separate 10,000-byte budget at 8,880 gzip bytes and CSS
  remains within 5,000 bytes at 4,245 gzip bytes.
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
reached `healthy`, validated and applied revisions 0001 through 0029 from the checksum manifest,
passed 27-table state/ownership/RLS assertions, twenty-nine observed lock-wait races, twelve
relation-denial checks, forty cross-capability denials, and the identity, passkey, recovery,
pairing, source/device lifecycle, Community ingest, origin replay, ingest-retention,
pairing-retention, authentication-retention, primary-profile deletion, CarRecipe proposal/approval
and retention, scoring, finalization, and public score/race/status scenarios, then removed its
portless container, network, and ephemeral storage.

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

Invite issuance UI, trusted anonymous login/pairing/recovery edge limits, recovery notification,
trusted Ingest edge routing/external TLS and direct-origin denial, live secret-manager/edge key
injection, the Ingest deployment PostgreSQL credential/TLS connection, distributed rate/backpressure
controls and load evidence, scheduled execution/monitoring of authentication-, CarRecipe-proposal-,
ingest-, and pairing-retention cleanup and primary deletion, cleanup for remaining expiring state,
the Jobs scheduler/live login and application-to-PostgreSQL integration, audited corrections,
deployed public-score delivery, cache/backup/tombstone purge and restore replay, connector automatic
discovery and macOS/Linux executable admission, clean-machine live Codex/privacy evidence, supported
operational account/usage integration, deployed signed-upload egress, credential rotation and
automated server-revoke composition, packaging, release signing, deployment, and public beta
operations remain proposed. The local Ingest key reader, kernel, adapter, application composer,
Fastify server, and separate host now prove bounded protected configuration, raw-envelope/JSON/HTTP
framing, origin-proof, contract, strict Ed25519 device, least-privileged pool, fixed-query,
orchestration, no-queue/deadline policy, exact listener modes, bounded startup/shutdown,
result/problem serialization, and one full synthetic loopback persistence path, but not those
deployed edge, secret, TLS, capacity, or operational boundaries. Bounded database score and
compatible active-recipe race projections, versioned response-only schemas, fail-closed server
mappers, bounded PostgreSQL adapters, and local HTTP routes now exist, including URL/media parsing,
admission/deadline policy, store translation, and final serialization. A third compatible local
status projection/contract/route now supplies complete-UTC-day freshness and preference-gated streak
without changing either older response. Cache/invalidation, deployed device-proposal ingress,
authenticated profile detail, client-rate and production-capacity controls, query-plan evidence,
monitoring backend, deployment login, certificate, edge policy, and live adapter integration do not.
The visible web scoring and ranking experience now consumes a validated current-week status response
from the local route when its separately provisioned database login works, but local defaults and
every unavailable/error path remain clearly synthetic. No working database/OAuth login, deployed
data, cache, or end-to-end real-user ranking evidence exists.

## Evidence commands

Run from the repository root:

```text
pnpm run verify
pnpm run check:agent-skills
pnpm run test:agent-skills-check
pnpm run check:contracts
pnpm run check:database
pnpm run test:database:integration
pnpm run test:ingest:coverage
pnpm run build:ingest
pnpm run test:ingest:postgres-integration
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
