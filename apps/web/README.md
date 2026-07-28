# Vibe Racing web prototype

This workspace is the Phase 1 product shell: a responsive pixel-art race, Community leaderboard, and
demo profile with committed synthetic fallback data. It is suitable for local design, accessibility,
localization, and scoring review. The visible race, leaderboard, and selectable participant summary
now request the current server-selected Community week from the exact same-origin direct-token route
first, use the legacy race-status route when that surface is unavailable, validate the bounded
response in the browser, and retain the labeled synthetic fallback on any failure. Community
summaries add complete-UTC-day freshness and an optional preference-gated streak to the public score
or direct weekly token total, source-count, and current-car fields. Exact receipt time, daily/source
detail, device counts, and identifiers remain absent; the selected handle is carried only in a
canonical `/?profile=handle#profile` URL. Invalid or duplicate values are ignored, a missing current
top-32 row is not replaced, and a public signed-in profile links to its current summary. An ordinary
same-tab selection updates the summary and URL without a reload; modified clicks retain native link
behavior. The fallback demo garage and default product shell remain synthetic and unauthenticated,
with no deployment database login, real user data, or deployment. A separate opt-in integration uses
only disposable synthetic Web logins and data. The same page exposes an EN/RU score simulator backed
by the production scoring functions. It accepts only one canonical non-negative safe integer and one
to seven active days, keeps both values only in component memory, and never fetches, logs, persists,
submits, or preloads account or race data. A separate local Phase 2 slice now implements invite
redemption, GitHub OAuth state plus PKCE, encrypted HttpOnly continuations, initial passkey
registration, returning login, a session-scoped passkey inventory, an account page, public-profile
hide/show, source inventory/pause/reactivation/unlink, active-device revoke, fresh backup-passkey
addition, revocation of an owned non-current passkey, an exact-handle fresh-passkey profile-deletion
request, fresh-passkey recovery-code rotation with one-time display, one-time recovery-code
replacement-passkey sign-in, and logout. It fails closed without externally provisioned
configuration. A signed-in `/connect` page also performs one session-rate-limited pending-code
lookup, displays only bounded device evidence and a full public-key fingerprint, then requires a
separate fresh passkey assertion before atomic approval for an explicitly selected new or active
existing source. Existing-source controls are encrypted and session-bound; raw source IDs do not
enter HTML. Connector start/poll and both signed-in approval routes remain unavailable unless each
route module resolves exact `VIBERACING_PAIRING_ENABLED=true`; the tracked example stays false.
Creating a new source additionally requires exact `VIBERACING_SOURCE_CREATION_ENABLED=true` in the
page and both approval modules. Its tracked example stays false; active existing-source pairing
remains available when pairing itself is enabled. These flows have no live-user or deployment
evidence.

The private account render now combines visibility with the exact session's current Community week
in one existing Web/Auth pool checkout. Its closed mapper accepts one empty sentinel or exactly
seven consecutive derived daily scores plus bounded summary fields; hidden profiles show no score,
and no raw usage, private identifier, browser fetch, cache, or storage is added.

## Run it

From the repository root:

```text
pnpm install --frozen-lockfile --ignore-scripts
pnpm run dev:web
```

The development command binds Next.js to the `localhost` loopback hostname so local WebAuthn uses
its standards-defined development origin without exposing the server to the LAN. No `.env` file is
needed for the synthetic race. Live local score/race/status reads additionally require exact
`VIBERACING_PUBLIC_RANKING_ENABLED=true` before their route modules load; the tracked example stays
false and the browser keeps the labeled synthetic fallback. The optional server-only
`VIBERACING_PUBLIC_ORIGIN` setting controls absolute social metadata and is mandatory for a hosted
deployment; it is public configuration, not a secret. The emitted home HTML uses the exact
discoverability phrase `vibecode rating` in honest self-reported leaderboard copy, publishes one
root canonical, and exposes an origin-bound `robots.txt` plus `sitemap.xml`. Account, enrollment,
recovery, and pairing pages are `noindex`; API routes stay out of the crawl surface. These files let
search crawlers discover the deployed site but do not prove that a search engine has indexed or
ranked it. Use `pnpm run lint:web`, `pnpm run typecheck:web`, and `pnpm run test:web` while
iterating. The typecheck command first runs Next's route-type generator, so a fresh checkout does
not depend on ignored `.next` output; the generated `next-env.d.ts` also remains ignored. Coverage,
the production build, the built-artifact check, and the deterministic query-plan parser are
boundary/release evidence included by `pnpm run verify:release`, not by the normal root development
gate. `pnpm run verify:web:deployment` additionally builds and exercises the emitted standalone
runtime with its search metadata/discovery endpoints and the static asset layout used by the root
production image. The safe Web-only Railway procedure is documented in
[`docs/getting-started/RAILWAY_WEB_STAGING.md`](../../docs/getting-started/RAILWAY_WEB_STAGING.md);
it keeps every participant capability disabled and is not a data-backed beta deployment.
`pnpm run test:web:postgres-integration` is the separate Docker-backed synthetic boundary: it builds
the emitted standalone artifact, bundles the reviewed `pg` driver, and launches two Next production
processes on loopback against a TLS-enabled disposable PostgreSQL database with one ephemeral
self-signed DNS certificate. It verifies widened-login denial, exact narrow-login contracts, TLS
1.2/1.3, and that neither path mutates private tables. Its test-only database-scoped `auto_explain`
configuration additionally verifies the four fixed adapter plans and their four nested
score/race/status/token projections without logging parameters or retaining the plan log. It also
proves the four-request no-queue admission boundary with four observed blocked score queries and a
rejected fifth request. The Docker gate is intentionally outside root `verify`.

