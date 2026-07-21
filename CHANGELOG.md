# Changelog

All notable project changes will be documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and released versions will follow Semantic
Versioning where its guarantees are applicable.

## [Unreleased]

### Added

- A checked staging migration and forward-recovery runbook for the existing default-off one-shot
  controller. Eighteen ordered controls bind private owner assignment, backup/restore and
  service-compatibility prerequisites, exact enablement, one argument-free apply, ledger/role/TLS/
  resource verification, containment, forward-only repair, and protected incident handoff. Seven
  documented commands are drift-checked against the root and migration package manifests plus the
  exact runtime enablement and generic success result; thirteen unsafe or drifted variants fail
  closed. This is a public operator prerequisite, not protected staging credentials, a successful
  rollout/rollback, monitoring, stale-backup deletion replay, production approval, or deployment
  evidence.
- An opt-in synthetic Web HTTP-to-PostgreSQL integration. It builds the contract runtime and Web
  standalone output, explicitly bundles the reviewed `pg` driver instead of leaving Next's default
  external package link, generates one ephemeral self-signed DNS certificate, applies every reviewed
  migration to one TLS-enabled disposable PostgreSQL container, and starts two sequential emitted
  Next production processes on loopback. All three public score/race/status GETs return the exact
  generic 503 through a deliberately widened Web login without changing any private table, then
  return their exact contract-validated active-only pages through a narrow `viberacing_web` login
  while `pg_stat_ssl` proves TLS 1.2 or 1.3 and the full private-state fingerprint remains
  unchanged. A controlled owner-held database lock then proves the four-request application
  admission boundary: four observed score queries remain in flight, a fifth request returns the
  closed generic 503 without adding a fifth public-score query, and the first four return their
  exact 200 contracts after rollback. The disposable database also preloads `auto_explain` and a
  superuser enables parameter-payload-free nested plan capture only for the narrow synthetic login.
  Six exact adapter/projection oracles require bounded rows and plan shape, the reviewed score/race/
  status indexes, no mutation/locking node, no sequential scan over bounded-index relations, and no
  dirty/written or temporary blocks. A deterministic parser suite rejects missing, malformed,
  leaking, mutating, unindexed, or over-budget variants without Docker. Server, blocker, and plan
  output is bounded, checked for private fixture/credential/path reflection, discarded, and every
  ephemeral key, process, container, network, and storage resource is removed. Secretless CI
  requires the command, but no deployment certificate/login, external TLS/edge route, cache, edge
  policy, representative plan/load/capacity, monitoring, real-user data, hosted pass, or deployment
  is claimed.
- A Jobs-only bounded historical Community season finalization capability. Revision 0040 takes the
  existing scoring mutex, derives only the oldest grace-eligible open or retained-data-backed
  season, and invokes the existing finalization function for at most one season without accepting or
  returning a date. The existing source-date index and one new partial open-season index support
  oldest-first discovery; no queue, run ledger, retry counter, retained field, or public capability
  is added. The one-shot runner exposes one fixed no-argument command, and the default-off scheduler
  places it first in the hourly catalog. Disposable PostgreSQL evidence covers empty, no-data open,
  data-backed missing, current-week, denial, missing-lock, exact-state, and two-worker serialization
  behavior, but not representative backlog size, capacity, production credentials/TLS, monitoring,
  real-user recovery, deployed cadence, or deployment.
- A separate default-off local Jobs scheduler around the existing eighteen-command runner. It
  accepts no arguments or schedule configuration, derives the current and latest grace-eligible
  Community Mondays in UTC plus at most one oldest known data-backed historical season per hour,
  invokes a fixed five-minute/hour/day catalog sequentially through one runner, prevents overlapping
  cycles and same-slot retries, retains slots only in memory, and bounds SIGINT/SIGTERM shutdown to
  the current Jobs call. Ninety-four adversarial tests reach 100% statement/branch/function/line
  coverage, including the provenance-before-session retention order, and a built-entrypoint gate
  rejects disabled or argument-bearing startup without output. A second opt-in integration composes
  the production scheduler core under a fixed injected UTC clock/timer with the real Jobs runner and
  disposable PostgreSQL, proving the exact ordered catalog, full-state widened-login denial, and
  exact narrow-login effects. A third opt-in integration starts the built scheduler entry point from
  a link-free read-only production graph under pinned Linux Node with the real clock. The harness
  temporarily denies only the Jobs role's backlog function, then proves one generic cycle signal, no
  backlog mutation, and later terminal-job settlement before a code-0 `SIGTERM` exit. It restores
  and rechecks the exact grant, rearms the terminal marker, holds the scoring mutex, and starts the
  same runtime again. It observes the first finalization lock-wait, delivers `SIGKILL`, requires
  exit 137 and session release, and proves the backlog plus terminal marker remain unchanged. After
  the holder is released, a restart finalizes the backlog before a silent code-0 signal exit. The
  harness then rearms the marker and installs a disposable `AFTER INSERT` barrier for a second
  backlog. The same runtime reaches that barrier only after its first daily projection insert; a
  second `SIGKILL` must release the session and roll back the season plus all projection rows while
  retaining the source/day input and marker. The trigger/function is removed and its absence
  verified before a clean-schema restart finalizes that backlog exactly once. One more rearm/restart
  proves a silent repeated cycle, with no scheduler sessions left after any of the six starts,
  runtime immutability, and exact stored state. A separate timer integration advances the fixed
  clock by one hour, invokes the production interval handler twice during the active real-runner
  cycle, proves the exact recurring catalog plus overlap and same-slot suppression, and verifies the
  rearmed terminal reset. A separate process-lifecycle integration injects its first signal during
  the penultimate database job, proves active-call settlement, no later scheduler job, exact
  graceful cleanup, and exit code 0, then invokes the omitted reset separately for the shared state
  oracle. Another integration starts the unchanged emitted process, assembles a link-free
  production-only runtime from the installed graph, mounts it read-only under a pinned Linux Node
  image, waits for startup completion, holds the scoring mutex, and observes the native minute timer
  reach the production refresh in a later real five-minute slot. It delivers an OS `SIGTERM`,
  releases the mutex, and proves the active refresh commits with a newer timestamp before silent
  code-0 exit, session release, and runtime-fingerprint revalidation. A seventh integration uses the
  same bounded runtime shape, blocks the emitted first finalization call, delivers an OS `SIGTERM`,
  and proves that call settles without starting refresh or any later job. The process exits silently
  with code 0, releases its database session, and leaves the runtime fingerprint unchanged before
  the omitted seventeen one-shot commands complete the shared exact-state oracle. The three emitted
  gates provide local synthetic failure/crash/retry, restart, one controlled uncommitted post-insert
  PostgreSQL transaction rollback, recurring-refresh, and active-finalization OS-signal evidence,
  including one native host-timer callback. Recovery from committed/external effects or every Jobs
  capability, automatic privilege repair, deployed signal route, controller/orchestrator grace
  policy, managed restart, deployed replica/durable cadence, production credential/TLS, monitoring,
  capacity, or real-user retention is claimed.
