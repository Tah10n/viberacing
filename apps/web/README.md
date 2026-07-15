# Vibe Racing web prototype

This workspace is the Phase 1 product shell: a responsive pixel-art race, Community leaderboard, and
demo profile built entirely from committed synthetic fixtures. It is suitable for local design,
accessibility, localization, and scoring review. It is not an authenticated product and does not
read Codex, a database, or user accounts.

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

| Path                                   | Responsibility                                                 | Trust boundary                                                         |
| -------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `app/page.tsx`                         | Builds the synthetic public payload on the server              | Must pass only public presentation data into the client tree           |
| `lib/race-data.ts`                     | Clearly synthetic raw activity fixtures and payload projection | Marked `server-only`; never replace with exports or real account data  |
| `lib/public-community-score-mapper.ts` | Validates and maps the exact SQL score projection              | Server-only and fail-closed; no route or database client exists yet    |
| `lib/scoring.ts`                       | Bounded daily/weekly score and deterministic rank calculation  | Treat all future device input as untrusted and validate before calling |
| `lib/race-types.ts`                    | Client-safe participant and demo-profile shape                 | Must not gain raw tokens or source/account identifiers                 |
| `lib/public-origin.ts`                 | Strict parser for the canonical social-metadata origin         | Server-only; hosted origins require HTTPS DNS and no extra URL parts   |
| `lib/car-recipe.ts`                    | Closed-enum car customization and fixed sprites                | No arbitrary colors, markup, text, files, SVG, or URLs                 |
| `components/pixel-race-canvas.tsx`     | Deterministic code-native renderer                             | Draws fixed primitives only; semantic DOM description is mandatory     |
| `components/race-experience.tsx`       | EN/RU interaction, table, profile, theme, and motion controls  | Local storage is restricted to non-personal preferences                |
| `proxy.ts`                             | Per-response nonce CSP                                         | Keep production CSP fail-closed and free of remote origins             |
| `next.config.ts`                       | Static security headers and build isolation                    | Turbopack must remain pinned to this repository root                   |

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
  secrets in this phase. The only consumed environment setting is an optional public metadata
  origin; a malformed value fails the build.
- Product rendering uses local HTML/CSS/canvas code. The social preview is a documented,
  metadata-sanitized project-generated PNG; no remote visual source is loaded. The optional Next.js
  `sharp` graph is removed while image optimization is unused. A `never`-typed declaration covers
  Next.js's type-only reference, while lint policy forbids importing the absent runtime.

These controls reduce current risk; they do not make Community claims authoritative and do not
replace the Phase 2 authentication, ingestion, retention, deletion, and abuse-control gates.

## Test strategy

Vitest runs business-logic, data-boundary, component, interaction, CSP/header, localization, and
axe-core accessibility tests. Canvas tests execute real render loops against a typed context stub,
including animated and no-context paths. Preference tests cover valid settings, reduced motion,
pausing, invalid/blocked storage, and cleanup.

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