The separate stored viewport evidence covers every combination of three reviewed breakpoints, both
locales, and all three themes with motion disabled. `pnpm run check:phase1-visual-baselines`
verifies the exact PNG inventory, dimensions, digests, and public metadata policy offline. An
explicit local `verify:phase1-visual-baselines` run additionally refuses browser product/platform
drift, decodes both images inside isolated Chromium, and requires zero changed pixels without
writing repository files. It then dispatches browser keyboard events through CDP, requires the
closed 16-target focus order plus skip-target transfer and pause-button activation, validates named
landmarks/controls/table/canvas in Chromium's accessibility tree, and repeats the focus/border
checks with forced colors active. Finally, it disables Chromium's network cache and takes three LCP,
CLS, and trusted pointer-interaction duration samples in both animation-on and reduced-motion
states. It does not authenticate the supplied executable or replace a native screen-reader,
cross-browser, field Core Web Vitals, or staging SLO pass. Regeneration is a separate local browser
task: build and start this workspace on loopback, then run
`pnpm run capture:phase1-visual-baselines -- --origin <loopback-http-origin> --browser <absolute-path-to-reviewed-chromium> --write`.
The capture creates its own temporary browser profile and rejects non-loopback page resources; it
never opens a contributor's normal browser profile. Review all rendered diffs manually because root
verification does not launch or provision Chromium.

To exercise enrollment manually, use an ignored environment with `/auth/github/callback` on the
configured `localhost` origin as the exact OAuth callback, a dedicated GitHub OAuth app, a fresh
canonical 32-byte `SESSION_SECRET`, matching `VIBERACING_PUBLIC_ORIGIN`/`WEBAUTHN_ORIGIN` and
hostname `WEBAUTHN_RP_ID`, a distinct protected 32-byte recovery pepper plus deployment-reviewed
Argon2id settings and response floor, and a separately provisioned `viberacing_web` login. The
repository provides no valid invite or working credential; the tracked recovery settings are
deliberately non-working placeholders. See `.env.example` and the local-development guide. Manual
enrollment additionally requires exact `VIBERACING_ENROLLMENT_ENABLED=true` before both enrollment
pages and all four GitHub/initial-passkey route modules load. Manual pairing requires exact
`VIBERACING_PAIRING_ENABLED=true` before all four pairing route modules load. New-source pairing
also requires exact `VIBERACING_SOURCE_CREATION_ENABLED=true` before the `/connect` page and both
approval modules load. Changing a value afterward does not reload an existing worker. The
direct-token public route independently requires exact `VIBERACING_TOKEN_RANKING_ENABLED=true`;
enabling or disabling it does not change the legacy public-ranking decision.

## Module map