- A deterministic pre-restore migration-overlap drill in the isolated PostgreSQL integration. It
  holds revision 0039's own advisory lock, observes two tagged processes running the exact reviewed
  migration in the holder's blocker chain, and then requires one successful application plus one
  expected duplicate-object `42P07` rollback. One exact migration-ledger row and the canonical table
  must remain before restore and capability checks continue. This proves local transaction and
  advisory-lock serialization, not a successful concurrent deployment controller, staging migration
  orchestration or rollback, production credentials, or deployment.
- A separate default-off one-shot migration runner core. It verifies only the canonical repository
  manifest/file inventory and original SHA-256 digests, probes a distinct login with only owner-role
  set authority, and uses one fixed session lock to reread the ledger and apply only an exact
  missing suffix. Argument, alternate-enable, path/SQL injection, widened-login/result-shape,
  ledger-drift, cleanup-failure, and reflective-output paths fail closed in 97 injected tests plus a
  built entrypoint check. A separate opt-in synthetic gate now uses verified TLS to run a widened
  emitted process and two narrow emitted processes against one disposable PostgreSQL database. It
  denies the widened login before schema creation, observes both narrow controllers behind one
  external advisory-lock holder, requires both to converge successfully after release, and verifies
  the exact 40-row ledger, 28 forced-RLS tables, identity invariants, and resource cleanup. No
  production TLS/login, deployed replica, staging migration/rollback, monitoring, deployment, or
  recovery result is claimed.
- A deterministic current-snapshot restore drill in the isolated PostgreSQL integration. It keeps
  two bounded custom archives only inside the disposable `tmpfs` container, replaces only that run's
  database twice, and requires the source plus both restored canonical data dumps to retain their
  exact SHA-256 digest and byte length. The two restored schema generations must also be
  byte-stable, all 28 private tables must retain forced RLS, and selected Web/Jobs/Admin grants and
  denials must survive each restore before all 45 lock-wait races, the early-completion overlap, and
  the full runtime deny matrix execute on the twice-restored state. Dump content is never emitted;
  bounded buffers are hashed and overwritten, and container removal deletes both archives. This is
  not stale-backup deletion replay, external backup/encryption, cluster-role recovery, production
  login/TLS, representative scale, or RPO/RTO evidence.
- Public-safe repository baseline, implementation plan, security invariants, and contribution
  guidance.
- Pinned Node, pnpm, Rust, PostgreSQL, dependency, formatting, documentation, and CI foundations.
- Governance, conduct, DCO, support, roadmap, release, trademark, and third-party notice policies.
- Structured issue and pull-request templates with public-data safeguards.
- Community-health and publication-readiness policy checks with regression coverage.
- Repository-scoped threat model, structured abuse cases, privacy data map, system/data-flow views,
  fail-closed compatibility policy and matrix, and sixty-three accepted ADRs.
- Architecture-contract checks for policy sections, privacy classes, abuse-case completeness, ADR
  lifecycle/index integrity, empty Codex support state, and Mermaid fence structure.
- Candidate Codex evidence checks for canonical manifests/fixtures, exact digests and methods, safe
  paths, complete hostile-case inventory, and strict candidate/support-matrix separation.
- Complete reachable-history and printable binary-metadata leak scans with shallow-clone rejection,
  non-placeholder public Git identity validation, and one exact author-matching DCO sign-off per
  commit.
- Offline spelling, reviewed external-link policy, and deterministic dependency/license inventory
  covering the exact npm lock graph, pinned Actions, and local PostgreSQL image.
- Synthetic EN/RU Next.js race, leaderboard, demo profile, three code-native themes, reduced-motion
  controls, and deterministic pixel-car renderer.
- A public EN/RU score simulator that validates one canonical hypothetical daily token total and one
  to seven active days, delegates to the production daily/weekly formula, and retains input only in
  component memory. It has no form action/name, request, logging, persistence, account/race prefill,
  or standing mutation; unit/component tests cover boundaries, localization, privacy, and
  rest/steady/mixed/capped synthetic distributions.
- A canonical `CarRecipeV1` schema with seven closed project-owned enum axes and a bounded seed;
  generated validation; deterministic part/trail snapshots; code-native three-theme account
  previews; forced-RLS active/proposal tables; exact-session Web-only propose/read/approve/reject
  functions; opaque session-bound decisions; same-origin account forms; and a separate Jobs-only,
  maximum-1000, oldest-first expired-proposal cleanup under a private mutex. A separate compatible
  public race response projects only the current approved recipe of an active profile; proposal
  state stays private. A separate exact-body signed Web route, active-device PostgreSQL capability,
  shared Rust/Web signature vector, and fixed native-store `propose-car` command now create or
  replace only the pending recipe and cannot approve/reject/activate it. An observed PostgreSQL race
  proves source pause serializes ahead of a queued proposal without retaining its proposal or nonce.
  A self-contained local Agent Skill now reduces styling intent to only those exact fields, requires
  explicit shell-safe origin/label values, invokes that command once, and never receives read or
  decision authority. Its production-derived checker plus twelve black-box mutations reject
  schema/CLI drift, command widening, contradictory invocation input, unsafe shell input, retries,
  stale output, and metadata drift. This local slice still has no cleanup schedule, live credential,
  released connector, edge control, or deployment.
- A second self-contained local Agent Skill now selects only checked-in read-only repository
  verification from the real Git scope, preserves focused/root/staged/history evidence boundaries,
  and has no edit, staging, commit, installation, network, live-service, publication, push, or
  deployment authority. The shared canonical-source checker and 25 total black-box mutations reject
  command, scope, runtime, metadata, authority, public-output, and evidence-claim drift.
- Strict frontend lint/type/build gates plus unit, interaction, accessibility, CSP/header, scoring,
  localization, and data-boundary tests with enforced coverage thresholds.
- Integrity-bound cross-platform npm license metadata and an expiring reviewed override for the
  unused Next.js image-optimization graph.
- Manifest-driven production asset budgets with path, source-map, font, standalone-output, and
  black-box regression checks.
