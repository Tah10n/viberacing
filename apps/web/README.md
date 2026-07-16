# Vibe Racing web prototype

This workspace is the Phase 1 product shell: a responsive pixel-art race, Community leaderboard, and
demo profile with committed synthetic fallback data. It is suitable for local design, accessibility,
localization, and scoring review. The visible race and leaderboard now request the current
server-selected Community week from the exact same-origin public score route, validate the bounded
response in the browser, and retain the labeled synthetic fallback on any failure. The demo garage
and default product shell remain synthetic and unauthenticated, with no working database login,
pairing approval/HTTP route, real user data, or deployment. A separate local Phase 2 slice now
implements invite redemption, GitHub OAuth state plus PKCE, encrypted HttpOnly continuations,
initial passkey registration, returning login, a session-scoped passkey inventory, an account page,
public-profile hide/show, source inventory/pause/reactivation, active-device revoke, fresh
backup-passkey addition, revocation of an owned non-current passkey, an exact-handle fresh-passkey
profile-deletion request, and logout. It fails closed without externally provisioned configuration
and has no live-user or deployment evidence.

## Run it

From the repository root:

```text
pnpm install --frozen-lockfile --ignore-scripts
pnpm run dev:web
```

The development command binds Next.js to the `localhost` loopback hostname so local WebAuthn uses
its standards-defined development origin without exposing the server to the LAN. No `.env` file is
needed for the synthetic race. The optional server-only `VIBERACING_PUBLIC_ORIGIN` setting controls
absolute social metadata and is mandatory for a hosted deployment; it is public configuration, not a
secret. Focused checks are available as `pnpm run lint:web`, `pnpm run typecheck:web`,
`pnpm run test:web:coverage`, and `pnpm run build:web`; `pnpm run check:web-build` validates the
built artifact, and the root `pnpm run verify` runs all of them.

To exercise enrollment manually, use an ignored environment with `/auth/github/callback` on the
configured `localhost` origin as the exact OAuth callback, a dedicated GitHub OAuth app, a fresh
canonical 32-byte `SESSION_SECRET`, matching `VIBERACING_PUBLIC_ORIGIN`/`WEBAUTHN_ORIGIN` and
hostname `WEBAUTHN_RP_ID`, and a separately provisioned `viberacing_web` login. The repository
provides no valid invite or working credential. See `.env.example` and the local-development guide.

## Module map