| Path                                                                             | Responsibility                                                           | Trust boundary                                                                       |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `app/page.tsx`                                                                   | Selects the current week and builds the synthetic fallback               | Must pass only public labels and presentation data into the client tree              |
| `lib/race-data.ts`                                                               | Clearly synthetic raw activity fixtures and payload projection           | Marked `server-only`; never replace with exports or real account data                |
| `lib/public-community-race.ts`                                                   | Loads the token race first with a legacy status fallback                 | Lazy exact same-origin GET; no credentials/cache; closed metric/status/recipe fields |
| `lib/public-community-score-mapper.ts`                                           | Validates the exact SQL score, race, status, and token projections       | Server-only, four exact top-32 shapes, and fail-closed                               |
| `lib/public-community-score-store.ts`                                            | Executes the four fixed public score/race/status/token procedures        | Canonical Monday only; verifies every checkout; routes construct lazily              |
| `lib/public-community-score-route.ts`                                            | Parses and serializes all four public GET boundaries                     | Exact paths/query/Accept, generic errors, admission, deadlines, and no CORS          |
| `lib/public-ranking-config.ts`                                                   | Resolves one shared default-off public-ranking decision                  | Exact own string value; no database/request field or reflection                      |
| `lib/public-token-ranking-config.ts`                                             | Resolves the independent default-off direct-token decision               | Exact own string value; no database/request field or reflection                      |
| `lib/public-score-admission.ts`                                                  | Enforces the no-queue public-read concurrency ceiling                    | Four active reads; lease held until adapter settlement                               |
| `lib/public-http-problem.ts`                                                     | Generates opaque request IDs and closed public error responses           | Server-only; validates the contract; no inbound ID, CORS, detail, or cause           |
| `app/join`, `app/login`, `app/recover`, `app/account`, `app/connect`, `app/auth` | Routes enrollment, recovery, account, pairing approval, deletion, logout | Thin session/browser entrypoints; no admin                                           |
| `app/v1/connector/pairing`                                                       | Routes anonymous connector pairing start/poll                            | Exact POST and default-off pairing decision; delegates to the closed HTTP boundary   |
| `components/account-experience.tsx`                                              | Renders visibility, devices, passkeys, recovery codes, deletion          | Closed state and opaque targets; plaintext codes exist only after explicit action    |
| `lib/enrollment-http.ts`                                                         | Owns the local identity and pairing-approval HTTP decisions              | Exact origin/content/body/cookie policy, no-store, no-referrer, and no queue         |
| `lib/enrollment-service.ts`                                                      | Composes OAuth, login, account security, pairing, and deletion           | Server IDs/secrets only; fixed database capabilities; generic failure                |
| `lib/enrollment-cookie.ts`                                                       | Seals login, OAuth, passkey, recovery, and session continuations         | AES-GCM with purpose-separated keys, bounded expiry, HttpOnly, and narrow paths      |
| `lib/github-oauth.ts`                                                            | Resolves one GitHub numeric user ID                                      | State plus PKCE, no extra scope, fixed endpoints, token and other fields discarded   |
| `lib/passkey-registration.ts`                                                    | Creates and verifies registration and login ceremonies                   | Exact RP/origin/type, required UV, fixed algorithms, and bounded output              |
| `lib/recovery-code.ts`                                                           | Generates and verifies exact recovery codes and Argon2id PHCs            | Server-only; protected pepper, bounded matching/dummy work, transient plaintext      |
| `lib/enrollment-database.ts`                                                     | Owns fixed identity database operations                                  | Reuses the probed Web/Auth pool; no general query or reflected database detail       |
| `lib/enrollment-enable-config.ts`                                                | Resolves one module-local default-off enrollment decision                | Exact own string value; separate from protected OAuth/WebAuthn runtime configuration |
| `lib/pairing-possession-verifier.ts`                                             | Strictly verifies one approved pending-device proof                      | Server-only pure kernel; no poll lookup, activation, HTTP, rate, or persistence      |
| `lib/pairing-config.ts`                                                          | Resolves one module-local default-off pairing decision                   | Exact own string value; no request/runtime/key/database field or reflection          |
| `lib/source-creation-config.ts`                                                  | Resolves one module-local default-off new-source decision                | Exact own string value; no request/session/source/database field or reflection       |
| `lib/car-proposals-config.ts`                                                    | Resolves one module-local default-off proposal mutation decision         | Exact own string value; no session/recipe/device/database field or reflection        |
| `lib/pairing-poll-verifier.ts`                                                   | Derives fixed poll-verifier candidates under protected keys              | Primary plus optional secondary; no raw key container; close clears key copies       |
| `lib/pairing-user-code-verifier.ts`                                              | Derives fixed human-code verifier candidates under separate keys         | Primary plus optional secondary; cross-purpose key reuse is rejected                 |
| `lib/pairing-start-material.ts`                                                  | Generates bounded pending-transaction material                           | Server IDs, 32-byte token/challenge, 60-bit code, and nine-minute expiry             |
| `lib/pairing-start-database.ts`                                                  | Owns exact pending-pairing creation                                      | Closed metadata and generated fields only; destructive release on failure            |
| `lib/pairing-start-application.ts`                                               | Composes transport-free start policy                                     | Four admitted calls, 250 ms floor, generic failure, no approval authority            |
| `lib/pairing-activation-database.ts`                                             | Owns approved lookup, strict proof, and exact activation                 | Fixed procedures only; server IDs only; destructive release on boundary failure      |
| `lib/pairing-activation-application.ts`                                          | Composes transport-free activation policy                                | Four admitted calls, 250 ms floor, generic failure, no browser authority             |
| `lib/pairing-database-config.ts`                                                 | Derives a separate read-write pool from the Web/Auth login               | Same strict TLS/deadlines; explicit role/search-path/read-write probe                |
| `lib/pairing-rate-policy.ts`                                                     | Validates anonymous client IDs and mandatory rate configuration          | Domain-separated digest; raw ID cleared; operation-global plus fixed bucket limits   |
| `lib/pairing-transport-service.ts`                                               | Owns one start/poll application composition                              | One pool/key set/rate policy and aggregate four-call admission                       |
| `lib/pairing-http.ts`                                                            | Parses and serializes the connector pairing HTTP contract                | Exact path/media/body/header; no-store/no-CORS; generic bounded problems             |
| `lib/pairing-database-pool.ts`                                                   | Wraps `pg` with fixed pairing start/approval/activation calls            | No generic query; copies/clears byte parameters; stable idle-error signal            |
| `lib/public-score-database-config.ts`                                            | Parses the dedicated Web login and TLS/pool contract                     | Owner settings are separate; production is verify-full; errors reflect no value      |
| `lib/public-score-database-pool.ts`                                              | Wraps `pg` with narrow connect/query/release/close authority             | Four connections; bounded waits; stable idle-error signal only                       |
| `lib/scoring.ts`                                                                 | Bounded daily/weekly score and deterministic rank calculation            | Treat all future device input as untrusted and validate before calling               |
| `lib/score-simulator.ts`                                                         | Parses hypothetical input and projects daily/weekly score                | Canonical safe integer and one-to-seven days; delegates to production scoring        |
| `lib/race-types.ts`                                                              | Client-safe participant and demo-profile shape                           | Must not gain raw tokens or source/account identifiers                               |
| `lib/public-origin.ts`                                                           | Strict parser for the canonical social-metadata origin                   | Server-only; hosted origins require HTTPS DNS and no extra URL parts                 |
| `lib/car-recipe.ts`                                                              | Versioned closed-enum renderer and code-native sprites                   | Client-safe type/render data only; no schema runtime or arbitrary content            |
| `lib/car-proposal-service.ts`                                                    | Owns exact-session proposal/read/approve/reject composition              | Generated validation, hashed/cleared proof, server IDs, opaque decision control      |
| `lib/connector-car-proposal-verifier.ts`                                         | Verifies one exact signed device proposal body                           | Strict Ed25519, freshness, dummy-key work, closed recipe, transient bytes            |
| `lib/connector-car-proposal-database.ts`                                         | Maps proposal-only device authority to two fixed Web calls               | Per-checkout probe, active binding, copied/cleared key and nonce material            |
| `lib/connector-car-proposal-http.ts`                                             | Owns the closed device proposal POST boundary                            | Exact path/body/headers, four-call no-queue admission, generic no-store result       |
| `components/car-recipe-preview.tsx`                                              | Server-renders one exact recipe in all three themes                      | Semantic indexed pixels; no client script, inline user style, SVG, file, or URL      |
| `components/pixel-race-canvas.tsx`                                               | Deterministic code-native renderer                                       | Draws fixed primitives only; semantic DOM description is mandatory                   |
| `components/score-simulator.tsx`                                                 | Renders the local-only EN/RU public score simulator                      | Component memory only; no form, name, fetch, storage, log, account, or standing      |
| `components/race-experience.tsx`                                                 | EN/RU race, selectable summary, theme, and motion controls               | Community summary uses closed public fields; storage is non-personal preferences     |
| `proxy.ts`                                                                       | Per-response nonce CSP                                                   | Keep production CSP fail-closed and free of remote origins                           |
| `next.config.ts`                                                                 | Static security headers and build isolation                              | Turbopack must remain pinned to this repository root                                 |

## Public HTTP problem boundary

The common server-only factory requests 16 cryptographic random bytes and returns a frozen opaque
token whose `req_` value cannot be replaced with an inbound correlation string through the typed
API. It owns all eleven `ProblemDetailsV1` status/title/retry mappings, validates the complete body,
and emits `application/problem+json`, `Cache-Control: no-store`, and the matching `x-request-id`. It
emits no CORS header, cookie, detail, exception cause, hostname, SQL, or submitted value.

