# Vibe Racing web prototype

This workspace is the Phase 1 product shell: a responsive pixel-art race, Community leaderboard, and
demo profile built entirely from committed synthetic fixtures. It is suitable for local design,
accessibility, localization, and scoring review. It is not an authenticated product and does not
read Codex or user accounts. Server-only score database and public problem-response modules now
exist for the next application slices, but no route or visible component constructs them; the
prototype still does not query a database or expose an API.

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

| Path                                   | Responsibility                                                 | Trust boundary                                                                  |
| -------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `app/page.tsx`                         | Builds the synthetic public payload on the server              | Must pass only public presentation data into the client tree                    |
| `lib/race-data.ts`                     | Clearly synthetic raw activity fixtures and payload projection | Marked `server-only`; never replace with exports or real account data           |
| `lib/public-community-score-mapper.ts` | Validates and maps the exact SQL score projection              | Server-only, exact allowlist, top-32, and fail-closed                           |
| `lib/public-community-score-store.ts`  | Executes the fixed public-score procedure and mapper           | Canonical Monday only; verifies every checkout; no route constructs it yet      |
| `lib/public-http-problem.ts`           | Generates opaque request IDs and closed public error responses | Server-only; validates the contract; no inbound ID, CORS, detail, or cause      |
| `lib/public-score-database-config.ts`  | Parses the dedicated Web login and TLS/pool contract           | Owner settings are separate; production is verify-full; errors reflect no value |
| `lib/public-score-database-pool.ts`    | Wraps `pg` with narrow connect/query/release/close authority   | Four connections; bounded waits; stable idle-error signal only                  |
| `lib/scoring.ts`                       | Bounded daily/weekly score and deterministic rank calculation  | Treat all future device input as untrusted and validate before calling          |
| `lib/race-types.ts`                    | Client-safe participant and demo-profile shape                 | Must not gain raw tokens or source/account identifiers                          |
| `lib/public-origin.ts`                 | Strict parser for the canonical social-metadata origin         | Server-only; hosted origins require HTTPS DNS and no extra URL parts            |
| `lib/car-recipe.ts`                    | Closed-enum car customization and fixed sprites                | No arbitrary colors, markup, text, files, SVG, or URLs                          |
| `components/pixel-race-canvas.tsx`     | Deterministic code-native renderer                             | Draws fixed primitives only; semantic DOM description is mandatory              |
| `components/race-experience.tsx`       | EN/RU interaction, table, profile, theme, and motion controls  | Local storage is restricted to non-personal preferences                         |
| `proxy.ts`                             | Per-response nonce CSP                                         | Keep production CSP fail-closed and free of remote origins                      |
| `next.config.ts`                       | Static security headers and build isolation                    | Turbopack must remain pinned to this repository root                            |

## Public HTTP problem boundary

The common server-only factory requests 16 cryptographic random bytes and returns a frozen opaque
token whose `req_` value cannot be replaced with an inbound correlation string through the typed
API. It owns all eleven `ProblemDetailsV1` status/title/retry mappings, validates the complete body,
and emits `application/problem+json`, `Cache-Control: no-store`, and the matching `x-request-id`. It
emits no CORS header, cookie, detail, exception cause, hostname, SQL, or submitted value.

This is pre-route infrastructure. It does not implement the contract-only `/v1/community/scores`
path, request parsing, method or content negotiation, auth/retry headers, admission control,
deadline, logging sink, store-error translation, or success serialization. Those remain mandatory
route-level decisions; an endpoint must generate one token at entry and never replace it with an
inbound header.

The generated contract reserves `GET /v1/community/scores` with one bounded Monday `seasonStart`,
`no-store`, `Vary: Accept`, same-origin/no-CORS semantics, and closed 200/400/406/429/500/503
responses. This is an implementation target, not a reachable route or deployment claim.

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
- Product rendering uses local HTML/CSS/canvas code. The social preview is a documented,
  metadata-sanitized project-generated PNG; no remote visual source is loaded. The optional Next.js
  `sharp` graph is removed while image optimization is unused. A `never`-typed declaration covers
  Next.js's type-only reference, while lint policy forbids importing the absent runtime.

These controls reduce current risk; they do not make Community claims authoritative and do not
replace the Phase 2 authentication, ingestion, retention, deletion, and abuse-control gates.

## Test strategy

Vitest runs business-logic, data-boundary, HTTP-problem, database-config/pool/store, component,
interaction, CSP/header, localization, and axe-core accessibility tests. HTTP-boundary cases cover
entropy, opaque tokens, every problem mapping, headers, contract validation, hostile reflective
inputs, and non-reflection. Adapter tests cover TLS/environment bounds, non-reflective failures,
pool lifecycle, every-checkout role/login/search-path/read-only probes, fixed SQL parameters,
release/destruction behavior, and mapper integration without requiring or claiming a live deployment
login. Canvas tests execute real render loops against a typed context stub, including animated and
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
