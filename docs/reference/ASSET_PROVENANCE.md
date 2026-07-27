# Asset provenance

Every non-code visual distributed from this repository must have a reviewable origin, license or
permission basis, integrity digest, privacy review, and regeneration record. An asset is not safe
merely because it looks generic or was produced by a generation tool.

## Code-native CarRecipe pixels

| Field                       | Record                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| Repository source           | `apps/web/lib/car-recipe.ts` and `apps/web/app/globals.css`                                   |
| Purpose                     | Deterministic version 1 car sprites, trails, and three-theme account/race rendering           |
| Created                     | 2026-07-17                                                                                    |
| Method                      | Project-authored indexed 16-by-8 templates, closed transformations, and reviewed color tokens |
| Third-party source material | None                                                                                          |
| Opaque/generated binary     | None; account previews are semantic HTML/CSS pixels and the race uses canvas drawing commands |
| Distribution basis          | Project-owned source distributed under the repository Apache-2.0 license                      |
| Drift evidence              | `apps/web/lib/car-recipe.test.ts` and `apps/web/components/car-recipe-preview.test.tsx`       |

Every `CarRecipeV1` axis is rendered from closed enums. Readable sprite assertions cover body, nose,
cockpit, wing, wheel, seed, and trail transformations; exact palette assertions cover all three
themes. No automotive logo, brand name, uploaded asset, arbitrary color, remote URL, SVG, font,
metadata, or user drawing command enters this pipeline. Visual trade-dress review remains a release
gate even for project-authored combinations.

## Race-broadcast design reference

| Field                       | Record                                                                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Repository path             | `docs/design/` and `docs/design/prototypes/race-broadcast.html`                                                                                                    |
| Purpose                     | Reusable brand/interface rules plus a standalone synthetic reference for a possible race-broadcast refresh                                                         |
| Created                     | 2026-07-25; public curation and review updated 2026-07-26                                                                                                          |
| Method                      | OpenDesign-assisted exploration from repository-owned public product/security/design inputs, followed by manual contract, privacy, trust, and accessibility review |
| Third-party source material | None; participant names, values, cars, copy, HTML, CSS, and canvas drawing are synthetic or project-authored                                                       |
| Runtime dependencies        | None; no remote font, image, icon, script, analytics, account state, or network request                                                                            |
| Browser persistence         | Exactly locale, theme, and motion preferences                                                                                                                      |
| Private tool state          | Downloaded skills, copied plugin source, local paths, and project/run/conversation/artifact identifiers are excluded from the repository                           |
| Opaque/generated binary     | None; the prototype and design contracts are reviewable text                                                                                                       |
| Distribution basis          | Project-authored reviewed output distributed under the repository Apache-2.0 license                                                                               |
| Drift evidence              | Manual review of the text-only reference; implemented behavior remains covered in `apps/web`                                                                       |

This record does not make the standalone prototype a production surface or browser-baseline result.
Implemented Web behavior and its checked evidence remain authoritative. Any adoption in `apps/web`
requires the normal EN/RU, accessibility, coverage, build, asset-budget, and browser-evidence gates.

## Phase 1 responsive viewport baselines

| Field                       | Record                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Repository path             | `docs/testing/phase1-visual-baselines/`                                                                       |
| Purpose                     | Reviewable top-viewport evidence for every 3-viewport by 2-locale by 3-theme synthetic combination            |
| Created                     | 2026-07-18                                                                                                    |
| Method                      | Repository-owned CDP capture of the local production build with motion disabled and a fresh temporary profile |
| Browser evidence            | Chrome 150.0.7871.129 on `win32-x64`; this is local Chromium evidence, not a cross-browser result             |
| Re-render verification      | All 18 exact-product/platform decoded-pixel comparisons passed with zero changed pixel channels on 2026-07-18 |
| Dimensions                  | Six images each at 1280 by 720, 390 by 844, and 320 by 568 pixels                                             |
| Integrity record            | `docs/testing/phase1-visual-baselines/manifest.json` contains all 18 byte counts and SHA-256 digests          |
| Third-party source material | None; pixels are rendered only from the repository's synthetic HTML, CSS, canvas, and fixed fixtures          |
| Distribution basis          | Project-authored page rendering distributed with the repository under Apache-2.0                              |

The capture harness starts the reviewed browser with an isolated temporary profile, extensions and
sync disabled, no proxy, and page requests restricted to the exact loopback origin. It selects only
the existing locale, theme, and motion preferences before hydration. Browser chrome, local paths,
account state, real activity, and remote resources are absent. The harness rejects reviewed
header/hero elements outside the viewport; its first compact pass found and blocked a clipped join
link until the responsive navigation was fixed.

`scripts/check-phase1-visual-baselines.mjs` enforces the complete Cartesian inventory, dimensions,
per-file and aggregate size limits, manifest digests, and the same public PNG chunk policy used for
other assets. The separate verify-only command requires the manifest's exact reported browser
product/platform, re-renders the matrix, decodes both sides inside the isolated browser, and rejects
one changed pixel channel without writing. The executable remains operator-supplied rather than
provenance/digest-pinned. Regeneration requires the explicit write command in the
[browser matrix](../testing/PHASE1_BROWSER_MATRIX.md), inspection of all rendered diffs, and the
normal staged public-data review.

## Social preview race scene

| Field                       | Record                                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Repository path             | `apps/web/app/opengraph-image.png`                                                                                                                                       |
| Purpose                     | Open Graph and social preview for the synthetic web prototype                                                                                                            |
| Created                     | 2026-07-14                                                                                                                                                               |
| Method                      | OpenAI image generation capability in Codex; no input or reference image                                                                                                 |
| Prompt brief                | Wide pixel-art night race with five original cars, a checkered finish, neon city lighting, no words, no logos, no people, and no real automotive branding or trade dress |
| Dimensions                  | 1731 by 909 pixels                                                                                                                                                       |
| Final size                  | 1,682,527 bytes                                                                                                                                                          |
| Final SHA-256               | `3e606b5fb7ac5889d55e53b4c3c301bb65711a16feedfed207c0a20f359040e6`                                                                                                       |
| Accessibility text          | `apps/web/app/opengraph-image.alt.txt`                                                                                                                                   |
| Third-party source material | None supplied or intentionally reproduced                                                                                                                                |
| Distribution basis          | Project-generated output intended for distribution with the Apache-2.0 repository, subject to the release legal review in `THIRD_PARTY_NOTICES.md`                       |

### Metadata sanitation

The generation service returned a 1,707,461-byte PNG with SHA-256
`fcf1a900f0d3bb08571ab6fc03511da2af5961eb8f6edcb7b991cf189ab1de6e`. It contained a signed `caBX`
C2PA provenance chunk with service certificate material and stable identifiers. No user identity,
input image, prompt, local path, account credential, or secret was observed, but the chunk was
removed instead of weakening the repository's public-data scanner.

`scripts/sanitize-png-metadata.mjs` retained the PNG signature and all `IHDR`, `IDAT`, and `IEND`
chunks byte-for-byte. The resulting file has no ancillary metadata chunks. The original metadata-
bearing file is not retained in the repository.

Reproduce the sanitation after replacing this asset:

```text
node scripts/sanitize-png-metadata.mjs apps/web/app/opengraph-image.png
node scripts/test-png-content-policy.mjs
pnpm run check:public
```

Then update both digests and sizes in this record, review the rendered image for protected content
and accidental text, and inspect the exact staged binary with the normal publication gates.