The local `GET /v1/community/scores`, `GET /v1/community/race`, and `GET /v1/community/race/status`
routes share one closed boundary but hardwire independent response validators and fixed database
calls. Each resolves exact `VIBERACING_PUBLIC_RANKING_ENABLED=true` once at module load. A disabled
GET returns the existing generic 503 before URL/query/`Accept`, admission acquisition, or store
construction; non-GET methods retain 405. Once enabled, each generates one token at entry, rejects a
body and every wrong path or missing/duplicate/unknown/non-canonical query, validates
`CommunityScoreQueryV1`, performs bounded `Accept` negotiation, and acquires one of four no-queue
admission leases before constructing its store. The lease remains held until the adapter promise
settles. The route validates the final page again before JSON serialization and adds `Vary: Accept`
without CORS. Every other Next.js route method receives the closed 405 response and `Allow: GET`;
the stable score and legacy race responses reject the separate status fields.

The additive `GET /v1/community/tokens` route uses the same closed boundary but resolves only exact
`VIBERACING_TOKEN_RANKING_ENABLED=true` at module load. It calls the fixed token projection and
returns only `community_tokens_v1` with direct `weeklyTokenTotal`, shared rank, cosmetic recipe,
rounded freshness, and optional streak. It does not expose a provider, source/day breakdown, exact
receipt time, or legacy score. The browser tries this route first and uses the legacy status route
only when the token surface is unavailable.

The route has no outer `Promise.race` that could return while database work continued. Its deadline
policy is the adapter's enforced two-second connection timeout, six-second query timeout, and
five-second PostgreSQL statement timeout; failed clients are destroyed before admission is released.
Exhausted admission and transient/configuration failures map to 503, while projection or internal
invariant failure maps to a generic 500. The documented 429 remains reserved: no client-rate policy
is claimed. No raw URL/header, SQL, driver error, configuration value, or row value is logged or
reflected.

The generated contract marks all four routes `implemented-local` with one bounded Monday
`seasonStart`, `no-store`, `Vary: Accept`, same-origin/no-CORS semantics, and closed
200/400/406/429/500/503 responses. The legacy race response preserves the ten score fields and may
add one exact current `CarRecipeV1`. The status response separately requires privacy-rounded
`freshnessDays` and may add preference-gated `streakDays`; proposal state, exact receipt time, and
daily score history enter no route. There is no deployment certificate/login, external TLS/edge
route, shared cache, edge rate policy, or representative/deployed query-plan, load, or capacity
result. The local home page loads the status client only after hydration and keeps its synthetic
fallback on every failure.

The opt-in `test:web:postgres-integration` gate builds the emitted standalone artifact, explicitly
bundles Next's otherwise externalized reviewed `pg` driver, and applies the reviewed migration
ledger to a one-off PostgreSQL container. It generates one ephemeral self-signed certificate for an
exact local DNS name, enables PostgreSQL TLS, seeds only obviously synthetic profiles, and invokes
all four GETs through two emitted Next production processes. A login with one extra role membership
must receive only the closed generic 503 on every route while a full private-table fingerprint
remains unchanged. A narrow login with only `viberacing_web` must return the exact score, race,
status, and token contracts, omit hidden/private state, observe TLS 1.2 or 1.3 in `pg_stat_ssl`, and
leave the same fingerprint unchanged. Only that narrow synthetic login receives
superuser-provisioned, database-scoped `auto_explain` settings. Parameter values are disabled; a
two-mebibyte parser budget requires all four fixed adapter calls and all four nested projection
plans, at most 32 root rows, one execution, the reviewed score/race/status indexes, no
mutation/locking node, no sequential scan of the bounded-index relations, and no dirty/written or
temporary block. The bounded plan log is private-marker scanned, discarded, and removed with the
container. The harness then uses a bounded owner-held table lock to hold exactly four observed score
queries, requires a fifth request to return the same closed generic 503 without adding a fifth
public-score query, rolls back the lock, and validates the first four exact 200 responses. It bounds
and discards both Next and blocker output, then removes all ephemeral key material, three processes,
the container, network, and storage. This proves no deployment certificate/login, external TLS/edge
path, cache, edge rate policy, monitoring, representative plan/load/capacity result, real-user data,
or deployment.

## Score database adapter configuration

Only an exactly enabled route can reach the adapter. It is then constructed lazily when a client
reaches an exact score, race, or status request; an invalid or absent database configuration returns
the generic unavailable response and the page keeps its synthetic fallback. Importing or building
the page does not connect. The module-load gate is not a deployed or dynamic switch and proves no
old-instance drain, route/cache denial, or operator audit. The adapter uses only the
`VIBERACING_WEB_DATABASE_*` settings documented in `.env.example`. The separate `DATABASE_*` values
belong to the disposable compose bootstrap owner and are forbidden for Web reads. The repository
creates no reusable working login; the integration harness creates only per-run synthetic logins in
its disposable database.

Local adapter work requires an infrastructure-provisioned login whose only group membership is
`viberacing_web`. Cleartext requires explicit `NODE_ENV=development` or `test` plus loopback. Every
other environment requires `verify-full`, a certificate-valid multi-label DNS name, and TLS 1.2 or
later. The pool checks the effective Web role, narrow login membership/attributes, database
capability, search path, and read-only state before every fixed parameterized score query. No
setting, driver error, SQL, or row value belongs in logs or client responses.

## Invite and initial-passkey enrollment

The `/join` and `/join/passkey` pages plus GitHub start/callback and initial-passkey
options/verification modules each resolve exact `VIBERACING_ENROLLMENT_ENABLED=true` at module
evaluation. Every alternate or unreadable value omits both EN/RU enrollment forms and returns
generic no-store 503 before request parsing, runtime/admission, OAuth/WebAuthn, or database work.
All four production service methods repeat literal-true enforcement before reading enrollment
inputs. Existing active-session redirects, returning passkey login, restricted recovery, logout, and
account security actions remain available. The tracked example is false. This is a local module-load
control, not a dynamic/deployed switch or cleanup mechanism.

