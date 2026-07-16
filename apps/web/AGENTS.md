# Web workspace agent guidance

Read the root `AGENTS.md`, this directory's `README.md`, and the current implementation status
before editing. The root security, privacy, documentation, dependency, and staged-review rules all
apply.

## Non-negotiable boundaries

- `lib/race-data.ts` is synthetic test/demo input only. Never paste exports, logs, account data, or
  workstation-derived values into it.
- Client-facing `SyntheticRacePayload` contains scores and presentation fields, not raw tokens or
  source/account identifiers. Keep raw activity on the server side of the page boundary.
- Community results are self-reported. Keep the disclaimer visible and Verified mode unreachable.
- `CarRecipe` remains a closed enum with fixed repository-owned output. Do not add arbitrary text,
  markup, styles, colors, files, SVG, or URLs.
- Browser persistence is limited to locale, theme, and motion. Do not add trackers, analytics,
  fingerprinting, or account state to local storage.
- Preserve per-navigation nonce CSP and repository-root build isolation. Do not add a CSP origin,
  remote asset, or capability merely to silence a failure.
- Keep compose `DATABASE_*` owner credentials out of Web code. The public-score adapter uses only
  `VIBERACING_WEB_DATABASE_*`, strict TLS/config parsing, a dedicated bounded pool, and an effective
  Web-role/login-capability probe before every query. Do not bypass the store with generic SQL or
  wire it outside the exact `/v1/community/scores` boundary.
- Pairing reuses that environment-owned Web/Auth login only through its separate read-write pool.
  Preserve the exact role/login/search-path/read-write probe, two fixed verifier candidates,
  protected primary/secondary HMAC capability, strict proof-before-activation sequence, server-owned
  IDs, four-call admission, 250-millisecond settlement floor, and generic decision. Do not import
  `pg` outside the two reviewed pool wrappers or expose a generic query/activation surface.
- Enrollment may reuse the same read-write pool only through `enrollment-database.ts`. Preserve the
  exact invite grammar and immediate digest reduction, OAuth state/PKCE/no-extra-scope contract,
  purpose-separated encrypted HttpOnly cookies, exact same-origin bounded POST bodies, fixed
  enrollment/challenge/passkey/session calls, atomic pending-to-passkey session rotation, and
  generic failures. Keep server WebAuthn imports in `passkey-registration.ts` and browser WebAuthn
  imports in `passkey-setup.tsx` only.
- Generate public request IDs only through the opaque server-only factory. Do not reuse inbound
  correlation headers, reflect internal errors, bypass `ProblemDetailsV1`, or add route-specific
  CORS/auth/retry semantics to the common problem-response boundary.
- The score route must continue to reject duplicate/unknown query parameters, validate
  `CommunityScoreQueryV1`, negotiate `Accept`, acquire bounded admission before database work, keep
  it until that work settles, and preserve ADR 0013's no-store/same-origin response matrix.
- Keep pairing possession in the server-only pure verifier. It may accept only the exact approved
  material tuple and versioned message, use strict Ed25519 semantics, and return no reflected
  detail. The dormant activation application may call activation only through the closed ADR 0027
  composition.
- Pairing start may accept only ADR 0028's closed public-key/label/version/OS/architecture request.
  Server code owns all IDs, token, challenge, code, digests, and expiry; poll and human-code HMAC
  keys remain separate protected capabilities. Only the closed start adapter may invoke the fixed
  start procedure.
- Do not add a pairing route, its browser/session approval, a connector client, or a pairing
  WebAuthn claim without complete transport admission, distributed rate/deadline policy, contracts,
  and negative tests. Do not describe the local enrollment slice as returning login, recovery,
  deployed authentication, or live-user evidence.

## Commands

Run from the repository root:

```text
pnpm run lint:web
pnpm run typecheck:web
pnpm run test:web:coverage
pnpm run build:web
pnpm run check:web-build
```

Run `pnpm run verify` before completion. The focused commands do not replace repository history,
public-data, license, documentation, or staged-snapshot gates.

## Implementation conventions

- Keep strict TypeScript and typed lint rules green; do not use broad casts to bypass an input
  boundary.
- Update `lib/i18n.ts` with EN/RU key parity for every user-visible string.
- Prefer semantic HTML as the authoritative experience. Canvas is enhancement and must retain a
  useful accessible description and reduced-motion behavior.
- Keep scoring/ranking deterministic, bounded, and covered at caps, invalid inputs, and ties.
- Exercise actual state changes and production code paths in tests. Do not lower coverage thresholds
  or disable axe rules except for jsdom's documented inability to measure visual contrast; browser
  evidence must cover that gap.
- Keep Next.js entrypoints thin. Add product logic to testable modules with explicit input/output
  types.

Before committing, review generated `.next`, coverage, screenshots, and local fixtures to ensure
none are tracked. Stage only intended files, run `pnpm run check:public:staged`, and manually
inspect `git diff --cached`.