| Path                                               | Responsibility                                                   | Trust boundary                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `app/page.tsx`                                     | Selects the current week and builds the synthetic fallback       | Must pass only public labels and presentation data into the client tree            |
| `lib/race-data.ts`                                 | Clearly synthetic raw activity fixtures and payload projection   | Marked `server-only`; never replace with exports or real account data              |
| `lib/public-community-race.ts`                     | Loads and maps the current public score page for visible racing  | Exact same-origin GET; no credentials/cache; closed fields and synthetic fallback  |
| `lib/public-community-score-mapper.ts`             | Validates and maps the exact SQL score projection                | Server-only, exact allowlist, top-32, and fail-closed                              |
| `lib/public-community-score-store.ts`              | Executes the fixed public-score procedure and mapper             | Canonical Monday only; verifies every checkout; route constructs it lazily         |
| `lib/public-community-score-route.ts`              | Parses and serializes the public score HTTP boundary             | Closed query/Accept, exact errors, admission, deadlines, and no CORS               |
| `lib/public-score-admission.ts`                    | Enforces the no-queue public-read concurrency ceiling            | Four active reads; lease held until adapter settlement                             |
| `lib/public-http-problem.ts`                       | Generates opaque request IDs and closed public error responses   | Server-only; validates the contract; no inbound ID, CORS, detail, or cause         |
| `app/join`, `app/login`, `app/account`, `app/auth` | Routes enrollment, account controls, deletion, and logout        | Thin entrypoints; no recovery, pairing approval, or admin                          |
| `components/account-experience.tsx`                | Renders visibility, devices, passkeys, deletion, and logout      | Closed state and opaque targets; no key/profile ID or exact time                   |
| `lib/enrollment-http.ts`                           | Owns the eighteen local identity HTTP decisions                  | Exact origin/content/body/cookie policy, no-store, no-referrer, and no queue       |
| `lib/enrollment-service.ts`                        | Composes OAuth, login, sources, devices, passkeys, and deletion  | Server IDs/secrets only; fixed database capabilities; generic failure              |
| `lib/enrollment-cookie.ts`                         | Seals login, OAuth, passkey, and session continuations           | AES-GCM with purpose-separated keys, bounded expiry, HttpOnly, and narrow paths    |
| `lib/github-oauth.ts`                              | Resolves one GitHub numeric user ID                              | State plus PKCE, no extra scope, fixed endpoints, token and other fields discarded |
| `lib/passkey-registration.ts`                      | Creates and verifies registration and login ceremonies           | Exact RP/origin/type, required UV, fixed algorithms, and bounded output            |
| `lib/enrollment-database.ts`                       | Owns fixed identity database operations                          | Reuses the probed Web/Auth pool; no general query or reflected database detail     |
| `lib/pairing-possession-verifier.ts`               | Strictly verifies one approved pending-device proof              | Server-only pure kernel; no poll lookup, activation, HTTP, rate, or persistence    |
| `lib/pairing-poll-verifier.ts`                     | Derives fixed poll-verifier candidates under protected keys      | Primary plus optional secondary; no raw key container; close clears key copies     |
| `lib/pairing-user-code-verifier.ts`                | Derives fixed human-code verifier candidates under separate keys | Primary plus optional secondary; cross-purpose key reuse is rejected               |
| `lib/pairing-start-material.ts`                    | Generates bounded pending-transaction material                   | Server IDs, 32-byte token/challenge, 60-bit code, and nine-minute expiry           |
| `lib/pairing-start-database.ts`                    | Owns exact pending-pairing creation                              | Closed metadata and generated fields only; destructive release on failure          |
| `lib/pairing-start-application.ts`                 | Composes dormant transport-free start policy                     | Four admitted calls, 250 ms floor, generic failure, no HTTP or approval authority  |
| `lib/pairing-activation-database.ts`               | Owns approved lookup, strict proof, and exact activation         | Fixed procedures only; server IDs only; destructive release on boundary failure    |
| `lib/pairing-activation-application.ts`            | Composes dormant transport-free activation policy                | Four admitted calls, 250 ms floor, generic failure, no HTTP or browser authority   |
| `lib/pairing-database-config.ts`                   | Derives a separate read-write pool from the Web/Auth login       | Same strict TLS/deadlines; explicit role/search-path/read-write probe              |
| `lib/pairing-database-pool.ts`                     | Wraps `pg` with fixed pairing start/lookup/activation calls      | No generic query; copies/clears byte parameters; stable idle-error signal          |
| `lib/public-score-database-config.ts`              | Parses the dedicated Web login and TLS/pool contract             | Owner settings are separate; production is verify-full; errors reflect no value    |
| `lib/public-score-database-pool.ts`                | Wraps `pg` with narrow connect/query/release/close authority     | Four connections; bounded waits; stable idle-error signal only                     |
| `lib/scoring.ts`                                   | Bounded daily/weekly score and deterministic rank calculation    | Treat all future device input as untrusted and validate before calling             |
| `lib/race-types.ts`                                | Client-safe participant and demo-profile shape                   | Must not gain raw tokens or source/account identifiers                             |
| `lib/public-origin.ts`                             | Strict parser for the canonical social-metadata origin           | Server-only; hosted origins require HTTPS DNS and no extra URL parts               |
| `lib/car-recipe.ts`                                | Closed-enum car customization and fixed sprites                  | No arbitrary colors, markup, text, files, SVG, or URLs                             |
| `components/pixel-race-canvas.tsx`                 | Deterministic code-native renderer                               | Draws fixed primitives only; semantic DOM description is mandatory                 |
| `components/race-experience.tsx`                   | EN/RU interaction, table, profile, theme, and motion controls    | Local storage is restricted to non-personal preferences                            |
| `proxy.ts`                                         | Per-response nonce CSP                                           | Keep production CSP fail-closed and free of remote origins                         |
| `next.config.ts`                                   | Static security headers and build isolation                      | Turbopack must remain pinned to this repository root                               |

## Public HTTP problem boundary

The common server-only factory requests 16 cryptographic random bytes and returns a frozen opaque
token whose `req_` value cannot be replaced with an inbound correlation string through the typed
API. It owns all eleven `ProblemDetailsV1` status/title/retry mappings, validates the complete body,
and emits `application/problem+json`, `Cache-Control: no-store`, and the matching `x-request-id`. It
emits no CORS header, cookie, detail, exception cause, hostname, SQL, or submitted value.