`POST /auth/github/start` accepts only an exact same-origin, URL-encoded form of at most 1 KiB. The
invite is one UUID plus a canonical 256-bit secret; the plaintext is immediately reduced to its
SHA-256 digest before a ten-minute encrypted continuation is created. The OAuth authorization uses
an unguessable state, S256 PKCE, an exact callback, and no extra GitHub scope. The callback
exchanges the code under a ten-second deadline, follows no redirect, sends no browser credential,
retains only the positive numeric GitHub ID, and discards the access token and every other response
field.

The callback seals a fresh 15-minute pending-session continuation before the fixed `enroll_profile`
call. That procedure alone atomically consumes the invite, creates the `enrolling` profile, and
stores only the session verifier digest. Initial registration then uses an exact `{}` options
request, a five-minute database-bound challenge, a discoverable credential, required user presence
and verification, attestation `none`, ES256 or RS256, and exact `webauthn.create`, origin, and RP ID
verification. The bounded proof route atomically consumes the challenge, registers the initial
passkey, rotates to a fresh 30-day passkey-bound session, and revokes the pending session. Only that
success returns the encrypted active browser session.

## Returning passkey login

`POST /auth/login/options` creates a five-minute discoverable-credential challenge with required
user verification and no profile identifier or credential allowlist. It stores no database row: the
challenge, server ID, and expiry live only in a separate encrypted HttpOnly cookie. The browser uses
`webauthn.get`, then `POST /auth/login/verify` accepts only one bounded response object, derives the
canonical credential ID, reads only the active key's opaque ID, COSE public key, counter, and backup
flags, and verifies the exact challenge, origin, RP ID, type, signature, and UV result.

Only valid proof reaches revision 0014's fixed call. One transaction creates and immediately
consumes the profile-free challenge, derives the profile from the exact active credential, advances
monotonic usage state, creates a 30-day passkey-provenance session, and returns only profile ID,
handle, and locale for the encrypted session cookie. Replay loses on the challenge ID. If cookie
sealing fails after the database call, the application revokes the just-created session instead of
leaking one of the profile's 32 active-session slots.

All identity POST bodies are read as bounded streams with invalid encoding rejected before
application work. Admission is acquired before the first body read and held through dependency
settlement; rejected or overloaded requests cancel their body without a queue. Cookies are
purpose-keyed AES-256-GCM values with authenticated context, HttpOnly, SameSite=Lax, HTTPS `Secure`,
and the narrowest useful path; duplicate cookie names fail closed. Every response is `no-store` and
`no-referrer`, and each local route admits at most four unsettled operations. The account page uses
the exact possessed session to read at most 32 passkey rows, one closed `public`/`hidden` visibility
value, at most 32 opaque sources, and at most 64 active device credentials through fixed procedures.
The device mapper accepts an exact empty-source sentinel plus bounded labels, platform/version
metadata, and UTC activation dates rounded to a day, so a source remains controllable after its last
device is revoked. It renders source ordinal/state rather than the source ID; internal key/profile
IDs, public keys, and exact lifecycle times never enter HTML. Only the exact opaque device ID enters
its hidden same-origin revoke form. Revocation is terminal, immediately removes that device's future
submission authority, preserves existing season attribution, and remains available while the profile
is hidden. Source actions receive only an encrypted control token bound to the active session for at
most 15 minutes; raw source IDs do not enter HTML or form data. A same-origin form pauses an active
source immediately. Reactivation accepts only a paused source after a fresh required-UV assertion
bound to the session, source, RP ID, and origin, then consumes the challenge and reactivates in one
statement. Both actions remain available while hidden without changing visibility, and neither can
lift quarantine. A separate fresh-passkey action permanently unlinks any active, paused, or
quarantined source, revokes every active source device in the same transaction, and remains
available while hidden without publishing the profile. The passkey mapper requires one current
active authenticator and renders only bounded labels, active/revoked state, UTC creation dates
rounded to a day, and the current marker. Credential IDs, public keys, sign counters, exact activity
timestamps, and profile IDs do not enter HTML. The visibility form is an exact same-origin, bounded
POST backed by the same session verifier. Hiding immediately removes the profile from public score
reads while existing source sync may continue; publishing makes it eligible for public reads again.
Repeating the current state is a no-op. A failed account read shows a generic unavailable message
while logout remains usable; every state-changing operation still requires database verification.

An active non-current passkey has one revoke control. `POST /auth/passkeys/revoke/options` accepts
only its opaque UUID, revalidates the active session and owned inventory, and creates a five-minute
database challenge bound to that session, target, RP, origin, and a sealed continuation. The browser
requests a fresh discoverable assertion with required user verification. The verify route accepts
only that response; after exact RP/origin/challenge/signature/UV verification, one fixed atomic call
consumes the challenge and terminally revokes the target. Current, last, foreign, expired,
malformed, and replayed attempts return the same generic failure. Revocation also closes sessions
and pending pairing authority derived from the target; activated devices remain separately
revocable. Only the authenticated revoke control/request receives the opaque target ID. Credential
IDs, public keys, sign counters, exact activity times, and profile IDs remain server-only.

The add control is available below the 32-retained-record cap. `POST /auth/passkeys/add/options`
accepts and validates only the bounded NFC label before any prompt, creates independent five-minute
assertion and registration challenges, and seals both plus that label. The first ceremony freshly
verifies an existing active credential; the second creates a discoverable user-verified credential
for the same profile. The verify route accepts only those two responses. One fixed statement
atomically consumes the session/profile/label/RP/origin-bound step-up, advances the verifying key's
monotonic state, and inserts the new key. Duplicate credentials, cap races, malformed or mixed
continuations, and replay fail generically. The profile UUID appears only as the authenticated
registration options' pseudonymous WebAuthn user ID required by the authenticator; it is not added
to account HTML or the verify request.

Recovery-code rotation is an account security action, not a recovery login. The account starts one
five-minute required-UV assertion bound to its exact active session, profile, RP ID, and origin.
Only a valid fresh passkey proof generates ten independent selector/secret codes. Web/Auth derives
their Argon2id PHCs sequentially under a recovery-only protected pepper, then one materialized
statement consumes the challenge and replaces every old code and active recovery authority. Only a
successful commit returns the plaintext batch in a no-store response; the page keeps it in memory,
shows it once, and does not log, cache, download, or persist it. The tracked pepper and work-factor
settings are non-working placeholders.