- An isolated no-dependency CDP capture plus 18 stored page-only Phase 1 viewport baselines covering
  three breakpoints, both locales, and all three themes with motion disabled. The capture rejects
  non-loopback resources and reviewed header/hero overflow; it exposed and blocked a clipped compact
  join link until responsive navigation wrapping was fixed. A separate no-write local re-render mode
  requires the manifest's exact browser product/platform and zero changed decoded pixel channels.
  Fifteen CLI guardrail cases, ten request-policy assertions, four exact-environment assertions, six
  pixel-result assertions, and a shared offline gate with eleven checker mutations enforce the
  closed origin/browser intent, exact inventory, dimensions, byte limits, SHA-256 manifest, and
  public PNG policy. The same no-write mode now proves the exact 16-target keyboard order,
  skip-target focus transfer, Space activation and restoration of the pause control, named
  accessibility-tree landmarks/controls/simulator textbox/table/canvas, and a forced-colors pass
  with visible focus, reviewed borders, no outer overflow, and a semantic canvas alternative. It now
  also collects three cold-browser-cache LCP/CLS/trusted-pointer-interaction samples in both
  animation-on and reduced-motion states. The latest recorded local maxima are respectively
  `168.0 ms / 0.000 / 16.0 ms` and `116.0 ms / 0.000 / 40.0 ms`, bounded by local regression
  ceilings rather than published as SLOs. Five keyboard-policy, six accessibility-tree-policy, five
  forced-colors-policy, and fourteen web-vitals-policy assertions reject drift. The reported
  product/platform is pinned, but executable artifact provenance, native screen-reader, CI
  provisioning, cross-browser evidence, field Core Web Vitals, and staging SLOs remain open.
- A documented AI-generated social preview, accessible alternative text, reproducible metadata
  sanitation, and a fail-closed PNG structure/chunk policy with regression coverage.
- Strict server-only public-origin validation for absolute social metadata, with HTTPS-only hosted
  origins, loopback-only development HTTP, safe reserved defaults, and negative tests.
- Canonical closed JSON Schema contracts for connector sync, bounded acknowledgement, public problem
  details, one public Community season query, and a response-only top-32 score page with constant
  self-reported trust metadata. Generated readonly TypeScript validators enforce calendar range and
  ISO weekday, while a manifest-generated OpenAPI GET records local implementation without claiming
  deployment.
- A server-only public-score mapper that accepts unknown adapter output, enforces the exact SQL
  column allowlist plus season/order/rank invariants, validates the canonical response, and emits no
  reflected projection values on failure.
- A bounded server-only PostgreSQL public-score adapter with a dedicated Web-login config namespace,
  production certificate verification, a four-connection pool, fixed timeouts/lifetime, an exact
  per-checkout role/login-membership/capability/search-path/read-only probe, canonical Monday input,
  and one parameterized top-32 projection call with date-to-text preservation. It is constructed
  lazily only by the local score route and is not connected to the synthetic page.
- A server-only public HTTP problem factory that generates an opaque 128-bit request token, fixes
  every status/title/retry mapping, validates `ProblemDetailsV1`, and emits matching `x-request-id`,
  `application/problem+json`, and `no-store` headers without CORS, cookies, reflected causes, or an
  operational log sink.
- A closed locally implemented `GET /v1/community/scores` operation with one required Monday
  `seasonStart`, exact 200/400/406/429/500/503 schemas, no-store/`Vary: Accept` headers, and
  same-origin CORS posture. Its Node route rejects bodies and ambiguous URL/media input, dispatches
  non-GET methods through an exact 405, admits four active reads without a queue, holds admission
  through adapter deadlines and settlement, revalidates success output, and translates only generic
  failures. It claims no client-rate policy, working database credential, or deployment.
- A separate closed `CommunityRacePageV1` and local `GET /v1/community/race` operation that preserve
  the stable score component and add only one optional exact `CarRecipeV1`. Revision 0027 joins only
  the current approved recipe after active-profile score filtering; Web-only execution, an exact
  eleven-column mapper/store, shared no-queue route policy, independent browser validation, lazy
  client loading, and repository-owned absence fallback are tested without exposing proposal state
  or claiming a live credential, cache, edge policy, capacity result, monitoring, or deployment.
- A shared exact default-off module-load gate for `GET /v1/community/scores`,
  `GET /v1/community/race`, and `GET /v1/community/race/status`. Only
  `VIBERACING_PUBLIC_RANKING_ENABLED=true` permits query/header parsing, admission acquisition, or
  storage work; disabled GET returns the existing generic no-store 503 and the tracked example
  remains false. This is local fail-closed evidence, not deployed route/cache denial, old-instance
  drain, or a dynamic switch.
- Dependency-free, traversal-budgeted runtime contract validation plus manifest/schema/generated
  drift gates and black-box regression coverage.
- A private pure Ingest workspace plus canonical language-neutral authentication policy for one
  exact `POST /v1/community/sync` raw envelope. It bounds copied body/header/JSON work, rejects
  duplicate security headers and decoded object keys, verifies a replay-consumed exact-body origin
  HMAC before parsing or device lookup, validates `ConnectorSyncV1`, strictly verifies the
  source-bound exact-body Ed25519 request, and returns only a frozen database-ready allowlist. Its
  117 adversarial tests reach 100% statement/branch/function/line coverage; no HTTP listener, public
  response, connector, rate/deadline/backpressure control, or deployment is implied.
- A bounded Ingest PostgreSQL adapter that revalidates the verifier allowlist, copies mutable
  values, creates a server snapshot UUID, probes the exact Ingest login/role/search-path boundary on
  every checkout, and exposes only fixed parameterized origin replay, device lookup, and submission
  calls. Its redacted namespaced config requires loopback development/test or certificate-verified
  TLS, its four-client pool has fixed deadlines/recycling, and malformed rows or failures destroy
  the client. One hundred eighteen adapter/configuration/boundary cases remain in the current Ingest
  suite at 100% statement/branch/function/line coverage; no live login, HTTP/replay integration, or
  deployment is implied.
- A protected Ingest origin-proof configuration reader and config-backed verifier factory. Four
  exact namespaced values encode one mandatory primary and one optional complete secondary rotation
  pair; canonical 32-byte keys and IDs must be distinct, no fallback or key container is exposed,
  and temporary decoded buffers are overwritten after verifier construction. Twenty-eight new
  adversarial cases remain in the 317-test Ingest suite at 100% statement/branch/function/line
  coverage; no real key, secret-manager binding, edge signer, HTTP route, or deployment is implied.
