# Vibe Racing design system

This directory is the public, durable design layer for Vibe Racing. It preserves reusable decisions
from design exploration without turning tool caches, private run metadata, or a standalone prototype
into claims about shipped product behavior.

## Source-of-truth order

When two surfaces differ, use this order:

1. Implemented behavior and accessibility: `apps/web`, its tests, and the committed browser
   evidence.
2. Current product, trust, security, and privacy contracts: `docs/PROJECT_PLAN.md`,
   `docs/architecture/SECURITY_INVARIANTS.md`, and the security documents.
3. Reusable visual rules: [brand and interface system](BRAND_SYSTEM.md).
4. Proposed direction: [race-broadcast refresh](RACE_BROADCAST_REFRESH.md).
5. Exploration only: [standalone synthetic prototype](prototypes/race-broadcast.html).

The prototype does not override an implemented contract, enable a capability, or prove production
accessibility. A future implementation pass must reproduce the selected behavior in `apps/web`,
update EN/RU strings, and pass the normal Web and browser-evidence gates.

## Contents

- [Brand and interface system](BRAND_SYSTEM.md) records stable visual tokens, geometry, motion,
  content, accessibility, and asset boundaries.
- [Race-broadcast refresh](RACE_BROADCAST_REFRESH.md) is the canonical English direction and
  acceptance contract.
- [Russian working translation](RACE_BROADCAST_REFRESH.ru.md) preserves the detailed exploration
  notes; the English contract wins if the two drift.
- [Race-broadcast prototype](prototypes/race-broadcast.html) is a self-contained, synthetic,
  network-free interaction reference.

## OpenDesign boundary

OpenDesign helped produce the exploration, but its downloaded skills, copied source snapshots,
project/run/conversation identifiers, and artifact metadata are local tool state. They are not part
of this design system and must remain outside Git.

Only reviewed outputs are retained here:

- project-authored design rules;
- a public-safe prototype with synthetic data;
- a [provenance statement](../reference/ASSET_PROVENANCE.md#race-broadcast-design-reference) that
  contains no local path or private run identifier.

The prototype uses no remote font, image, icon, script, analytics, account state, or network
request. Browser persistence is limited to locale, theme, and motion preferences.

## Verification

This directory is a reference, not an implemented product surface. While editing it, use the
ordinary public/document checks:

```text
pnpm run check:docs
pnpm run check:external-links
pnpm run check:public
```

The repository intentionally has no exact-text checker for this reference. Review visual and
interaction decisions manually; if a direction is implemented in `apps/web`, prove it through that
workspace's lint, types, tests, build, accessibility, and browser evidence.