`/recover` is the separate no-passkey path. `POST /auth/recovery/options` accepts only one exact
selector/secret code and bounded NFC replacement label in a 512-byte same-origin JSON body. It
retrieves only that selector's unused PHC and performs one bounded matching or dummy Argon2id
derivation under the recovery pepper for known, wrong, unknown, and malformed admitted attempts. All
admitted failures are generic, share a deployment-configured minimum response floor, and occupy one
of four local no-queue slots. Success seals a purpose-separated five-minute recovery cookie before
atomically consuming and scrubbing the code into restricted authority. The browser clears the code
input before opening the replacement registration ceremony. The verify route accepts only the
bounded registration response, requires exact RP/origin/challenge/context and user verification, and
invokes one atomic replacement-passkey/session call. Only the post-commit minimal profile result can
be sealed as a normal session; a code never signs in directly. No recovery plaintext enters logs,
cache, analytics, download, or browser persistence.

Profile deletion requires the exact typed handle before the browser prompts. The
`POST /auth/profile/delete/options` route revalidates the active passkey-provenance session, creates
one five-minute required-UV assertion challenge, and binds it to that session, profile, handle, RP
ID, and origin. The verify route accepts only the assertion response. Exact application verification
then reaches one statement that consumes the challenge and calls the existing atomic deletion
capability: it hides the profile, revokes browser/passkey/device/recovery authority, unlinks
sources, cancels approved pairing, and queues one opaque deletion job. Only success clears every
local auth cookie and redirects home. This local slice does not execute the queued primary-data
purge itself; revision 0024 and the separate local Jobs command now do so in bounded transactions.
The Web slice still does not schedule that command, clear a future public cache, or prove keyed
tombstone, backup, or restore replay.

The account CarRecipe editor is a separate local session-owned boundary. It submits exactly version
1 plus seven closed enums and a 0-to-65535 seed to `POST /auth/cars/proposals` under a 512-byte
same-origin form limit. `car-proposal-service.ts` revalidates the generated `CarRecipeV1`, hashes
and clears the exact session verifier, creates the proposal ID and maximum-24-hour expiry
server-side, and invokes only the four fixed revision 0025 calls. The account read returns an active
recipe and at most one pending recipe; it seals the pending ID, current session ID, and bounded
expiry in a purpose-separated encrypted control rather than putting the raw proposal ID in HTML.
Explicit approve/reject forms consume that control. PostgreSQL atomically activates and removes the
exact proposal or removes only the rejected proposal.

The account page, browser create route, browser approve route, and device proposal route each
resolve exact `VIBERACING_CAR_PROPOSALS_ENABLED=true` once at module evaluation. Every alternate or
unreadable value cancels mutation before request parsing, runtime/service construction, admission,
proof, or database work; browser service creation and approval repeat literal-true enforcement
before recipe/control/session work. The tracked example is false. Disabled EN/RU account UI still
shows active and private pending recipes, omits the editor and approval form, and preserves only the
exact encrypted session-bound reject action. This is a local module-load control, not a dynamic or
deployed worker/route switch.

Both active and pending recipes are server-rendered as semantic code-native indexed pixels in Neon
Night, Classic Grand Prix, and Cyber Rally. The public animated race uses the same deterministic
recipe rules. Its separate status response may include only the current approved recipe of an active
profile; the browser loads a compact independent exact-shape validator after hydration, and the
generic contract runtime stays outside the initial bundle. Proposal identity, state, and timestamps
remain private, while absence uses the existing repository-owned car. A separate bounded Jobs-only
capability can physically remove expired proposals locally and is included in the separate
default-off local hourly scheduler catalog and combined synthetic PostgreSQL integration. No
deployed cleanup cadence is proven. A separate `POST /v1/connector/cars/proposals` boundary verifies
a proposal-specific exact raw-body signature from an active source-bound device and can only replace
the same pending recipe; it exposes no proposal state or approve/reject/activate capability.
Conversational-agent orchestration now exists only as a checked local Agent Skill that reduces style
intent into the fixed connector command; it creates no additional Web origin or authority.
Distributed edge policy, live credential, monitoring, capacity result, released connector, and
deployment remain absent.

This is not a launch-ready authentication system. There is no invite-issuance UI, passkey profile
mutation beyond the listed controls, aggregate/distributed edge rate policy, cleanup notification
for abandoned recovery/enrollment state, deployed cadence, cache/backup/tombstone purge, restore
replay, live OAuth, authenticator, or production database-login evidence, monitoring, or deployment.
The combined synthetic scheduler/PostgreSQL integration exercises bounded deletion only. The tracked
environment values are non-working placeholders.

## Pairing browser approval

The public `/connect` page contains static EN/RU instructions and an honest warning that no public
connector release exists. The page shell and its separate session-derived inventory may render while
pairing is disabled, but its options and verification routes return generic 503 unless exact
`VIBERACING_PAIRING_ENABLED=true` was resolved when each module loaded. Once enabled, a signed-in,
passkey-registered session may submit exactly one canonical human code to the same-origin options
route. The server derives both bounded key-rotation candidates, and revision 0021 atomically records
the attempt on that session before returning at most one unexpired pending transaction. The
deployment supplies the attempt count and window; the repository publishes no production values.

Only the bounded NFC device label, syntactic connector version, OS, architecture, expiry, and full
SHA-256 public-key fingerprint reach the review screen. Looking up a code does not invoke WebAuthn.
The form explicitly offers a server-generated new source or any active source from the exact
session's bounded inventory. Existing options expose only source ordinal, active device labels, and
an encrypted session-bound control token; raw source IDs remain server-only. A separate user action
requests a required-user-verification assertion bound to the exact session, pairing ID, selected
source ID and choice, RP ID, and origin. One fixed statement consumes that challenge and approves
the pairing atomically after PostgreSQL rechecks source ownership and active state. The raw code and
public key are not stored in a browser cookie, log, cache, local storage, or client state after
lookup.