- A forced-RLS origin replay table and Ingest-only atomic consume function storing only the closed
  key ID, domain-separated 32-byte digest, and millisecond expiry. Exact replay returns `false`, an
  expired tuple may be reused, expiry is rechecked after contention, and an ordered observed race
  proves exactly one fresh consume. The bounded Jobs cleanup now independently deletes origin
  nonces, device nonces, and snapshots; the local Ingest adapter maps only one fixed boolean call.
- A transport-free Community sync application boundary that generates one server-owned 128-bit
  request ID, composes the protected-key verifier with the same bounded replay/device/submission
  database adapter, waits for settlement, and returns only a contract-validated acknowledgement or
  generic problem decision. Fifty-four new adversarial and production-path composition cases bring
  the Ingest suite to 317 tests at 100% statement/branch/function/line coverage; this layer itself
  creates no HTTP object or socket, and no working database login, edge deployment, log sink, rate
  control, or real-user sync is implied.
- A bounded local Fastify 5.10.0 Community sync server factory confined to one Ingest module. It
  preserves copied raw body/header evidence, disables proxy and inbound request-ID trust plus
  framework logging, exposes only exact `POST /v1/community/sync` with closed 404/405/406 handling,
  sheds load after four unsettled application calls without a queue, applies explicit body/header/
  connection/socket-reuse and 5/33/34-second request/handler/connection limits, and emits only
  revalidated `no-store`, no-CORS acknowledgement/problem contracts. Real loopback framing plus
  adversarial injection cases bring the Ingest suite to 427 tests at 100% coverage. The server keeps
  Fastify's force-close behavior disabled so an active socket cannot be reclassified as idle after
  its request body is read; a real-listener regression requires the accepted response to settle
  before application shutdown completes. The manifest now generates both public GET and POST OpenAPI
  operations and binds the sync authentication policy into its digest. This does not add a
  host/port/TLS entry point, edge signer, direct-origin denial, live database credential,
  monitoring, load evidence, connector, or deployment.
- A separate bounded Ingest host workspace that admits only exact loopback cleartext in local/test
  mode or `0.0.0.0:$PORT` behind an explicit Railway-edge TLS contract in production. It composes
  only after exact `VIBERACING_INGEST_ENABLED=true`; every other value fails before inspecting
  listener or protected application configuration, and the tracked example remains false. It then
  uses only the reviewed Ingest application/server factories, cleans every partial startup, closes
  once under a 36-second SIGINT/SIGTERM deadline, and forces failure on a second signal, deadline,
  or teardown error. Its 130 tests reach 100% coverage; a built-ESM gate proves disabled startup
  exits silently without a module-resolution stack. No deployed restart, route denial, TLS route,
  secret, live login, edge policy, monitoring, capacity, or deployment is claimed.
- An opt-in synthetic Ingest HTTP-to-PostgreSQL integration gate. It builds the emitted contracts,
  Ingest, and host workspaces; applies every reviewed migration to one disposable PostgreSQL
  container; creates a dedicated least-privileged login and two synthetic devices; sends
  independently signed loopback requests; and proves accepted, duplicate, persistent replay denial,
  revoked-device denial, closed response headers, unique server request IDs, and exact stored state.
  A controlled owner lock then holds four valid requests at the first replay-store call, observes
  exactly four lock-waiting Ingest queries, rejects a fifth with generic 503 without a fifth query,
  and proves the four exact accepted responses after release. After the imported host closes, the
  same gate starts the built entry point as a separate silent process, observes its loopback
  listener without application work, proves another exact accepted write, and forcibly ends only
  that test child before cleanup. CI requires the gate, but it supplies no OS-signal delivery,
  graceful emitted-child settlement, external TLS, protected secret, edge route, distributed
  control, production credential, representative load, real-user input, or capacity evidence.
- A separate opt-in emitted Ingest OS-signal integration. It assembles a link-free runtime from the
  emitted host, Ingest, contracts, and exact installed production graph, fingerprints it, and mounts
  it read-only under the pinned Linux Node image in only the disposable PostgreSQL network
  namespace. A separate capability-free client receives one independently signed synthetic request
  over stdin; the harness holds that request at the first origin-replay database call, delivers a
  real `SIGTERM`, releases the lock before the database deadline, and requires the exact accepted
  response and stored state. It also proves silent code-0 host exit, complete database-session
  release, unchanged runtime contents, and bounded cleanup. CI requires the gate. This is one local
  Linux active-request signal path, not Railway/orchestrator drain, external TLS/edge routing,
  protected secret or production-login delivery, representative load/capacity, real-user input, or
  deployment evidence.
- A library-only Rust connector protocol foundation with one fixed stable App Server initialization
  exchange, 16 KiB LF-only framing, manual duplicate/unknown-field rejection, bounded discarded
  response values, terminal hostile-input state, and non-reflective errors. Seven public-API tests
  prove exact bytes, state order, framing, shape, bounds, duplicate/unknown rejection, and privacy;
  no Codex process, supported version, account/usage method, key store, upload, CLI, or release is
  implied. The root Rust gate now runs tests, and the exact Serde/serde_json lock graph, build
  scripts, licenses, features, and point-in-time advisories are reviewed and inventoried. Clean CI
  fetches the exact Cargo lock graph without building it before the offline Node license gate.
- Candidate-only Codex `0.144.5` account/usage evidence and parser. The manifest records the
  official release tag/commit/artifact metadata, full stable-schema digests, three minimal extracts,
  and nine synthetic fixtures; a new checker plus fourteen black-box cases enforce canonical files,
  digests, exact methods, safe paths, coverage inventory, and candidate/matrix separation. After a
  completed handshake the Rust adapter emits only fixed IDs `1` and `2`, accepts ChatGPT mode,
  discards email/plan/summary, and returns at most 31 sorted unique strict date/token entries. Ten
  adapter tests cover fixture and generated hostile cases. This does not verify or launch the
  official artifact, clean a child process, support a Codex version, store a key, upload, package,
  or release a connector; the matrix remains empty.
- A bounded one-shot candidate App Server supervisor. It accepts only `ReviewedCodexLaunch`, which
  has no public constructor, and starts one fixed `app-server` argument in a capability-owned
  working directory, clears ambient environment and re-allows only reviewed keys, uses local pipes,
  admits three 16 KiB stdout frames, permits 8 KiB discard-only stderr and fails on the next byte,
  applies 10-second response and 45-second lifetime bounds, checks late output, and returns
  minimized usage only after child reap. Nine unit cases execute only a target-built Rust fixture
  and cover exact protocol composition, environment filtering, timeout, early exit,
  pre/post-response output overload, stable diagnostics, missing executable, nonzero terminal
  status, and forced cleanup. That supervisor boundary alone implies no binary discovery/path
  ownership, official-artifact execution, platform matrix, live Codex path, key, upload, CLI,
  package, or support row.