The local `GET /v1/community/scores` route generates one token at entry, rejects a body and every
missing/duplicate/unknown/non-canonical query, validates `CommunityScoreQueryV1`, performs bounded
`Accept` negotiation, and acquires one of four no-queue admission leases before constructing the
store. It holds the lease until the adapter promise settles, validates the final page again before
JSON serialization, and adds `Vary: Accept` without CORS. Every other Next.js route method receives
the closed 405 response and `Allow: GET`.

The route has no outer `Promise.race` that could return while database work continued. Its deadline
policy is the adapter's enforced two-second connection timeout, six-second query timeout, and
five-second PostgreSQL statement timeout; failed clients are destroyed before admission is released.
Exhausted admission and transient/configuration failures map to 503, while projection or internal
invariant failure maps to a generic 500. The documented 429 remains reserved: no client-rate policy
is claimed. No raw URL/header, SQL, driver error, configuration value, or row value is logged or
reflected.

The generated contract marks the route `implemented-local` with one bounded Monday `seasonStart`,
`no-store`, `Vary: Accept`, same-origin/no-CORS semantics, and closed 200/400/406/429/500/503
responses. There is no deployment, live login/certificate evidence, shared cache, edge rate policy,
or deployed consumer; the local home page consumer keeps its synthetic fallback on every failure.

## Score database adapter configuration

The adapter is constructed lazily only when the visible client reaches the exact score route; an
invalid or absent configuration returns the generic unavailable response and the page keeps its
synthetic fallback. Importing or building the page does not connect. The adapter uses only the
`VIBERACING_WEB_DATABASE_*` settings documented in `.env.example`. The separate `DATABASE_*` values
belong to the disposable compose bootstrap owner and are forbidden for Web reads. The repository
intentionally creates no working login.

Local adapter work requires an infrastructure-provisioned login whose only group membership is
`viberacing_web`. Cleartext requires explicit `NODE_ENV=development` or `test` plus loopback. Every
other environment requires `verify-full`, a certificate-valid multi-label DNS name, and TLS 1.2 or
later. The pool checks the effective Web role, narrow login membership/attributes, database
capability, search path, and read-only state before every fixed parameterized score query. No
setting, driver error, SQL, or row value belongs in logs or client responses.

## Invite and initial-passkey enrollment

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
lift quarantine. The passkey mapper requires one current active authenticator and renders only
bounded labels, active/revoked state, UTC creation dates rounded to a day, and the current marker.
Credential IDs, public keys, sign counters, exact activity timestamps, and profile IDs do not enter
HTML. The visibility form is an exact same-origin, bounded POST backed by the same session verifier.
Hiding immediately removes the profile from public score reads while existing source sync may
continue; publishing makes it eligible for public reads again. Repeating the current state is a
no-op. A failed account read shows a generic unavailable message while logout remains usable; every
state-changing operation still requires database verification.

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

The add control is available below the 32-record lifetime cap. `POST /auth/passkeys/add/options`
accepts and validates only the bounded NFC label before any prompt, creates independent five-minute
assertion and registration challenges, and seals both plus that label. The first ceremony freshly
verifies an existing active credential; the second creates a discoverable user-verified credential
for the same profile. The verify route accepts only those two responses. One fixed statement
atomically consumes the session/profile/label/RP/origin-bound step-up, advances the verifying key's
monotonic state, and inserts the new key. Duplicate credentials, cap races, malformed or mixed
continuations, and replay fail generically. The profile UUID appears only as the authenticated
registration options' pseudonymous WebAuthn user ID required by the authenticator; it is not added
to account HTML or the verify request.

Profile deletion requires the exact typed handle before the browser prompts. The
`POST /auth/profile/delete/options` route revalidates the active passkey-provenance session, creates
one five-minute required-UV assertion challenge, and binds it to that session, profile, handle, RP
ID, and origin. The verify route accepts only the assertion response. Exact application verification
then reaches one statement that consumes the challenge and calls the existing atomic deletion
capability: it hides the profile, revokes browser/passkey/device/recovery authority, unlinks
sources, cancels approved pairing, and queues one opaque deletion job. Only success clears every
local auth cookie and redirects home. This local slice does not execute the queued primary-data
purge, clear a future public cache, or prove backup restore replay.

This is not a launch-ready authentication system. There is no invite-issuance UI, recovery, passkey
profile mutation beyond the listed controls, aggregate/distributed edge rate policy, cleanup for
abandoned enrollment state, deletion purge worker, live OAuth/authenticator/database-login evidence,
monitoring, or deployment. The tracked environment values are non-working placeholders.

## Pairing start and activation boundaries