The `/connect` page plus both approval route modules independently resolve exact
`VIBERACING_SOURCE_CREATION_ENABLED=true` once at module load. Every alternate or unreadable value
removes the new-source radio control, shows a localized availability note, defaults to the first
active existing source, and disables submission when no existing choice is available. The service
then repeats literal-true enforcement before new-source code/challenge work and before completion.
Its purpose-separated five-minute cookie and v2 passkey context digest bind `new` or `existing` to
the exact session, pairing, source, RP, and origin, so disabling a restarted verification module
also closes a previously issued new-source challenge. Existing-source approval remains available
under a disabled source-creation decision. The UI receives only the non-personal boolean and no raw
source identifier.

This is local application and synthetic PostgreSQL evidence. The separate Rust workspace now
provides a native-store connector client and the Web workspace provides start/poll endpoints, but
there is no live authenticator/database/TLS result, trusted edge policy, cross-platform client
result, capacity evidence, monitoring, release, or deployment.

## Pairing start, poll, and activation boundaries

The pairing applications reuse the same environment-owned Web/Auth login settings through the
dedicated `viberacing-web-pairing` pool wrapper with explicit read-write state. They require fresh
canonical 32-byte primary poll and human-code HMAC keys in
`VIBERACING_WEB_PAIRING_POLL_PRIMARY_KEY_BASE64URL` and
`VIBERACING_WEB_PAIRING_CODE_PRIMARY_KEY_BASE64URL`. Each accepts a distinct optional secondary key
only for bounded rotation overlap. All configured values across both namespaces must be pairwise
distinct. The tracked primary values are intentionally invalid. The applications retain decoded keys
only in closeable HMAC capabilities and never return a key container.

An admitted start accepts exactly a canonical nonzero 32-byte candidate Ed25519 public key, a
bounded NFC device label, syntactically bounded SemVer, OS family, and architecture. It generates
the pairing and pending-key UUIDs, a 32-byte poll token and challenge, and a 12-symbol 60-bit human
code, derives separate primary digests, and calls only the fixed `start_pairing` procedure with an
expiry exactly nine minutes after its local clock reading. The success decision returns the poll
token, challenge, code, pairing ID, expiry, and one request ID; after request-ID generation and
admission, every operational non-success returns only `not_created` and that request ID. Malformed
admitted input performs fresh fixed-shape entropy/HMAC work without writing to the database. Strict
point and possession checks remain in the later proof/activation boundary.

An admitted activation accepts exactly `pollToken` and `possessionSignature`, derives two
fixed-shape HMAC-SHA-256 candidates, probes the effective Web role/login/search-path/read-write
state, and uses fixed queries to select at most one unexpired approved or activated transaction. For
every structurally valid lookup outcome, the high-level adapter runs the strict possession verifier
before either returning an existing binding or calling exact SQL activation with a generated `dev_`
ID, audit UUID, and common `req_` ID. The SQL procedure atomically rechecks expiry, approval,
pending-key, profile, and source binding. Four in-flight leases held through a 250-millisecond floor
bound steady-state local work to at most 16 minimum-path completions per second; short windows may
still be bursty, and every non-success returns only `not_activated` plus the request ID.

The two exact POST routes and the two browser approval routes each resolve exact
`VIBERACING_PAIRING_ENABLED=true` once at module load. Every alternate or unreadable state cancels
an available request body and returns the existing generic 503 before parsing, runtime/service
construction, admission acquisition, protected configuration, or database work. Connector non-POST
methods retain 405. Once enabled, start/poll validate the generated request contracts before lazily
constructing one shared service. That service owns one pool, poll/code verifier set, rate policy,
and aggregate four-call admission boundary. The HTTP layer caps requests at 1024 bytes and responses
at 2048 bytes, rejects queries, duplicate decoded keys, unknown/nested fields, content encoding,
unsupported media/Accept values, and noncanonical client IDs, and emits only revalidated success or
generic problem bodies with `no-store`, no referrer, and no CORS headers. The module gate is neither
a dynamic nor deployed switch. The separate source-creation gate above does not affect connector
start or poll because those operations create only pending device state.

Every accepted request increments one operation-global and one of 64 client buckets through the
fixed revision 0022 PostgreSQL function before start/activation work. The raw 16-byte client ID and
its SHA-256 digest are never stored; only 130 preallocated operation/bucket windows exist. Mandatory
deployment-private limits cover start/poll global, bucket, and window values. This is a distributed
service-instance control, not strong client identity or a trusted edge/IP capacity perimeter. There
is still no production login/TLS connection, capacity evidence, monitoring, deployed cadence, or
deployment. The combined synthetic scheduler/PostgreSQL integration exercises the retention reset;
the synthetic home page and build do not construct the service.

## Public client data contract

The validated Community page may receive only public handles plus bounded weekly score, rank,
active-day count, source count, season metadata, and an optional exact active `CarRecipeV1`. The UI
derives an opaque presentation ID and uses a fixed repository-owned visual-marker car when that
recipe is absent; it receives no proposal state, Community daily detail, or device count. The
optional page query contains one already-public canonical handle only; it is neither sent to the
race API nor persisted in browser storage.

The synthetic fallback may additionally receive only:

- opaque synthetic participant IDs and handles;
- bounded weekly score, rank, active-day count, streak display, and freshness;
- the synthetic demo profile's bounded daily scores;
- aggregate source/device counts;
- a validated enum-only `CarRecipe`.

The browser payload must not contain raw token buckets, source IDs, Codex account IDs, email,
provider credentials, access tokens, prompts, conversation data, repository data, local paths,
internal abuse signals, or arbitrary URLs. Tests recursively inspect the current payload for these
classes. Future production DTOs require runtime schema validation and the same negative assertions.

Multiple Codex accounts are represented as separate approved sources under one profile in the
planned product. Their activity may be summed only after source-bound authorization, with a single
profile daily/weekly cap and same-source device deduplication. The prototype demonstrates the
aggregate source count; it does not pair or verify accounts.

## Security and privacy behavior