- A bounded unsigned candidate Community sync composer behind an inaccessible
  `ReviewedCommunitySyncContext`. It consumes production-parsed daily usage, revalidates the closed
  identifiers/time/entry bounds, emits one exact seven-field `ConnectorSyncV1` body, hashes those
  bytes with pinned RustCrypto SHA-256, and builds the exact unpadded-base64url, LF-separated device
  message without loading a key or opening a network path. Six Rust cases and one production-path
  Ingest case share a synthetic exact-body/digest/message vector. That composer boundary alone
  implies no source/device context provider, entropy, clock, key store, HTTP client, retry loop,
  scheduler, or support row.
- An isolated one-use candidate Ed25519 signer behind an inaccessible device-bound key capability.
  It removes public access from prepared unsigned material, consumes the key, rejects a different
  device ID without reflection, signs only the exact prepared message, and returns the same body
  plus five exact header values. Prepared/signed private byte buffers and the upstream key are
  zeroed on drop. Three Rust cases and the production Ingest protocol test now share and strictly
  verify the synthetic public key/signature, including body-change and trailing-LF rejection. The
  exact ten-record Dalek graph is pinned, inventoried,
  license/advisory/feature/build/unsafe-reviewed, and default features remain disabled except
  zeroization. That signer boundary alone implies no real key generation/store, pairing proof,
  context provider, upload, scheduler, supported Codex version, or release.
- A Windows x86_64 candidate-only `sync` command that requires an active native credential and an
  explicit exact Codex `0.144.5` artifact. It canonicalizes and hash-admits the selected file while
  holding it against write substitution, runs the existing bounded collector in a fresh empty
  directory, creates fresh request time/ID/nonce, consumes the existing composer/signer, and sends
  one no-proxy/no-redirect/no-retry request to the fixed sync path. Exact loopback tests cover only
  the five device headers and closed acknowledgement; no local Codex account, real credential,
  deployed edge/Ingest/database, supported version, package, or release is exercised.
- Bounded Windows x86_64 discovery for that same candidate sync. After active-record validation it
  considers at most 64 absolute `PATH` directories, only two fixed executable names, canonical paths
  of at most 2,048 bytes, and at most four distinct exact-size hashes before requiring the existing
  exact `0.144.5` SHA-256 and retained no-write-sharing handle. The explicit `--codex` form remains
  available under identical admission. Relative entries, wrappers, arbitrary names, over-budget
  searches, and all artifacts that do not match fail closed without path diagnostics; tests remain
  synthetic and add no supported version, other platform, package, release, or clean-machine claim.
- A separate explicit `check-codex [--codex <absolute-path>]` command that reuses only that exact
  selector without opening credential storage, starting Codex, reading an account, persisting a
  result, or using the network. It releases the admitted handle and prints only the exact candidate
  version plus an explicit unsupported statement; failures disclose no path, digest, search entry,
  metadata, or operating-system detail. Its point-in-time result grants no authority and `sync`
  still validates the active record before repeating admission. This adds no support row, package,
  release, clean-machine evidence, or other-platform result.
- A Windows x86_64 portable connector lifecycle smoke that builds the locked release profile,
  exclusively copies the `0.0.0` binary into a random bounded temporary root, verifies its exact
  five-command help surface and generic missing-candidate failure under a cleared environment, then
  rechecks SHA-256 integrity and removes every copied entry. A new secretless read-only
  `windows-2025` job runs only the public scan, pinned toolchain, locked build, and smoke; workflow
  policy mutations reject another runner, missing steps, or an upload action. This creates no
  package, installer, hosted result, upgrade/revoke evidence, signature, checksum publication, SBOM,
  provenance, release, or support claim.
- An explicit `check-codex --diagnostic-preview` mode that performs the same one-shot candidate
  admission and writes one closed local v1 preview containing only fixed version/platform contract,
  a three-value admission class, and the empty support state. It retains nonzero failed admission,
  omits paths, digests, environment values, credentials, account, and usage, and gives the connector
  no file, upload, telemetry, or sharing capability.
- Bounded pairing start, possession, and dormant activation compositions. The start boundary accepts
  only closed device metadata, creates fresh server IDs, a 32-byte poll token and challenge, a
  60-bit human code, and a nine-minute expiry, then stores separate protected poll/code HMAC
  verifiers through one fixed procedure. Rust and Web share one exact
  transaction/challenge/public-key Ed25519 vector; the Web verifier is strict and server-only. The
  fixed four-client read-write pool wrapper probes the exact Web role/login/search path, one fixed
  query selects at most one approved transaction, and the high-level adapter alone invokes exact
  atomic activation after proof with server-owned device, audit, and request IDs. Four-call
  admission plus a 250-millisecond floor produces only generic local failure decisions. This
  injected boundary alone provides no live login, real key, capacity, monitoring, or deployment
  evidence.
- A local signed-in `/connect` approval flow with persisted exact-session code-attempt bounds,
  bounded device/fingerprint review, and an explicit new-source or active existing-source choice.
  Existing choices expose only source ordinals, device labels, and encrypted session-bound controls;
  raw source IDs remain server-only. A separate fresh passkey assertion binds the exact pairing,
  source choice, source ID, RP, and origin before one fixed atomic approval. Component, application,
  HTTP, and fixed-query tests cover exact body shapes, opaque selection, token tamper, replay, and
  first-winner settlement. Exact local start/poll routes and the native-store Rust client complete
  only a synthetic journey; there is no live authenticator/database result, trusted edge, release,
  or deployment evidence.
- A shared exact default-off module-load gate for connector pairing start/poll and signed-in pairing
  approval options/verification. Only `VIBERACING_PAIRING_ENABLED=true` permits request parsing,
  runtime/service construction, admission acquisition, or pairing storage work; disabled POST
  cancels any available body, returns the existing generic no-store 503, and leaves connector
  non-POST handling at 405. The tracked example remains false, and no dynamic/deployed switch is
  claimed.
