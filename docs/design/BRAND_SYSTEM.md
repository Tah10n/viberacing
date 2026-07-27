# Vibe Racing brand and interface system

This document records the reusable visual system observed in the current Web implementation and the
reviewed race-broadcast exploration. It is an extraction and design contract, not evidence that the
standalone exploration has shipped in `apps/web`.

Production CSS, TypeScript theme definitions, closed CarRecipe rendering, and the committed visual
baselines remain authoritative for implemented behavior. Proposed refresh rules are authoritative
only for future design work after their normal implementation and browser-evidence gates.

The current system is a code-native pixel-racing identity built from square frames, hard offset
shadows, monospace typography, deterministic sprites, and three venue palettes.

## Core tokens

The six canonical roles below are converted from the current CSS values in
`apps/web/app/globals.css`. The role names are normalized for design work; production variable names
remain unchanged until an approved implementation pass.

### Neon Night

```css
--bg: oklch(18.57% 0.0668 288.68);
--surface: oklch(23.27% 0.0801 292.7);
--fg: oklch(96.87% 0.018 303.42);
--muted: oklch(78.16% 0.0532 298.76);
--border: oklch(96.87% 0.018 303.42);
--accent: oklch(92.24% 0.1427 97.78);
```

### Classic Grand Prix

```css
--bg: oklch(94.73% 0.0266 87.85);
--surface: oklch(98.62% 0.0142 84.58);
--fg: oklch(24.3% 0.024 248.84);
--muted: oklch(45.84% 0.0171 84.59);
--border: oklch(24.3% 0.024 248.84);
--accent: oklch(50.79% 0.1721 23.38);
```

### Cyber Rally

```css
--bg: oklch(20.89% 0.0272 191.11);
--surface: oklch(28.31% 0.0398 184.62);
--fg: oklch(98.06% 0.0356 138.88);
--muted: oklch(79.24% 0.054 168.5);
--border: oklch(98.06% 0.0356 138.88);
--accent: oklch(91.98% 0.2192 128.77);
```

## Typography

```css
--font-display: "Courier New", "Lucida Console", Monaco, monospace;
--font-body: "Courier New", "Lucida Console", Monaco, monospace;
--font-mono: ui-monospace, "Cascadia Mono", monospace;
```

The refresh plan may separate display and reading roles, but any replacement must support English
and Russian, remain locally hosted or platform-native, and pass the repository's provenance,
license, bundle, and visual-baseline policies.

## Observed posture

- Square, three-pixel borders and hard offset shadows make controls feel like physical arcade
  hardware; corner radii are intentionally absent.
- Uppercase headings and labels use compressed line-height and positive tracking for small caps.
- The race, car sprites, and trails are deterministic code-native pixel art rather than remote
  imagery.
- Themes currently change palette and canvas environment while preserving one shared information
  architecture.
- The project loads no remote font or visual asset; privacy, reproducibility, and public provenance
  are part of the brand posture.

## Geometry and interaction

- Interactive targets are at least 44 by 44 CSS pixels in the default layout.
- Controls use square corners, visible three-pixel focus outlines, and state cues that do not depend
  on color alone.
- Heavy frames and hard offset shadows are reserved for the race monitor and primary action. Dense
  lists use dividers, rhythm, and typography instead of nested cards.
- The semantic table or list remains authoritative; canvas and pixel-car motion are enhancement.
- Selected, leading, paused, current, unavailable, and destructive states require distinct text,
  structure, or iconography in addition to color.

## Motion

- Motion is limited to race position, the selected participant, and short physical button feedback.
- System reduced-motion preference is respected.
- The explicit reduced-motion control disables animation, transitions, and smooth scrolling even
  when the operating system preference allows motion.
- Pausing animation never hides data or disables navigation.

## Content and trust

- Community results are described as self-reported and not verified or endorsed by any provider.
- Racing language never implies globally representative ranking, equal compute or cost, verified
  identity, or a valuable reward.
- Only the deliberate weekly profile aggregate may appear on the direct-token scene. Daily usage,
  source/provider detail, private identifiers, devices, and exact receipt time remain outside it.
- EN/RU strings are designed together; neither locale silently narrows the trust disclaimer.

## Asset and implementation boundary

- Runtime visuals use repository-owned HTML, CSS, canvas primitives, and closed deterministic pixel
  recipes.
- No remote font, image, icon, arbitrary SVG, uploaded style, or user-authored rendering command is
  part of the system.
- The standalone [race-broadcast prototype](prototypes/race-broadcast.html) is a synthetic design
  reference. It has no production authority, network request, analytics, or account state.
- Non-code assets continue to follow
  [the asset provenance policy](../reference/ASSET_PROVENANCE.md).
