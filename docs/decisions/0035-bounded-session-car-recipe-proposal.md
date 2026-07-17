# ADR 0035: Bounded session-owned CarRecipe proposal and approval

- Status: Accepted (local Web/Auth slice; retention composed by ADR 0036)
- Date: 2026-07-17
- Decision owners: Contracts, Web/Auth, Database, and Pixel Assets
- Supersedes: None
- Superseded by: None

## Context

ADR 0005 fixes the safe customization shape, but a schema and renderer alone do not establish who
may propose, inspect, approve, reject, or retain a recipe. A browser flow must not accept a profile
identifier, expose a reusable proposal identifier, let a device activate a car, or turn agent
conversation into stored input. The database also needs one atomic transition from private pending
state to the active recipe.

This slice is deliberately session-owned. It proves the browser and persistence decision boundary;
ADR 0038 later adds a separate device-authenticated proposal-only origin without decision authority.

## Decision

`CarRecipeV1` is the canonical closed object. Version 1 contains exactly `schemaVersion`, `chassis`,
`nose`, `cockpit`, `wing`, `wheels`, `palette`, `trail`, and an integer `seed` from 0 through 65535.
The generated validator runs before persistence. Free text, arbitrary color, URL, path, file,
markup, SVG, script, conversation, and unknown fields are rejected.

The local account flow uses three same-origin, form-encoded POST boundaries:

- proposal accepts the nine exact recipe fields under a 512-byte body limit;
- approval accepts one opaque proposal control under a 1,200-byte body limit;
- rejection accepts the same one-field control and no recipe data.

All three use the shared four-call no-queue Web admission boundary and a passkey-registered active
session. The application hashes a canonical 32-byte session verifier, creates the proposal ID and
24-hour maximum expiry server-side, and passes no caller-selected profile ID to PostgreSQL.

Revision 0025 adds two forced-RLS tables and four `viberacing_api` functions. There is at most one
pending proposal and one active recipe per profile. Only the probed Web role may execute the
functions; Ingest, Jobs, Admin, and direct table access are denied. Every capability derives the
profile from the exact session ID and verifier digest. Approval locks the session/profile and
proposal, copies the exact recipe into the active row, and deletes the proposal in one transaction.
Rejection deletes only the matching pending proposal. A replaced, approved, rejected, or
profile-deleted proposal is removed.

The account read seals the proposal ID, session ID, and the lesser of session/proposal expiry into a
purpose-separated `car-proposal` AES-GCM control. The raw proposal ID is not rendered. The service
requires exact control shape, current expiry, and the same session before a decision. Active and
pending recipes are rendered from code-native indexed pixels in every theme; the browser receives
neither arbitrary drawing input nor a schema runtime.

## Security and privacy consequences

- This implements security invariant `VR-CAR-001` and the local controls for
  `VR-ABUSE-CAR-INJECTION`.
- A Web session can propose and approve only for its own derived profile. Under ADR 0038 an active
  source-bound device may only create or replace that profile's pending exact recipe; it cannot
  inspect, approve, reject, or activate it.
- A pending recipe is Account data. The active recipe is designed to be public, but no public score
  or profile projection returns it yet.
- Expiry makes a proposal unusable after at most 24 hours. ADR 0036 now adds a separate bounded
  Jobs-only physical cleanup capability; replacement, explicit decision, or profile purge can also
  remove the row. No production schedule or retention cadence exists.
- The browser proposal flow is now joined by ADR 0038's isolated local connector ingress. Neither
  path has kill-switch configuration, distributed edge rate control, live Web/database credential,
  scheduled cleanup, monitoring, capacity evidence, or deployment.

## Alternatives considered

- **Let the connector activate a recipe:** rejected because a source-bound device cannot administer
  a profile.
- **Put the proposal ID in HTML:** rejected because a session-bound opaque control gives a narrower
  replay and IDOR surface.
- **Store arbitrary JSON and validate on read:** rejected because invalid or widened state could
  persist and later reach a renderer.
- **Persist conversation text for context:** rejected because the closed recipe is sufficient and
  conversation collection has no product need.
- **Treat expiry as physical deletion:** rejected as an implementation claim until a reviewed Jobs
  capability and schedule exist.

## Migration and rollback

Revision 0025 is additive. An application rollback can stop calling the four new functions while the
tables remain inaccessible to runtime roles. A database rollback before release may drop the
functions, policies, indexes, and empty tables under the normal migration review; deployed data is
handled only by a forward migration. Changing enum meaning or accepted fields requires a new recipe
version rather than reinterpreting stored version 1 rows.

## Verification

- Contract generation and drift checks cover the exact schema and reject remote/executable/free-
  form fields, invalid versions, unknown enums, and seed overflow.
- Renderer tests cover every part axis, exact readable sprite snapshots, every theme/palette, and
  the all-theme account preview without browser-side schema code.
- Service and HTTP tests cover session authority, verifier hashing and clearing, opaque control
  binding/tamper/expiry, CSRF origin, exact paths/media/forms, duplicate/unknown fields, body
  bounds, overload, missing cookies, and contained dependencies.
- Pool/mapper tests cover fixed statements, copied-secret clearing, exact 20-column state, malformed
  rows, and destructive release.
- The isolated PostgreSQL suite covers propose/read/approve/reject, replay, replacement,
  cross-profile denial, hidden-profile use, role denial, constraints, and profile-deletion cascade.

## References

- [ADR 0005](0005-enum-only-car-recipe.md)
- [CarRecipe reference](../reference/car-recipe.md)
- [Migration 0025](../../database/migrations/0025_car_recipe_proposals.sql)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Car injection abuse case](../security/ABUSE_CASES.md#vr-abuse-car-injection-executable-or-remote-content-in-customization)
- [ADR 0036](0036-bounded-car-recipe-proposal-cleanup.md)
- [ADR 0038](0038-bounded-device-car-recipe-proposal-ingress.md)