- An independent exact default-off source-creation gate for `/connect` and both browser pairing
  approval steps. Only `VIBERACING_SOURCE_CREATION_ENABLED=true` permits a new opaque source;
  disabled UI omits that choice in EN/RU, preserves active existing-source pairing, and disables
  submission when no source is eligible. The service repeats literal-true enforcement before
  new-source lookup/challenge work and before passkey verification/database completion. The sealed
  five-minute challenge and v2 context digest now bind exact source choice, so an in-flight
  new-source approval also fails closed after a restarted module resolves disabled. The tracked
  example remains false; no dynamic/deployed switch, rate limit, cleanup, or worker-drain result is
  claimed.
- An exact default-off CarRecipe proposal gate across the account page, browser create and approve,
  and source-bound device proposal ingress. Only `VIBERACING_CAR_PROPOSALS_ENABLED=true` permits
  creation, replacement, or activation. Disabled browser/device POST stops before request parsing,
  runtime/service construction, admission, proof, or database work; the browser proposal service
  repeats literal-true enforcement before recipe/control/session work. EN/RU account UI preserves
  active and private pending previews plus exact session-bound rejection while omitting editor and
  approval controls. The tracked example remains false; no dynamic/deployed switch, worker drain,
  monitoring, distributed rate limit, or cleanup schedule is claimed.
- An exact default-off invite/OAuth/initial-passkey enrollment gate across `/join`, `/join/passkey`,
  GitHub start/callback, and initial-passkey options/verification. Only
  `VIBERACING_ENROLLMENT_ENABLED=true` permits the state machine. Disabled routes stop before
  request/runtime/admission/private work, and four production service methods repeat literal-true
  enforcement before OAuth/WebAuthn/database work. EN/RU pages omit enrollment forms while active
  session redirects, returning login, and restricted recovery remain available. The tracked example
  remains false; the switch itself provides no dynamic/deployed behavior, in-flight termination,
  abandoned-profile cleanup, invite repair, worker drain, monitoring, or distributed rate limit. A
  separate Jobs-only bounded abandoned-enrollment cleanup now exists without a scheduler.
- An exact local-only `forget-local` connector command that derives one canonical origin/label
  native-store account and invokes deletion without loading the credential, constructing a signer,
  starting Codex, or contacting Vibe Racing. Deleted and absent entries share one identifier-free
  result that explicitly distinguishes local removal from authenticated server device revoke. Rust
  tests cover closed arguments, delete-only behavior, native `NoEntry` mapping, generic storage and
  output failure, and idempotent retry; no real OS credential, rotation, server-revoke composition,
  package, or release is exercised.
- A local invite-to-passkey enrollment vertical slice with EN/RU join/account UI, exact bounded
  same-origin POST routes, state plus S256 PKCE and no extra GitHub scope, purpose-separated
  AES-256-GCM HttpOnly cookies, fixed atomic enrollment/challenge/passkey/session database calls,
  required user-verified initial WebAuthn registration, atomic rotation from a 15-minute pending
  session to a fresh passkey-bound session, logout, no-queue admission, and generic
  no-store/no-referrer failures. SimpleWebAuthn server/browser packages are exact-pinned, confined
  to one owner each, license/advisory/asset-reviewed, and covered through injected production paths.
  No invite issuer UI, recovery sign-in, live OAuth/authenticator/database credential, edge rate
  policy, cleanup schedule, monitoring, or deployment is implied.
- A local returning-passkey login slice with EN/RU UI, same-origin bounded POST routes, a
  discoverable profile-free WebAuthn challenge held only in a purpose-separated encrypted cookie,
  exact active-credential lookup, RP/origin/type/UV/signature verification, and one atomic
  challenge-create/consume plus passkey-provenance session call. Failed cookie sealing revokes the
  just-minted session; the route adds no anonymous database state before valid proof. Distributed
  attempt limits, live OAuth/authenticator/database credentials, recovery sign-in, monitoring, and
  deployment remain separate gates.
- The authenticated account page now reads a session-scoped passkey inventory through one existing
  fixed Web/Auth capability and renders only label, active/revoked state, rounded creation date, and
  the current-authenticator marker. Invalid, cross-profile, empty, oversized, duplicate, unordered,
  or open database rows fail closed; an unavailable inventory leaves logout usable.
- The authenticated account page now also renders its current Community week from one combined
  visibility/score checkout. A Web-only exact-session procedure returns only existing derived
  summary fields and seven daily scores; the closed mapper rejects malformed or inconsistent rows,
  hidden profiles expose no score, and no raw usage, private identifier, browser fetch, or storage
  is added.
- An authenticated account can now revoke an owned non-current active passkey after one fresh
  user-verified assertion. A five-minute continuation binds the exact session, target, RP, origin,
  and database challenge; one fixed atomic call consumes that challenge and terminally revokes the
  target. Current, last, foreign, malformed, expired, and replayed attempts fail generically.
- An authenticated account can now add one backup passkey after a fresh assertion by an existing key
  and a separate registration ceremony. The validated label and two independent five-minute
  challenges are session/profile/RP/origin-bound; one fixed statement atomically consumes the
  step-up and inserts the new credential under the existing retained-record cap.
- An authenticated account can now rotate exactly ten recovery codes after a fresh required-UV
  passkey assertion. Web/Auth generates independent selector/secrets, derives Argon2id PHCs
  sequentially under a separate protected pepper, and atomically consumes the five-minute challenge
  while replacing every old code and active recovery authority. Plaintext is returned only after
  commit in one no-store response and held only in page memory for one EN/RU display. Tracked secret
  and work-factor settings are non-working placeholders; recovery-code verification and
  replacement-passkey registration remain separate work.
- SQL-first identity/source/device/pairing/deletion persistence with a checksum-ledgered migration,
  deterministic synthetic invariant fixtures, and an isolated PostgreSQL CI integration gate.
- Procedure-only identity lifecycle capabilities for bounded invite issuance, atomic enrollment,
  exact-session initial-passkey challenges, session rotation/revocation, synchronous deletion
  lock-down, opaque purge queueing, and bounded audit references.
- Procedure-only pairing capabilities for new or existing opaque sources, session/passkey-bound
  approval, minimal external Ed25519 verification material, exact single-device activation, and
  public 32-source/64-authority safety ceilings.
- Procedure-only private source/device inventory, immediate source pause and device revoke, plus
  fresh-step-up source reactivation/unlink with terminal unlink and recursive authority revoke.
- Procedure-only passkey login and multi-passkey management with minimal verification lookup,
  credential-derived sessions, private inventory, bounded add/revoke, and exact step-up provenance.
- Procedure-only restricted recovery with passkey-protected 8-to-16-code batch rotation, used-PHC
  scrubbing, minimal selector lookup, a one-time ten-minute replacement authority, and atomic
  replacement-passkey/session completion.
