# Race-broadcast design refresh

## Status

Status: **discussion reference**.

This direction preserves the current Vibe Racing identity while making the home page feel like a
weekly race broadcast instead of a sequence of generic dashboard cards. It does not change
`apps/web`, public contracts, scoring, baselines, trust tiers, or production capability state.

The detailed [Russian working translation](RACE_BROADCAST_REFRESH.ru.md) records the original
exploration. This English document is canonical for product truth and acceptance.

## Product idea

The product mechanics should determine the composition:

- **Track:** the primary scene and participant position.
- **Race board:** a compact current order with rank, car, handle, and score.
- **Driver inspector:** one synchronized detail surface for the selected participant.
- **Garage:** the closed deterministic CarRecipe shown as a visual object.
- **Steward desk:** visible Community methodology, privacy, and trust limits.
- **Ghost lap:** a local hypothetical projection that never enters standings.

This is not a new brand. It is a more consistent use of the existing pixel-racing metaphor.

## Stable visual system

The [brand and interface system](BRAND_SYSTEM.md) defines the reusable tokens and boundaries.

- Square frames, hard offset shadows, and code-native pixel cars remain.
- Neon Night, Classic Grand Prix, and Cyber Rally are treated as three venues with one shared
  information architecture.
- Heavy framing is limited to the race monitor and primary action. Other surfaces use rhythm,
  dividers, background, and typography.
- Monospace numerals remain for rank, score, freshness, and technical labels.
- A future display or reading font must support English and Russian, remain local or
  platform-native, have reviewed provenance and licensing, and satisfy the production asset budget.

## Page composition

### Compact race-control header

- Desktop uses one concise row for the wordmark, data state, primary navigation, and session action.
- Mobile prioritizes the wordmark, week state, and one menu action; display preferences remain
  available without occupying the visual center.
- Every interactive target is at least 44 by 44 CSS pixels.

### Race-day opening

- The current-week eyebrow, headline, race board, and visible trust strip form one opening scene.
- The race surface is visible without scrolling at 1280 by 720.
- Leading position and selected participant use distinct, non-color-only states.
- The primary action moves to complete standings or the available account/enrollment action.

### Standings and driver inspector

- A semantic list or table is the authoritative representation.
- Selecting a participant synchronizes the race position, row state, and inspector.
- Equal scores share rank; decorative ordering has no competitive meaning.
- Mobile keeps rank, car, handle, and score visible without horizontal body scrolling. Secondary
  detail moves into the selected participant inspector.

### Local ghost lap

- Input is explicitly hypothetical and local-only.
- It does not fetch, persist, prefill from account state, or mutate a standing.
- The ghost is visually distinct from both real and synthetic participants.

### Garage

- CarRecipe remains a closed enum rendered from deterministic repository-owned code.
- Active and proposal state retain their existing public/private boundaries.
- No arbitrary text, SVG, URL, upload, custom CSS, or user rendering command enters the scene.

### Steward desk

- Community methodology, privacy, and trust language stay visible without a modal or accordion.
- Copy states that Community data is self-reported and not audited, verified, or endorsed by any
  provider.
- Racing language does not imply equal compute or cost, verified provider identity, unique human
  identity, a global ranking, or a valuable reward.

## Responsive behavior

### Desktop

- Header, headline, race monitor, and the beginning of race order fit at 1280 by 720.
- Track and standings read as one composition.
- Hover supplements but never replaces focus and keyboard state.

### Tablet

- The race monitor remains first and full-width.
- Race order may become a horizontal strip only when its own scroll container is explicit.
- Inspector and ghost lap use two columns only when labels and controls retain their minimum size.

### Mobile

- The header is compact and the race surface precedes long explanatory copy.
- Standings become a vertical race order without horizontal body scrolling at 320, 390, and 430
  pixels.
- Selected participant detail is inline, not hover-only.
- Russian labels remain readable without clipping.

## Interaction and accessibility states

- **Synthetic:** visible badge and obviously synthetic participant data.
- **Community:** persistent self-reported label and only the current validated public contract.
- **Unavailable:** usable synthetic fallback with no internal error disclosure.
- **Selected:** one consistent current state across row and inspector, with an accurate accessible
  name.
- **Paused:** animation stops; data and navigation remain available.
- **Reduced motion:** system preference and the explicit control disable animation, transitions,
  trails, and smooth scrolling.
- **Forced colors:** semantic content, borders, focus order, and state labels remain meaningful
  without canvas color.

Keyboard order follows document order, focus is always visible, and color is never the only signal
for selected, current, paused, unavailable, or destructive state.

## Product and privacy constraints

- Publish only the deliberate weekly profile aggregate on the direct-token surface; never publish
  daily or per-source token totals.
- Do not add provider, model, daily detail, device count, private identifiers, or exact receipt time
  to the current public scene.
- Source count, streak, freshness, and CarRecipe never break a score or token tie.
- Portray direct `weeklyTokenTotal` only as a local Codex Community capability; do not portray the
  thin client, additional agents, MCP, Verified tier, or deployment as implemented.
- Do not add analytics, tracking, remote fonts, remote images, or browser persistence beyond locale,
  theme, and motion.
- Design EN/RU copy together and keep the provider-neutral trust meaning equivalent.

## Prototype acceptance

The standalone prototype is acceptable as a design reference only when:

- it is self-contained and performs no network request;
- it persists only locale, theme, and motion;
- all controls are keyboard reachable, visibly focused, and at least 44 by 44 CSS pixels;
- explicit and system reduced-motion modes stop animation and smooth scrolling;
- current participant state has an accurate accessible name;
- body width does not overflow at 320, 390, 430, 600, 768, 820, 1024, 1280, 1440, or 1920 pixels;
- EN/RU trust copy is provider-neutral;
- every participant and usage value is obviously synthetic;
- no private identifier, local path, OpenDesign run metadata, remote asset, or unsupported
  capability enters the file.

Passing this checklist does not mean the refresh is implemented. Production adoption still requires
an `apps/web` change, component tests, EN/RU parity, coverage, production build, artifact-budget
check, baseline decision, and explicit browser verification.

## Non-goals

- Changing scoring, public schemas, trust tiers, or privacy policy.
- Implementing proposed ADR 0068 or ADR 0069.
- Redesigning account, enrollment, recovery, pairing, or Admin flows.
- Adding dependencies, fonts, remote assets, telemetry, or a second product surface.
