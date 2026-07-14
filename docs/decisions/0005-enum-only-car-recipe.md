# ADR 0005: Enum-only deterministic car customization

- Status: Accepted (design; implementation pending)
- Date: 2026-07-14
- Decision owners: Contracts, Web, UI, and Pixel Assets
- Supersedes: None
- Superseded by: None

## Context

The product needs expressive pixel-art cars and may let an agent propose a customization. Arbitrary
image/file/URL/markup input would create XSS, SSRF, parser, storage, copyright, privacy, moderation,
and nondeterministic rendering surfaces that are unrelated to the core race.

Agent conversation text is also unnecessary for the service to render a car.

## Decision

Define a strict versioned `CarRecipe` containing only project-owned enums for reviewed parts and
palette/trail choices plus a bounded seed. Reject free text, arbitrary color, path, file, URL, HTML,
SVG, CSS, script, shader, archive, image, or unknown field.

The server validates before persistence. Rendering is deterministic across all supported themes. An
agent can propose only the recipe object; the browser previews it and the user explicitly approves
before replacing the active car. Device credentials cannot approve or activate a recipe.

Prefer reviewable indexed source assets. Generated sprite sheets identify source and command and are
checked for drift. Every font/binary has authorship, license, checksum, and attribution evidence.

## Security and privacy consequences

The bounded schema removes executable and remote-content classes and avoids collecting conversation
text. Project-owned asset combinations still need trademark/trade-dress and accessibility review.
The recipe is public once active; rejected proposals remain private and short-lived.

Determinism becomes a cross-language/version compatibility requirement. A recipe version cannot
silently change visual meaning for an existing public profile.

## Alternatives considered

- **Image upload:** rejected for file parsing, metadata, moderation, storage, license, and privacy
  risk.
- **Remote image URL:** rejected for SSRF, tracking, content drift, and availability.
- **User SVG/HTML/CSS:** rejected because sanitization would become a critical browser boundary.
- **Arbitrary JSON drawing commands:** still an executable-like renderer language and too broad.
- **Fixed cars only:** lowest risk, but loses meaningful customization; bounded enums preserve most
  value.

## Migration and rollback

New parts or meaning require a new recipe version and renderer fixtures. Existing versions remain
renderable or migrate through an explicit deterministic mapping approved by the user when appearance
changes materially.

If a recipe or asset is unsafe, disable that version/enum, restore a safe project default, preserve
a non-sensitive audit reason, and regenerate derived sheets. Never fall back to rendering unknown
content.

## Verification

- Schema rejects files, URLs, markup, arbitrary colors, unknown enums/fields, oversized input, and
  invalid seeds.
- TypeScript/Rust/schema fixtures encode the same canonical recipe.
- Deterministic visual snapshots cover every theme, reduced motion, and accessibility
  representation.
- Proposal/approval authorization tests prove devices and agents cannot activate a car.
- Asset provenance, license, generated-drift, metadata, and trade-dress review gates pass.

## References

- [Project plan CarRecipe section](../PROJECT_PLAN.md#carrecipe-and-pixel-assets)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
- [Car injection abuse case](../security/ABUSE_CASES.md#vr-abuse-car-injection-executable-or-remote-content-in-customization)
