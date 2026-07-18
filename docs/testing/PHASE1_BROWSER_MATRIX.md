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
byte limits, manifest digests, and public PNG chunk policy without launching a browser. Eleven
black-box mutations cover missing or extra files, digest drift, unreviewed metadata, wrong raster
dimensions, per-capture size overflow, browser-version ambiguity, invalid dates, widened capture
policy, reordered entries, and manifest schema widening.

Fifteen separate CLI guardrail cases reject missing or ambiguous write/verify intent, repeated
package-manager separators, non-loopback or credentialed origins, origin paths, privileged ports,
missing, relative, directory, or non-executable browser paths, and an executable that is not
Chromium before any baseline can be written. Ten production request-policy assertions cover
same-origin assets/API reads plus external origins, different ports, malformed and credentialed
URLs, and credential-bearing headers. Four environment-policy assertions cover exact match and
product/platform drift; six pixel-result assertions cover exact, different, dimension-drifted,
widened, contradictory, and arithmetic-overflow summaries. Five keyboard-policy, six
accessibility-tree-policy, and five forced-colors-policy assertions reject missing, widened, or
contradictory browser audit summaries.

The explicit `verify:phase1-visual-baselines` mode first applies that shared integrity boundary,
requires the browser's exact reported product and local platform to equal the committed manifest,
re-renders all 18 states, decodes each stored/rendered PNG inside the isolated browser, and permits
zero changed pixel channels. It then runs the keyboard, accessibility-tree, and forced-colors audit
described below. It writes no baseline file. A local run with the recorded Chrome 150.0.7871.129
`win32-x64` pair passed all comparisons and browser audits on 2026-07-18. This pins observable
product/platform behavior, not the provenance or digest of the operator-supplied executable.

To verify or intentionally regenerate the evidence, build and start the production frontend on an
explicit loopback port in one terminal, then use an absolute path to a reviewed Chromium executable
in a second terminal:

In the first terminal:

```text
pnpm run build:web
pnpm --filter @viberacing/web exec next start --hostname 127.0.0.1 --port 3317
```

In a second PowerShell terminal, construct the exact loopback origin without treating it as a public
link:

```powershell
$phase1Origin = [System.UriBuilder]::new("http", "127.0.0.1", 3317).Uri.AbsoluteUri
$browserPath = "<absolute-path-to-reviewed-chromium>"
pnpm run verify:phase1-visual-baselines -- --origin $phase1Origin --browser $browserPath
```

Only to regenerate the stored evidence, use the write command and then the offline checker:

```powershell
pnpm run capture:phase1-visual-baselines -- --origin $phase1Origin --browser $browserPath --write
pnpm run check:phase1-visual-baselines
```

Neither browser command discovers or opens a signed-in browser profile. Review all 18 rendered
images, the complete manifest diff, and the public staged snapshot before committing a refresh.

## Responsive and interaction observations

The earlier interactive pass covered 1280 by 720 English Neon Night, 390 by 844 English Cyber Rally,
and 320 by 568 Russian Classic Grand Prix. The hero/trust, canvas/control, leaderboard, and profile
structures rendered without outer document overflow. The narrow table remained inside its
keyboard-focusable horizontal scroll container.

Theme, locale, motion, and pause controls changed the rendered `data-theme`, `lang`, `data-motion`,
and `aria-pressed` states. The paused Russian control changed from `Остановить гонку` to
`Продолжить гонку`. The page reported no browser console warnings or errors during those checks.

## Keyboard, accessibility-tree, and forced-colors evidence

The no-write gate resets the exact synthetic English Classic Grand Prix page at 1280 by 720 and
dispatches real `Tab`, `Shift+Tab`, `Enter`, and `Space` key events through CDP. The closed forward
order contains the skip link, brand, five primary-navigation links, hero action, pause button, three
labelled selects, and keyboard-scrollable table region. Every target was in the viewport with its
focus outline visible. Reverse traversal returned from the table to the motion select. The skip link
became visible and transferred both the fragment and programmatic focus to the non-sequential
leaderboard section. Space changed the pause control's `aria-pressed` state from `false` to `true`
and back to `false`.

The same run reads Chromium's full accessibility tree rather than inferring semantics from DOM
attributes alone. It requires exactly one banner, primary navigation, main, and content-info
landmark; eight named links; two named buttons including the disabled unavailable control; three
named comboboxes; the named race image; the leaderboard table's full trust caption; and the hero
heading. The exact link/button/combobox inventory and duplicate counts, an unnamed reviewed control,
or an unreviewed input role fail closed.

With `(forced-colors: active)` emulated, all 13 keyboard targets retained visible focus in the same
order, the document retained its horizontal bounds, and ten reviewed control/panel/table/canvas
surfaces retained explicit borders. Code-native canvas pixels use `forced-color-adjust: none`, while
the separately exposed image name/description and semantic table remain authoritative alternatives.
This is exact local Chrome keyboard and accessibility-tree evidence. It is not a native
screen-reader session, operating-system High Contrast certification, or evidence for another
browser.

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
headers, and focus color. The canonical forced-colors browser audit is separate; neither result
covers every state, zoom level, operating-system palette, or composited pixel.

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
| Initial raw bytes             |  612,748 | 700,000 |
| Initial gzip bytes            |  184,686 | 215,000 |
| Application client gzip bytes |    8,879 |  10,000 |
| Stylesheet gzip bytes         |    4,373 |   5,000 |

Nine black-box fixture cases cover a valid artifact, missing/traversing/oversized assets, source-map
leakage, missing standalone output, total/application budget overruns, and font-boundary drift.

## Remaining manual gates

- The explicit local gate performs the semantic re-render diff, but root/pull-request verification
  does not launch Chromium and no provenance/digest-pinned browser artifact is provisioned.
- Native screen-reader smoke testing and operating-system High Contrast confirmation remain
  required; the local CDP accessibility-tree/forced-colors audit does not claim either result.
- Runtime Core Web Vitals must be measured with animation enabled and with reduced motion.
- Safari and Firefox release evidence has not been collected.

Do not reinterpret these gaps as passing results. They remain listed in
[`IMPLEMENTATION_STATUS.md`](../IMPLEMENTATION_STATUS.md) until reproducible evidence exists.