The dormant pairing applications reuse the same environment-owned Web/Auth login settings through
the dedicated `viberacing-web-pairing` pool wrapper with explicit read-write state. They require
fresh canonical 32-byte primary poll and human-code HMAC keys in
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
state, and uses one fixed query to select at most one approved unexpired transaction. For every
structurally valid lookup outcome, the high-level adapter runs the strict possession verifier and
alone calls exact SQL activation with a generated `dev_` ID, audit UUID, and common `req_` ID. The
SQL procedure atomically rechecks expiry, approval, pending-key, profile, and source binding. Four
in-flight leases held through a 250-millisecond floor bound steady-state local work to at most 16
minimum-path completions per second; short windows may still be bursty, and every non-success
returns only `not_activated` plus the request ID.

Each application uses four in-flight leases held through a 250-millisecond floor. These are not HTTP
endpoints or complete abuse controls. There is no pairing browser approval composed with the
enrollment session and a fresh WebAuthn assertion, connector client, body/header parser or response
schema, distributed client rate limit, live login/TLS connection, capacity evidence, monitoring,
cleanup schedule, or deployment. The synthetic page and build do not construct either application.
Their configured factories own independent admission counters and pool instances; a future host that
composes both must enforce and verify one aggregate CPU, connection, and anonymous-attempt budget.

## Public client data contract

The browser may receive only:

- opaque synthetic participant IDs and public handles;
- bounded weekly score, rank, active-day count, streak display, and freshness for leaderboard rows;
- the selected public profile's bounded daily scores;
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
  It returns only a generic boolean. The separate dormant application owns protected poll lookup,
  fixed database calls, proof-before-activation ordering, local admission/timing, and generic
  decisions; neither boundary has a route, log, client identity, or browser authority.
- Product rendering uses local HTML/CSS/canvas code. The social preview is a documented,
  metadata-sanitized project-generated PNG; no remote visual source is loaded. The optional Next.js
  `sharp` graph is removed while image optimization is unused. A `never`-typed declaration covers
  Next.js's type-only reference, while lint policy forbids importing the absent runtime.

These controls reduce current risk; they do not make Community claims authoritative or replace the
remaining Phase 2 recovery, source unlink and pairing controls, ingestion, retention,
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
clearing, closed source/device inventory, encrypted session-bound source targeting, hidden-profile
pause/reactivation/revoke, cross-session and replay denial, overload, logout, EN/RU rendering,
native ceremonies, and generic failures without a live account or credential. Other HTTP-boundary
cases cover entropy, opaque tokens, every problem mapping, closed URL parsing, bounded media
negotiation, overload settlement, headers, contract validation, hostile reflective inputs, and
non-reflection. Adapter tests cover TLS/environment bounds, non-reflective failures, pool lifecycle,
every-checkout role/login/search-path/read-only probes, fixed SQL parameters, release/destruction
behavior, and mapper integration without requiring or claiming a live deployment login. Pairing
cases additionally cover exact HMAC derivation and rotation, protected configuration, fixed
two-candidate SQL, read-write role probes, the shared strict proof, hostile input/result/dependency
shapes, server IDs, admission/timing, generic failures, clearing, release, and close without a real
key or connection. Canvas tests execute real render loops against a typed context stub, including
animated and no-context paths. Visible-score tests cover current-week selection, exact
credential-free fetch, closed public response mapping, success/fallback states, and empty standings.
Preference tests cover valid settings, reduced motion, pausing, invalid/blocked storage, and
cleanup.

Coverage thresholds apply to product components and libraries. Small framework entrypoints are
excluded from unit coverage and exercised by `next build`; counting imports as unit coverage would
not prove their framework integration. Local responsive, contrast, interaction, runtime-header, and
artifact-budget evidence is recorded in `docs/testing/PHASE1_BROWSER_MATRIX.md`. Stored visual
baselines, keyboard/screen-reader and cross-browser passes, and runtime Core Web Vitals remain open
and are listed honestly in `docs/IMPLEMENTATION_STATUS.md`.

## Change checklist

1. Preserve the explicit synthetic fallback and public-only Community boundary; update EN/RU strings
   together.
2. Add negative tests for every new input, persistence key, URL, or serialization field.
3. Test keyboard and reduced-motion behavior for visible interaction changes.
4. Keep visual assets local; sanitize binary metadata and document provenance before staging them.
5. Run `pnpm run verify`, then inspect and scan the exact staged snapshot as documented in the root
   `AGENTS.md`.
