# CarRecipe version 1

## Status

`CarRecipeV1` is implemented locally as a language-neutral JSON Schema, generated TypeScript type
and validator, deterministic three-theme renderer, exact-session PostgreSQL proposal/approval
boundary, signed-in account editor, and bounded Jobs-only expired-proposal cleanup. This is
synthetic/local evidence. No connector or agent can submit a proposal, no public response projects
the active recipe, and no cleanup schedule or deployment is claimed.

## Closed shape

```json
{
  "schemaVersion": 1,
  "chassis": "rally",
  "nose": "scoop",
  "cockpit": "rally",
  "wing": "low",
  "wheels": "all-terrain",
  "palette": "sunburst",
  "trail": "spark",
  "seed": 42
}
```

The example is synthetic. Version 1 accepts exactly these values:

| Field           | Accepted value                                         |
| --------------- | ------------------------------------------------------ |
| `schemaVersion` | integer `1`                                            |
| `chassis`       | `formula`, `rally`, `roadster`                         |
| `nose`          | `classic`, `scoop`, `wedge`                            |
| `cockpit`       | `canopy`, `open`, `rally`                              |
| `wing`          | `high`, `low`, `none`                                  |
| `wheels`        | `all-terrain`, `slick`, `street`                       |
| `palette`       | `magenta`, `mint`, `redline`, `sunburst`, `turbo-blue` |
| `trail`         | `grid`, `none`, `spark`                                |
| `seed`          | integer from `0` through `65535`                       |

Unknown fields fail validation. A recipe cannot contain free text, arbitrary colors, remote URLs,
paths, files, HTML, CSS, SVG, drawing commands, scripts, shaders, binary assets, or conversation
content.

The canonical source is
[`contracts/v1/car-recipe.schema.json`](../../contracts/v1/car-recipe.schema.json). Generated
TypeScript and OpenAPI components are drift-checked; the local authenticated form routes are not
declared as public OpenAPI operations.

## Local lifecycle

1. A passkey-registered signed-in user submits the nine exact fields from `/account`.
2. Web validates the generated contract, derives authority from the active session, and creates a
   server proposal ID with at most 24 hours of logical validity.
3. PostgreSQL stores at most one private pending proposal per profile behind forced RLS.
4. The account page reads that proposal through the same session and renders it in Neon Night,
   Classic Grand Prix, and Cyber Rally.
5. Approval consumes an encrypted session-bound control, atomically replaces the active recipe, and
   deletes the pending row. Rejection deletes only that pending row.

The raw proposal ID and profile ID never enter HTML. The active recipe remains private to the
account until a separate public profile/score projection is designed and reviewed. Expired rows are
unusable immediately and eligible for bounded physical cleanup, but no scheduler invokes it.

## Rendering and assets

The renderer uses reviewable 16-by-8 indexed templates and deterministic transformations in
[`apps/web/lib/car-recipe.ts`](../../apps/web/lib/car-recipe.ts). The seed selects only a bounded
accent position and trail parity; it is not executable randomness. The account preview is server-
rendered as semantic code-native pixel cells, so it needs no remote image, inline user style, SVG,
or client-side schema interpreter. The animated synthetic race uses the same recipe renderer.

All palettes and cockpit/theme tokens are project-owned code data. The source/provenance record is
in [Asset provenance](ASSET_PROVENANCE.md). A version or enum must not silently change its visual
meaning; a breaking visual change uses a new recipe version or an explicit reviewed migration.

## Trust and authority

- A recipe changes presentation only. It grants no score, rank, prize, authorization, or valuable
  privilege.
- Community usage remains self-reported; a valid recipe says nothing about score truth.
- Source-bound device credentials cannot propose, approve, reject, or activate a recipe.
- The current proposal originates only from the signed-in browser. Future agent ingress must send
  this exact closed object without conversation text and needs its own authentication, admission,
  monitoring, and deployment review.

See [ADR 0005](../decisions/0005-enum-only-car-recipe.md),
[ADR 0035](../decisions/0035-bounded-session-car-recipe-proposal.md), security invariant
`VR-CAR-001`, and `VR-ABUSE-CAR-INJECTION`.