- Every ranking surface says Community/self-reported and explicitly disclaims OpenAI verification.
- Verified mode is disabled; scores confer no prize, privilege, or authorization.
- Exact activity is projected to bounded scores before client serialization.
- CSP uses a fresh cryptographic nonce for each navigation and `strict-dynamic` in production.
- Framing, MIME sniffing, unnecessary browser capabilities, referrer leakage, and remote image
  sources are denied by policy. WebAuthn creation remains same-origin for initial enrollment, and
  `publickey-credentials-get` is enabled only for same-origin returning login.
- `form-action` permits only self and the exact `https://github.com` OAuth navigation so browsers
  may follow the reviewed authorization redirect; GitHub is not added to script, connect, image,
  frame, font, worker, or media sources.
- Locale, theme, and motion are the only persistent browser-storage keys. Account state uses only
  encrypted HttpOnly cookies; rendering still works when local storage is blocked.
- There are no trackers, analytics calls, remote fonts, or remote images. The synthetic race needs
  no runtime secret. Enrollment reads only its exact server-side OAuth/cookie/RP settings when an
  auth route or authenticated page is reached; the score and pairing adapters likewise construct
  their dedicated server boundaries lazily.
- The pure pairing kernel accepts only one exact plain-object material tuple, copies the fixed
  challenge/public-key bytes, reconstructs the versioned message, and uses strict Ed25519 semantics.
  It returns only a generic boolean. The separate activation application owns protected poll lookup,
  fixed database calls, proof-before-activation ordering, local admission/timing, and generic
  decisions. The local start/poll routes expose only their bounded aggregate service; neither
  transport-free application has browser authority or accepts client-owned activation identifiers.
- Product rendering uses local HTML/CSS/canvas code. The social preview is a documented,
  metadata-sanitized project-generated PNG; no remote visual source is loaded. The optional Next.js
  `sharp` graph is removed while image optimization is unused. A `never`-typed declaration covers
  Next.js's type-only reference, while lint policy forbids importing the absent runtime.

These controls reduce current risk; they do not make Community claims authoritative or replace the
remaining Phase 2 pairing controls, recovery perimeter/cleanup, ingestion, retention,
deletion-purge, and edge abuse-control gates.

## Test strategy

Vitest runs business-logic, data-boundary, HTTP-route/problem, admission, pairing cryptography and
activation composition, invite/OAuth/session/passkey enrollment, returning login and inventory,
database-config/pool/store, component, interaction, CSP/header, localization, and axe-core
accessibility tests. Enrollment cases cover exact form/JSON bodies, streaming limits, origin and
cookie ambiguity, state plus PKCE, no-extra-scope token exchange, encrypted purpose separation,
fixed SQL, one-time challenge binding, exact RP/origin/type and UV verification,
continuation-before-write ordering, profile-free database-state-free login options, atomic login
completion, exact-handle deletion binding, atomic challenge-consume/delete settlement, cookie
clearing, exact recovery-code parsing, matching and dummy Argon2id work, generic response timing,
restricted-authority replacement registration, failed-WebAuthn write denial, closed source/device
inventory, encrypted session-bound source targeting, hidden-profile
pause/reactivation/unlink/revoke, cross-session and replay denial, overload, logout, EN/RU
rendering, native ceremonies, and generic failures without a live account or credential. Other
HTTP-boundary cases cover entropy, opaque tokens, every problem mapping, closed URL parsing, bounded
media negotiation, overload settlement, headers, contract validation, hostile reflective inputs, and
non-reflection. Adapter tests cover TLS/environment bounds, non-reflective failures, pool lifecycle,
every-checkout role/login/search-path/read-only probes, fixed SQL parameters, release/destruction
behavior, and mapper integration without requiring or claiming a live deployment login. Pairing
cases additionally cover exact HMAC derivation and rotation, protected configuration, fixed
two-candidate SQL, read-write role probes, the shared strict proof, hostile input/result/dependency
shapes, server IDs, admission/timing, generic failures, clearing, release, and close without a real
key or connection. Canvas tests execute real render loops against a typed context stub, including
animated and no-context paths. Visible-score tests cover current-week selection, the exact
credential-free token-first/legacy-fallback fetch, closed public response mapping, freshness/streak
presentation and bounds, legacy-component rejection, success/fallback states, and empty standings.
Preference tests cover valid settings, reduced motion, pausing, invalid/blocked storage, and
cleanup.

The separate Docker-backed Web integration exercises the otherwise-thin framework entrypoints with
real loopback HTTP and the actual `pg` adapter. It validates all four closed contracts, the
every-checkout least-privilege probe, widened-login fail-closed behavior, hidden/private omission,
eight bounded adapter/nested-projection plan oracles, four-slot no-queue admission, and complete
private-table non-mutation. It remains synthetic local evidence, not representative load, live,
capacity, or deployed behavior.

Coverage thresholds apply to product components and libraries. Small framework entrypoints are
excluded from unit coverage and exercised by `next build`; counting imports as unit coverage would
not prove their framework integration. Local responsive, contrast, interaction, runtime-header,
artifact-budget, and exact stored viewport evidence is recorded in
`docs/testing/PHASE1_BROWSER_MATRIX.md`. The stored bytes are protected by an offline integrity gate
and the explicit local exact-product re-render performs a zero-tolerance decoded-pixel diff.
Browser-binary provenance/CI provisioning, native screen-reader and cross-browser passes, and field
Core Web Vitals remain open and are listed honestly in `docs/IMPLEMENTATION_STATUS.md`.

## Change checklist

1. Preserve the explicit synthetic fallback and public-only Community boundary; update EN/RU strings
   together.
2. Add negative tests for every new input, persistence key, URL, or serialization field.
3. Test keyboard and reduced-motion behavior for visible interaction changes.
4. Keep visual assets local; sanitize binary metadata and document provenance before staging them.
5. Run the focused Web checks and `pnpm run verify`, then inspect and scan the exact staged snapshot
   as documented in the root `AGENTS.md`. Add `pnpm run verify:release` only at its explicit release
   or broad cross-cutting boundary.
