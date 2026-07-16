# Phase 1 browser and production-artifact evidence

## Scope and evidence status

This document records local evidence from 2026-07-14 for the synthetic Phase 1 frontend. It contains
no account, workstation, browser-profile, or real usage data. The browser was a Chromium-based
in-app browser whose exact version was not exposed to the run, so this is useful implementation
evidence but not a cross-browser release certification.

The production build, component coverage, and artifact budgets are deterministic CI gates. Viewport,
computed-contrast, and response-header observations below were performed locally and must be
repeated in the release browser matrix before public beta.

## Responsive and interaction matrix

| Viewport    | Locale and theme            | Evidence                                                                                                                                 |
| ----------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1280 by 720 | English, Neon Night         | Hero/trust split, canvas/controls split, complete semantic leaderboard, and profile structure rendered without outer horizontal overflow |
| 390 by 844  | English, Cyber Rally        | Header/navigation, hero, trust banner, and primary action fit the viewport; canvas scales to the content width                           |
| 320 by 568  | Russian, Classic Grand Prix | Russian navigation wraps without outer overflow; the 992-pixel table remains inside a 283-pixel keyboard-focusable scroll container      |

Observed outer document widths never exceeded their corresponding viewports. Theme, locale, motion,
and pause controls changed the rendered `data-theme`, `lang`, `data-motion`, and `aria-pressed`
states. The paused Russian control changed from `Остановить гонку` to `Продолжить гонку`. The page
reported no browser console warnings or errors during these checks.

## Computed color contrast

Contrast was calculated from the actual computed CSS variables with the WCAG sRGB relative luminance
formula. The first pass found three failing Classic Grand Prix pairs (3.69:1 to 4.29:1). The
light-theme accent and button-text token were changed, then all pairs were measured again.

| Theme              | Lowest tested normal-text pair after correction | Button text on accent | Focus color on main background |
| ------------------ | ----------------------------------------------: | --------------------: | -----------------------------: |
| Neon Night         |                                          7.73:1 |               14.83:1 |                        14.47:1 |
| Classic Grand Prix |                                          4.68:1 |                6.10:1 |                         5.29:1 |
| Cyber Rally        |                                          6.06:1 |               15.37:1 |                         8.48:1 |

The tested pairs cover text, muted text, accent text, buttons, disabled controls, panels, table
headers, and focus color. This calculation does not replace a browser accessibility audit for every
state, zoom level, forced-color mode, or composited pixel.

## Runtime response policy

Two development responses and a separately started production build were requested over loopback.

| Check                             | Development                                           | Production                                     |
| --------------------------------- | ----------------------------------------------------- | ---------------------------------------------- |
| HTTP status                       | 200                                                   | 200                                            |
| Fresh CSP nonce                   | Different 24-character nonce per response             | Present and used by emitted HTML               |
| `unsafe-eval`                     | Present only for the Next.js development runtime      | Absent                                         |
| Framing policy                    | `frame-ancestors 'none'` plus `X-Frame-Options: DENY` | Same                                           |
| Insecure-request upgrade          | Not required on loopback development                  | Enabled                                        |
| HSTS                              | Omitted                                               | `max-age=63072000; includeSubDomains; preload` |
| Cookies                           | None                                                  | None                                           |
| Absolute remote resources in HTML | None                                                  | None                                           |

Production also returned `no-referrer`, `nosniff`, same-origin opener/resource isolation, and the
restricted Permissions Policy. The response nonce appeared on the framework-emitted stylesheet and
script elements.

## Production artifact budget

`pnpm run check:web-build` parses the production manifests without evaluating generated code and
fails closed on unsafe paths, missing assets, browser source maps, generated Next.js fonts, missing
standalone output, or a budget overrun. The current artifact is:

| Metric                        | Observed |  Budget |
| ----------------------------- | -------: | ------: |
| Initial assets                |        7 |      10 |
| Initial raw bytes             |  602,667 | 700,000 |
| Initial gzip bytes            |  182,334 | 215,000 |
| Application client gzip bytes |    8,737 |  10,000 |
| Stylesheet gzip bytes         |    2,702 |   5,000 |

Nine black-box fixture cases cover a valid artifact, missing/traversing/oversized assets, source-map
leakage, missing standalone output, total/application budget overruns, and font-boundary drift.

## Remaining manual gates

- Keyboard-only traversal could not be reliably driven by the available local browser controller;
  the semantic skip link and focus styles are present, but a manual keyboard pass remains required.
- Screen-reader smoke testing and forced-colors/high-contrast testing remain required.
- Stored visual-regression baselines for every theme, locale, and breakpoint remain required.
- Runtime Core Web Vitals must be measured with animation enabled and with reduced motion.
- Safari and Firefox release evidence has not been collected.

Do not reinterpret these gaps as passing results. They remain listed in
[`IMPLEMENTATION_STATUS.md`](../IMPLEMENTATION_STATUS.md) until reproducible evidence exists.
