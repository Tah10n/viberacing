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
  generic failures. Returning login must keep options profile-free and database-state-free, derive
  identity only from an exact active credential after application verification, and atomically
  create/consume its challenge with the passkey-provenance session. Keep server WebAuthn imports in
  `passkey-registration.ts` and browser WebAuthn imports in `passkey-setup.tsx` only.
- Account passkey inventory must remain session-derived and server-rendered. Preserve the 32-row
  cap, exact closed mapper, one current active authenticator, rounded creation date, and omission of
  credential IDs, public keys, sign counters, exact activity timestamps, and profile IDs from HTML.
- Profile visibility must remain an exact-session, same-origin server action over the closed
  `public`/`hidden` mapper. Hiding removes the profile from public reads but does not pause existing
  source sync; publishing makes it eligible for public reads again. Preserve idempotency, generic
  failures, no browser persistence, and the fixed Web/Auth database capability.
- The private account score view must remain server-rendered and session-derived. Read only the
  selected current Monday's seven 0–1000 derived daily scores plus bounded weekly score, active-day
  count, contributing-source count, season dates/state, and visibility. Hidden profiles expose no
  score. Never add raw usage, source/device/profile IDs, a browser fetch/cache, or an extra account
  database checkout for this view.
- Active-device inventory must remain session-derived, server-rendered, and usable while the profile
  is hidden. Project only the at-most-64 active credentials with bounded label/platform/version and
  day-rounded activation; omit source IDs, internal key/profile IDs, public keys, and exact times
  from HTML. The exact opaque device ID may enter only its authenticated hidden revoke form. Device
  revoke remains an immediate, terminal, same-origin owned-device action with a generic result and
  bounded audit reference.
- Source controls must remain session-derived and usable while the profile is hidden. Raw source IDs
  must not enter HTML or form data; expose only an exact-shape encrypted control token bound to the
  active session for at most 15 minutes. Keep sources visible even when they have no active device.
  Pause is immediate. Reactivation is allowed only from `paused` after a fresh required-UV assertion
  bound to the session, source, RP ID, and origin, followed by one atomic consume-and-reactivate
  statement. Unlink requires a distinct fresh assertion context and one atomic consume-and-unlink
  statement; it is terminal and revokes every active source device. None of these actions may
  publish a hidden profile, and reactivation must not lift quarantine.
- Passkey revocation must target only an owned non-current active key from that inventory. Bind one
  fresh required-UV assertion to the exact active session, target, RP, origin, and five-minute
  challenge, then consume and revoke atomically. The opaque target ID may enter only the
  authenticated revoke control/request; never expose credential IDs or key material.
- Passkey addition must validate and seal the label before WebAuthn, use independent required-UV
  assertion and registration challenges, bind both to the active session/profile/RP/origin, and
  consume-plus-add atomically under the existing lifetime cap. Profile UUID may enter only the
  authenticated registration options required by the user's authenticator.
- Recovery-code rotation must require the exact active session and one fresh required-UV assertion
  bound to that session/profile/RP/origin. Generate exactly ten independent selector/secret codes,
  derive their Argon2id PHCs sequentially under the protected recovery-only pepper, and atomically
  consume the challenge while replacing the batch. Return plaintext only after commit in one
  no-store response, keep it out of logs and browser persistence, and keep rotation separate from
  anonymous recovery.
- Recovery sign-in may look up only one exact opaque selector and PHC, and malformed, unknown, used,
  wrong-secret, and dependency-failure attempts must remain generic. Preserve bounded Argon2id under
  the separate protected pepper, the configured response floor, four-call no-queue admission, the
  purpose-separated five-minute recovery cookie, exact RP/origin/challenge/context verification, and
  atomic replacement-passkey/session completion. A code must never create a session directly;
  activated source devices remain separate explicitly revocable authority. Do not publish private
  timing or attempt thresholds, add browser persistence, or claim the local controls are an edge
  policy, cleanup, notification, live authenticator/database proof, or deployment evidence.
- Profile deletion must require the exact active session, exact typed handle, and a fresh
  required-UV assertion bound to that session, profile, handle, RP, origin, and five-minute
  challenge. Consume the challenge and invoke the existing atomic hide/revoke/unlink/enqueue
  capability in one statement, clear all browser auth cookies only after success, and keep every
  failure generic. Do not claim that queueing runs the absent purge worker, clears a future public
  cache, or proves restore replay.
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
  and negative tests. Do not describe the local identity slices as production-ready recovery,
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
