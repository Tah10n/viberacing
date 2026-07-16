# Vibe Racing web prototype

This workspace is the Phase 1 product shell: a responsive pixel-art race, Community leaderboard, and
demo profile built entirely from committed synthetic fixtures. It is suitable for local design,
accessibility, localization, and scoring review. It is not an authenticated product and does not
read Codex or user accounts. Server-only score database, public problem-response, local score route,
pure pairing-possession verification, and dormant poll-verifier/database/activation composition
modules now exist, but no visible component calls those boundaries and no working database login,
pairing start/approval/HTTP route, or deployment is supplied; the synthetic prototype still does not
query a database.

## Run it

From the repository root:

```text
pnpm install --frozen-lockfile --ignore-scripts
pnpm run dev:web
```

The development command binds Next.js to `127.0.0.1`. No `.env` file is needed. The optional
server-only `VIBERACING_PUBLIC_ORIGIN` setting controls absolute social metadata and is mandatory
for a hosted deployment; it is public configuration, not a secret. Focused checks are available as
`pnpm run lint:web`, `pnpm run typecheck:web`, `pnpm run test:web:coverage`, and
`pnpm run build:web`; `pnpm run check:web-build` validates the built artifact, and the root
`pnpm run verify` runs all of them.

## Module map

| Path                                    | Responsibility                                                 | Trust boundary                                                                   |
| --------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `app/page.tsx`                          | Builds the synthetic public payload on the server              | Must pass only public presentation data into the client tree                     |
| `lib/race-data.ts`                      | Clearly synthetic raw activity fixtures and payload projection | Marked `server-only`; never replace with exports or real account data            |
| `lib/public-community-score-mapper.ts`  | Validates and maps the exact SQL score projection              | Server-only, exact allowlist, top-32, and fail-closed                            |
| `lib/public-community-score-store.ts`   | Executes the fixed public-score procedure and mapper           | Canonical Monday only; verifies every checkout; route constructs it lazily       |
| `lib/public-community-score-route.ts`   | Parses and serializes the public score HTTP boundary           | Closed query/Accept, exact errors, admission, deadlines, and no CORS             |
| `lib/public-score-admission.ts`         | Enforces the no-queue public-read concurrency ceiling          | Four active reads; lease held until adapter settlement                           |
| `lib/public-http-problem.ts`            | Generates opaque request IDs and closed public error responses | Server-only; validates the contract; no inbound ID, CORS, detail, or cause       |
| `lib/pairing-possession-verifier.ts`    | Strictly verifies one approved pending-device proof            | Server-only pure kernel; no poll lookup, activation, HTTP, rate, or persistence  |
| `lib/pairing-poll-verifier.ts`          | Derives fixed poll-verifier candidates under protected keys    | Primary plus optional secondary; no raw key container; close clears key copies   |
| `lib/pairing-activation-database.ts`    | Owns approved lookup, strict proof, and exact activation       | Fixed procedures only; server IDs only; destructive release on boundary failure  |
| `lib/pairing-activation-application.ts` | Composes dormant transport-free activation policy              | Four admitted calls, 250 ms floor, generic failure, no HTTP or browser authority |
| `lib/pairing-database-config.ts`        | Derives a separate read-write pool from the Web/Auth login     | Same strict TLS/deadlines; explicit role/search-path/read-write probe            |
| `lib/pairing-database-pool.ts`          | Wraps `pg` with fixed pairing lookup/activation calls          | No generic query; copies/clears verifier parameters; stable idle-error signal    |
| `lib/public-score-database-config.ts`   | Parses the dedicated Web login and TLS/pool contract           | Owner settings are separate; production is verify-full; errors reflect no value  |
| `lib/public-score-database-pool.ts`     | Wraps `pg` with narrow connect/query/release/close authority   | Four connections; bounded waits; stable idle-error signal only                   |
| `lib/scoring.ts`                        | Bounded daily/weekly score and deterministic rank calculation  | Treat all future device input as untrusted and validate before calling           |
| `lib/race-types.ts`                     | Client-safe participant and demo-profile shape                 | Must not gain raw tokens or source/account identifiers                           |
| `lib/public-origin.ts`                  | Strict parser for the canonical social-metadata origin         | Server-only; hosted origins require HTTPS DNS and no extra URL parts             |
| `lib/car-recipe.ts`                     | Closed-enum car customization and fixed sprites                | No arbitrary colors, markup, text, files, SVG, or URLs                           |
| `components/pixel-race-canvas.tsx`      | Deterministic code-native renderer                             | Draws fixed primitives only; semantic DOM description is mandatory               |
| `components/race-experience.tsx`        | EN/RU interaction, table, profile, theme, and motion controls  | Local storage is restricted to non-personal preferences                          |
| `proxy.ts`                              | Per-response nonce CSP                                         | Keep production CSP fail-closed and free of remote origins                       |
| `next.config.ts`                        | Static security headers and build isolation                    | Turbopack must remain pinned to this repository root                             |

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
or visible-page consumer.

## Score database adapter configuration

The adapter is constructed explicitly; importing or running the synthetic page does not connect. It
uses only the `VIBERACING_WEB_DATABASE_*` settings documented in `.env.example`. The separate
`DATABASE_*` values belong to the disposable compose bootstrap owner and are forbidden for Web
reads. The repository intentionally creates no working login.

