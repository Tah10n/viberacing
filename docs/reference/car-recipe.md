# CarRecipe version 1

## Status

`CarRecipeV1` is implemented locally as a language-neutral JSON Schema, generated TypeScript type
and validator, deterministic three-theme renderer, exact-session PostgreSQL proposal/approval
boundary, signed-in account editor, bounded device-authenticated proposal ingress, a fixed
native-store connector command, a checked local Agent Skill, Jobs-only expired-proposal cleanup, and
separate compatible public race projection. Proposal creation and approval are independently
default-off behind one exact local module decision while private read/reject remains available. This
is synthetic/local evidence; no cleanup schedule, released connector, live credential, edge control,
or deployment is claimed.

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
TypeScript and OpenAPI components are drift-checked. The device-authenticated proposal POST is a
closed local OpenAPI operation; the possessed-browser-session forms remain private application
routes.

## Local lifecycle

1. Either a passkey-registered signed-in user submits the nine exact fields from `/account`, or the
   fixed `propose-car` command submits the same exact object under a fresh source-bound device
   signature. The local Agent Skill can reduce existing style intent to that one command, but sends
   no prompt, conversation, profile ID, source ID, or proposal ID. Both origins and browser approval
   first require exact `VIBERACING_CAR_PROPOSALS_ENABLED=true` at their module boundaries.
2. Web validates the generated contract and derives authority from either the active session or an
   active device on an active source. It creates the proposal ID and at-most-24-hour expiry.
3. PostgreSQL stores at most one private pending proposal per profile behind forced RLS.
4. The account page reads that proposal through the same session and renders it in Neon Night,
   Classic Grand Prix, and Cyber Rally.
5. Approval consumes an encrypted session-bound control, atomically replaces the active recipe, and
   deletes the pending row. Rejection deletes only that pending row.

The raw proposal ID and profile ID never enter HTML. A separate `CommunityRacePageV1` may expose
only the current approved exact recipe for an `active` profile. It contains no proposal identity,
state, timestamp, private ID, or account authority, and the stable score response remains unchanged.
An absent recipe uses a repository-owned presentation fallback. Expired proposal rows are unusable
immediately and eligible for bounded physical cleanup, but no scheduler invokes it.

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
- An active source-bound device may create or replace only its bound profile's pending exact recipe
  through the dedicated signed route. It cannot read proposal state, approve, reject, activate, or
  administer the profile; paused, quarantined, unlinked, and revoked authority is denied.
- The fixed connector command accepts only explicit enum flags and a bounded seed, sends once
  without retry, and returns a generic acknowledgement. The local Agent Skill reduces style intent
  to this exact object, requires shell-safe explicit origin/label values, invokes only that command
  once, and never forwards conversation text to Vibe Racing.

See [ADR 0005](../decisions/0005-enum-only-car-recipe.md),
[ADR 0035](../decisions/0035-bounded-session-car-recipe-proposal.md),
[ADR 0037](../decisions/0037-bounded-public-community-race-projection.md), security invariant
[ADR 0038](../decisions/0038-bounded-device-car-recipe-proposal-ingress.md),
[ADR 0039](../decisions/0039-bounded-agent-car-proposal-orchestration.md),
[ADR 0059](../decisions/0059-fail-closed-car-proposal-enable-gate.md), security invariant
`VR-CAR-001`, and `VR-ABUSE-CAR-INJECTION`.
