# Phase 1 browser and production-artifact evidence

## Scope and evidence status

This document records local evidence for the synthetic Phase 1 frontend. The original responsive,
contrast, interaction, and header observations were collected on 2026-07-14 in a Chromium-based
in-app browser whose exact version was not exposed. On 2026-07-18 the production build was also
captured through Chrome 150.0.7871.129 on `win32-x64` by the repository-owned CDP harness.

The capture uses a new temporary browser profile, disables extensions, sync, proxy use, and
background services, permits the page to request only its exact loopback origin, selects the closed
theme/locale controls before hydration, and forces motion off. It contains no account, workstation,
browser-profile, or real usage data. Every stored image is page-only; browser chrome and the local
origin are absent from the pixels.

The production build, component coverage, artifact budgets, and stored-baseline integrity are
deterministic CI gates. Re-rendering still requires a separately reviewed Chromium executable, so a
human must inspect every visual diff. This is useful implementation evidence, not cross-browser
release certification.

## Stored responsive viewport matrix

The committed baseline set covers the Cartesian product of three viewports, two locales, and all
three themes. Each image is the exact top viewport of the synthetic fallback with motion disabled.
The [manifest](phase1-visual-baselines/manifest.json) records every byte count and SHA-256 digest.

| Viewport    | Locale  | Classic Grand Prix                                                        | Cyber Rally                                                        | Neon Night                                                        |
| ----------- | ------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------- |
| 1280 by 720 | English | [PNG](phase1-visual-baselines/desktop-1280x720-en-classic-grand-prix.png) | [PNG](phase1-visual-baselines/desktop-1280x720-en-cyber-rally.png) | [PNG](phase1-visual-baselines/desktop-1280x720-en-neon-night.png) |
| 1280 by 720 | Russian | [PNG](phase1-visual-baselines/desktop-1280x720-ru-classic-grand-prix.png) | [PNG](phase1-visual-baselines/desktop-1280x720-ru-cyber-rally.png) | [PNG](phase1-visual-baselines/desktop-1280x720-ru-neon-night.png) |
| 390 by 844  | English | [PNG](phase1-visual-baselines/mobile-390x844-en-classic-grand-prix.png)   | [PNG](phase1-visual-baselines/mobile-390x844-en-cyber-rally.png)   | [PNG](phase1-visual-baselines/mobile-390x844-en-neon-night.png)   |
| 390 by 844  | Russian | [PNG](phase1-visual-baselines/mobile-390x844-ru-classic-grand-prix.png)   | [PNG](phase1-visual-baselines/mobile-390x844-ru-cyber-rally.png)   | [PNG](phase1-visual-baselines/mobile-390x844-ru-neon-night.png)   |
| 320 by 568  | English | [PNG](phase1-visual-baselines/compact-320x568-en-classic-grand-prix.png)  | [PNG](phase1-visual-baselines/compact-320x568-en-cyber-rally.png)  | [PNG](phase1-visual-baselines/compact-320x568-en-neon-night.png)  |
| 320 by 568  | Russian | [PNG](phase1-visual-baselines/compact-320x568-ru-classic-grand-prix.png)  | [PNG](phase1-visual-baselines/compact-320x568-ru-cyber-rally.png)  | [PNG](phase1-visual-baselines/compact-320x568-ru-neon-night.png)  |

Before taking each PNG, the harness rejects a wrong viewport, an outer document overflow, or any
brand, badge, navigation, hero, action, or trust-banner boundary outside the viewport. This check
found that the English `/join` navigation item was clipped at 320 pixels. The responsive navigation
now wraps, and the complete matrix passed only after the production build was regenerated.

`pnpm run check:phase1-visual-baselines` verifies the exact 18-file inventory, canonical dimensions,
byte limits, manifest digests, and public PNG chunk policy without launching a browser. Ten
black-box mutations cover missing or extra files, digest drift, unreviewed metadata, wrong raster
dimensions, browser-version ambiguity, invalid dates, widened capture policy, reordered entries, and
manifest schema widening.

Twelve separate CLI capture-guardrail cases reject missing write intent, ambiguous arguments,
non-loopback or credentialed origins, origin paths, privileged ports, missing, relative, directory,
or non-executable browser paths, and an executable that is not Chromium before any baseline can be
written. Ten production request-policy assertions cover same-origin assets/API reads plus external
origins, different ports, malformed and credentialed URLs, and credential-bearing headers.

To intentionally regenerate the evidence, build and start the production frontend on an explicit
loopback port in one terminal, then use an absolute path to a reviewed Chromium executable in a
second terminal:

In the first terminal:

```text
pnpm run build:web
pnpm --filter @viberacing/web exec next start --hostname 127.0.0.1 --port 3317
```

In a second PowerShell terminal, construct the exact loopback origin without treating it as a public
link:

```powershell
$phase1Origin = [System.UriBuilder]::new("http", "127.0.0.1", 3317).Uri.AbsoluteUri
pnpm run capture:phase1-visual-baselines -- --origin $phase1Origin --browser <absolute-path-to-reviewed-chromium> --write
pnpm run check:phase1-visual-baselines
```

The capture command never discovers or opens a signed-in browser profile. Review all 18 rendered
images, the complete manifest diff, and the public staged snapshot before committing a refresh.

## Responsive and interaction observations

The earlier interactive pass covered 1280 by 720 English Neon Night, 390 by 844 English Cyber Rally,
and 320 by 568 Russian Classic Grand Prix. The hero/trust, canvas/control, leaderboard, and profile
structures rendered without outer document overflow. The narrow table remained inside its
keyboard-focusable horizontal scroll container.

Theme, locale, motion, and pause controls changed the rendered `data-theme`, `lang`, `data-motion`,
and `aria-pressed` states. The paused Russian control changed from `Остановить гонку` to
`Продолжить гонку`. The page reported no browser console warnings or errors during those checks.

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
| Initial assets                |        8 |      10 |
| Initial raw bytes             |  612,174 | 700,000 |
| Initial gzip bytes            |  184,562 | 215,000 |
| Application client gzip bytes |    8,880 |  10,000 |
| Stylesheet gzip bytes         |    4,248 |   5,000 |

Nine black-box fixture cases cover a valid artifact, missing/traversing/oversized assets, source-map
leakage, missing standalone output, total/application budget overruns, and font-boundary drift.

## Remaining manual gates

- The committed bytes are integrity-checked, but root verification does not re-render or perform a
  semantic pixel diff because no browser executable is pinned in the repository.
- Keyboard-only traversal, screen-reader smoke testing, and forced-colors/high-contrast testing
  remain required.
- Runtime Core Web Vitals must be measured with animation enabled and with reduced motion.
- Safari and Firefox release evidence has not been collected.

Do not reinterpret these gaps as passing results. They remain listed in
[`IMPLEMENTATION_STATUS.md`](../IMPLEMENTATION_STATUS.md) until reproducible evidence exists.