Local adapter work requires an infrastructure-provisioned login whose only group membership is
`viberacing_web`. Cleartext requires explicit `NODE_ENV=development` or `test` plus loopback. Every
other environment requires `verify-full`, a certificate-valid multi-label DNS name, and TLS 1.2 or
later. The pool checks the effective Web role, narrow login membership/attributes, database
capability, search path, and read-only state before every fixed parameterized score query. No
setting, driver error, SQL, or row value belongs in logs or client responses.

## Pairing activation boundary

The dormant pairing application reuses the same environment-owned Web/Auth login settings through a
separate `viberacing-web-pairing` pool with explicit read-write state. It additionally requires a
fresh canonical 32-byte `VIBERACING_WEB_PAIRING_POLL_PRIMARY_KEY_BASE64URL` and accepts a distinct
optional `VIBERACING_WEB_PAIRING_POLL_SECONDARY_KEY_BASE64URL` only for a bounded rotation overlap.
The tracked primary value is intentionally invalid. The application retains decoded keys only in a
closeable HMAC capability and never returns a key container.

An admitted attempt accepts exactly `pollToken` and `possessionSignature`, derives two fixed-shape
HMAC-SHA-256 candidates, probes the effective Web role/login/search-path/read-write state, and uses
one fixed query to select at most one approved unexpired transaction. For every structurally valid
lookup outcome, the high-level adapter runs the strict possession verifier and alone calls exact SQL
activation with a generated `dev_` ID, audit UUID, and common `req_` ID. The SQL procedure
atomically rechecks expiry, approval, pending-key, profile, and source binding. Four in-flight
leases held through a 250-millisecond floor bound steady-state local work to at most 16 minimum-path
completions per second; short windows may still be bursty, and every non-success returns only
`not_activated` plus the request ID.

This is not an HTTP endpoint or complete abuse control. There is no pairing start, browser/session
or WebAuthn approval, connector client, body/header parser, distributed client rate limit, live
login/TLS connection, capacity evidence, monitoring, or deployment. The synthetic page and build do
not construct the application.

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
  sources are denied by policy. WebAuthn browser capability remains disabled until authentication
  exists and receives a dedicated review.
- Locale, theme, and motion are the only persistent browser keys. Rendering still works when storage
  is blocked.
- There are no trackers, analytics calls, remote fonts, remote images, cookies, accounts, or runtime
  secrets in the visible prototype. Its only consumed environment setting is an optional public
  metadata origin; a malformed value fails the build. The dormant score adapter reads its dedicated
  server settings only when explicitly constructed.
- The pure pairing kernel accepts only one exact plain-object material tuple, copies the fixed
  challenge/public-key bytes, reconstructs the versioned message, and uses strict Ed25519 semantics.
  It returns only a generic boolean. The separate dormant application owns protected poll lookup,
  fixed database calls, proof-before-activation ordering, local admission/timing, and generic
  decisions; neither boundary has a route, log, client identity, or browser authority.
- Product rendering uses local HTML/CSS/canvas code. The social preview is a documented,
  metadata-sanitized project-generated PNG; no remote visual source is loaded. The optional Next.js
  `sharp` graph is removed while image optimization is unused. A `never`-typed declaration covers
  Next.js's type-only reference, while lint policy forbids importing the absent runtime.

These controls reduce current risk; they do not make Community claims authoritative and do not
replace the Phase 2 authentication, ingestion, retention, deletion, and abuse-control gates.

## Test strategy

Vitest runs business-logic, data-boundary, HTTP-route/problem, admission, pairing cryptography and
activation composition, database-config/pool/store, component, interaction, CSP/header,
localization, and axe-core accessibility tests. HTTP-boundary cases cover entropy, opaque tokens,
every problem mapping, closed URL parsing, bounded media negotiation, overload settlement, headers,
contract validation, hostile reflective inputs, and non-reflection. Adapter tests cover
TLS/environment bounds, non-reflective failures, pool lifecycle, every-checkout
role/login/search-path/read-only probes, fixed SQL parameters, release/destruction behavior, and
mapper integration without requiring or claiming a live deployment login. Pairing cases additionally
cover exact HMAC derivation and rotation, protected configuration, fixed two-candidate SQL,
read-write role probes, the shared strict proof, hostile input/result/dependency shapes, server IDs,
admission/timing, generic failures, clearing, release, and close without a real key or connection.
Canvas tests execute real render loops against a typed context stub, including animated and
no-context paths. Preference tests cover valid settings, reduced motion, pausing, invalid/blocked
storage, and cleanup.

Coverage thresholds apply to product components and libraries. Small framework entrypoints are
excluded from unit coverage and exercised by `next build`; counting imports as unit coverage would
not prove their framework integration. Local responsive, contrast, interaction, runtime-header, and
artifact-budget evidence is recorded in `docs/testing/PHASE1_BROWSER_MATRIX.md`. Stored visual
baselines, keyboard/screen-reader and cross-browser passes, and runtime Core Web Vitals remain open
and are listed honestly in `docs/IMPLEMENTATION_STATUS.md`.

## Change checklist

1. Preserve the synthetic-only boundary and update EN/RU strings together.
2. Add negative tests for every new input, persistence key, URL, or serialization field.
3. Test keyboard and reduced-motion behavior for visible interaction changes.
4. Keep visual assets local; sanitize binary metadata and document provenance before staging them.
5. Run `pnpm run verify`, then inspect and scan the exact staged snapshot as documented in the root
   `AGENTS.md`.