- Procedure-only Community usage persistence with minimal active-device verification lookup, bounded
  raw snapshot/replay state, exact idempotent retry, monotonic source/day values, and quarantine for
  decreases or quarantined sources.
- Jobs-only bounded cleanup for expired origin/device nonces and raw Community snapshots, with
  server-time cutoffs, an owner-only mutex row, bounded lock wait, preserved current source/day
  values, strict batch limits, and no implied scheduler.
- Jobs-only bounded cleanup for expired authentication challenges and restricted recovery
  authorities plus their still-present used/scrubbed code rows, with profile-first recovery lock
  ordering, live/unused state preservation, worker and cross-capability race evidence, and no
  implied scheduler.
- Jobs-only bounded cleanup for expired active or revoked invite verifier rows, with oldest-first
  1-to-1000 batches, a shared authentication mutex, live/redeemed preservation, observed worker
  serialization, and no implied invite issuer UI, scheduler, or deployment.
- Jobs-only bounded cleanup for eligible expired browser sessions, with oldest-first 1-to-1000
  batches, rotation-chain progress, challenge cascade, activated-pairing provenance preservation, a
  shared authentication mutex, and observed two-worker serialization; no scheduler or complete
  history-retention policy is implied.
- Jobs-only maximum-10 primary profile deletion for due queued/retry work, with committed
  `deletion_pending` validation, all-maintenance mutex ordering, restrictive-pairing and pending-key
  cleanup, atomic terminal job settlement, cascaded primary-data removal, redacted retained audit,
  two-worker/cross-capability race evidence, and no invented tombstone or implied scheduler.
- Jobs-only maximum-1000 cleanup for terminal profile-deletion jobs only after at least 30 days from
  server-recorded completion, with oldest-first partial-index selection, shared purge-mutex
  serialization, repeated eligibility predicates, recent/non-terminal preservation, and no implied
  tombstone, backup purge, restore replay, or scheduler.
- Jobs-only maximum-1000 cleanup for database audit references only after at least 180 days from
  server-recorded occurrence, with oldest-first index selection, a separate private mutex, repeated
  cutoff enforcement, recent-evidence preservation, and no implied external audit sink, backup
  purge, deployment, or scheduler.
- Jobs-only maximum-1000 redaction of exact session/passkey approval references from activated
  pairings only after at least 180 days from server-recorded activation, with a two-mutex lock
  order, an exact trigger transition, preserved profile/source/device binding and
  pairing/device/passkey rows, subsequent expired-session cleanup progress, and no implied
  device-history deletion, scheduler, backup purge, or deployment.
- Jobs-only maximum-1000 deletion of passkeys only after at least 180 days in revoked state and only
  when no session, verifying/authorized challenge, or pairing reference remains, with two-mutex
  ordering, repeated eligibility predicates, active/recent/referenced preservation, recovery-ceiling
  progress, and no implied scheduler, backup purge, or deployment.
- Jobs-only maximum-1000 paired deletion of an activated pairing and its exact revoked device key
  only after both are at least 180 days old, approval provenance is minimized, and no authorization
  challenge, nonce, or raw snapshot reference remains, with Ingest/pairing mutex ordering, repeated
  eligibility predicates, active/recent/referenced preservation, and no implied scheduler, cascade,
  backup purge, or deployment.
- Jobs-only zero-argument reset of positive anonymous pairing transport rate windows only after the
  maximum one-hour duration, with a closed epoch/zero state, complete fixed 130-row inventory,
  operation/global/bucket lock order, worker/admission race evidence, and no implied trusted edge
  identity, scheduler, capacity result, or deployment.
- Jobs-only maximum-1000 cleanup for canonical abandoned `enrolling` profiles only after all exact
  enrollment-session/registration-challenge authority is expired, one redeemed invite remains, and
  no other profile-bound recovery, authority, source, deletion, scoring, or recipe state exists,
  with authentication/profile-purge mutex ordering, repeated eligibility predicates, worker and
  initial-passkey activation race evidence, retained redacted audit evidence, and no implied invite
  reuse, deletion job, tombstone, notification, scheduler, backup purge, or deployment.
- Jobs-only atomic open-season Community scoring refresh with immutable formula/season binding,
  distinct-source aggregation under one profile cap, shared-rank semantics, private derived score
  tables, bounded lock/statement waits, no empty-season growth, and observed concurrent idempotent
  reruns; no scheduler or public read is implied.
- Jobs-only immutable Community season finalization after an exact 48-hour server-time grace period,
  with whole-payload late quarantine, terminal no-data seasons, idempotent retry, bounded calendar
  support, and no implied scheduler, correction capability, or public read surface.
- Jobs-only maximum-1000 cleanup of exact finalized source/day values only after a terminal season
  has retained them for 30 days, with a private UTC-day/count freshness projection, unchanged public
  race-status output, repeated live/captured integrity checks, shared maintenance-lock ordering,
  worker/finalization/profile-purge race evidence, and no implied scheduler, correction process,
  backup purge, or deployment.
- A private local one-shot Jobs workspace for exactly eighteen fixed capabilities: authentication,
  abandoned-enrollment, audit-event, invite, CarRecipe-proposal, ingest, finalized-source-day,
  pairing, session, aged revoked-passkey, or aged minimized revoked-device cleanup; pairing
  approval-provenance redaction; primary profile purge; fixed pairing-rate-window reset; terminal
  deletion-job cleanup; open-season refresh; terminal finalization; or oldest-known historical
  season finalization. It has strict command/object/result parsing, a distinct redacted database
  namespace, one-client pool, fixed deadlines, an exact role/login/capability/search-path probe,
  prepared procedure calls, destructive failure release, stable non-reflective CLI output,
  production build, and 273 tests at 100% coverage. A separate opt-in Docker gate now applies every
  reviewed migration, runs all eighteen emitted commands through one synthetic least-privileged
  login, rejects a deliberately widened login before mutation, verifies generic output and exact
  stored state, and cleans up its container, network, and storage. It adds no scheduler, production
  credential/TLS path, monitoring, retry loop, capacity result, or deployment claim.
- Web-only bounded Community score projection for open or finalized seasons, with an exact public
  field allowlist, active-profile filtering, post-hide re-ranking, fixed ordering, and no implied
  HTTP route, cache, profile detail, or complete race DTO.

### Security

- Distinguished a normally completed HTTP request stream from an aborted upload after asynchronous
  Ingest database work. Real loopback regression evidence now requires the accepted response body,
  content type, and exact server request ID instead of allowing an empty HTTP 200.
- Patched the transitive Next.js PostCSS resolution from 8.4.31 to 8.5.19 for GHSA-qx2v-qp2m-jg93,
  with an exact expiring override and removal condition.
- Pinned pnpm to a repository-local virtual store for deterministic CI/developer dependency layout.
- Kept the unused native Sharp graph absent while satisfying Next.js's type-only declaration with a
  `never` sentinel and a regression-tested production import ban.
- Made official-registry audits fail on moderate-or-higher advisories, rejected future-dated
  override reviews, and restored extraneous-install detection alongside cross-platform metadata.
- Exact staged-blob scanning for common secret, personal-data, local-path, symlink, and submodule
  hazards.
- Read-only, secretless pull-request CI with pinned actions and policy-tested workflow constraints.
- Explicit publication blockers for real maintainers, CODEOWNERS, private reporting, and hosted
  controls rather than unsafe inferred identities.
- Per-response nonce CSP, browser isolation/capability headers, local-only preference storage,
  closed-enum car recipes, and score-only client fixtures with no raw token buckets.
- Refined pairing so a one-time poll token is stored only as a keyed verifier and cannot activate a
  device without fresh browser passkey approval and Ed25519 possession proof over an immutable
  pending key.
- Added separate `NOLOGIN` owner/Web/Ingest/Jobs/Admin groups, forced owner-only RLS, revoked
  `PUBLIC` database/schema access, safe database/role search paths, zero direct runtime table
  grants, and exact pending-key/source/device binding enforced by state triggers and composite
  foreign keys.
- Bound every implemented profile action to possession of an active session ID and keyed verifier,
  bound challenges to the exact session/profile pair, removed caller-selected profile IDs from the
  procedure surface, and added replay, expiry, IDOR, rollback, role-separation, and deletion-revoke
  PostgreSQL scenarios using synthetic data only.
- Prevented short-code-only activation, post-approval competing-profile takeover, poll replay,
  source-choice swaps, key rebinding, and authority fan-out beyond the public database ceilings;
  external WebAuthn and pairing-possession Ed25519 verification remain mandatory before the matching
  procedures are called.
- Added deterministic cross-connection lock races proving first-winner pairing approval and atomic
  enforcement of the 32-source and 64-live-authority ceilings, including exclusion of expired
  approvals from live authority.
- Added lifecycle IDOR, replay, quarantine, stale-challenge, audit-rollback, and role-denial
  scenarios plus cross-connection races proving pause dominates concurrent approval and unlink
  dominates concurrent activation without leaving protected authority live.
- Added observed identity races proving one-winner invite enrollment, initial-passkey challenge
  consumption, and session rotation plus deletion dominance over concurrent rotation without stale
  authority or losing transaction artifacts.
- Made all twenty-seven race gates observe every tagged contender in the holder's PostgreSQL blocker
  chain before releasing the holder, and made protective races prove first-contender queue order
  before launching the competing action, removing timer-only and scheduler-order evidence.
- Added Community ingest rejection, replay, binding, role, and lifecycle scenarios plus observed
  races proving one exact retry creates one snapshot, same-source devices converge on one monotonic
  value, and pause/revoke serialize ahead of later submissions.
- Added cleanup boundary, idempotency, role-denial, live-row preservation, raw-provenance cascade,
  and observed two-worker serialization scenarios using only synthetic ephemeral PostgreSQL state.
- Added finalization boundary, idempotency, immutability, no-data, role-denial, and late-quarantine
  scenarios plus observed races proving finalization and late ingest converge on one terminal state,
  post-lock server time decides deadline behavior, and opposing multi-season payload order cannot
  create advisory-lock cycles.
- Added public score field-allowlist, visibility, shared-rank, result-ceiling, statement-deadline,
  and role-denial scenarios; hiding a profile removes it and closes public rank/display gaps without
  granting Web direct table access.
- Added response-contract regression coverage for Community trust constants, the ten public score
  fields, empty/top-32 pages, duplicate display positions, bounds, private-field rejection, and
  privacy-safe validation issues without advertising an HTTP route.
- Rejected the native all-zero Ed25519 public-key/signature acceptance path discovered during local
  review by exact-pinning dependency-free `@noble/ed25519@3.1.0`, using strict RFC 8032/FIPS
  verification, and retaining the bypass as an explicit regression case. The dependency is confined
  to one private server-side verifier and adds no browser, connector, network, or install-script
  capability.
- Added query-contract and generator regression coverage for inclusive season bounds, malformed and
  non-Monday dates, unknown/accessor fields, date-extension fail-closure, exact OpenAPI response and
  header semantics, unsafe paths/schema references, duplicate operations, problem-vocabulary drift,
  and stale generated output.
- Added projection-mapper regression coverage for malformed arrays/rows, accessors, private or
  missing columns, calendar boundaries, contract bounds, shared-rank gaps, page limits, and
  non-reflective runtime failures without connecting to PostgreSQL.
- Added 62 adapter regression cases for environment/TLS/password bounds, safe config serialization,
  pool lifecycle and stable idle errors, canonical seasons, every-checkout database boundary probes,
  fixed SQL parameters/date casts, malformed/accessor/revoked results, healthy versus destructive
  release, and non-reflective connection/query/release/projection failures. A configuration checker
  now locks tracked Web placeholders apart from the compose owner.
- Added 17 public HTTP boundary cases for exact entropy and base64url shape, production request-ID
  generation, all eleven problem mappings, contract-valid bodies, no-store/content-type headers,
  absent CORS, opaque token enforcement, and non-reflective short, throwing, accessor-backed,
  revoked, unknown, or prototype-polluted inputs.
- Made passkey race preservation assertions fail when an expected row is missing and added a static
  regression check that rejects missing-row-unsafe scalar-subquery `IF NOT` assertions.
- Made passkey revoke terminal, protected the last active key, preserved monotonic sign state, and
  atomically removed the credential's browser, unused ceremony, and pending pairing authority;
  observed races prove one login-challenge winner and revoke-dominant final state under contention.
- Documented revision 0005 as a security upgrade: it invalidates pre-revision authentication
  challenges, cancels approved-but-not-activated pairings, and revokes legacy active sessions for
  profiles that already have passkeys so they must sign in again under attributable provenance.
- Added recovery replay, scope, PHC scrub, deletion, role-denial, lifetime-cap, and atomic rollback
  scenarios plus observed races proving one-code/one-authority use, fresh rotation dominates
  old-code start, and recovery completion dominates old-passkey login. Protective timestamps are
  captured after row-lock acquisition so concurrent authority created after statement start cannot
  survive or make revocation predate creation.

No version has been released.
