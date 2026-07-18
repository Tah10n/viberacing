# ADR 0039: Bounded agent CarRecipe proposal orchestration

- Status: Accepted (local repository skill; connector release pending)
- Date: 2026-07-17
- Decision owners: Agent Workflow, Connector, Security, Privacy, and CarRecipe
- Supersedes: None
- Superseded by: None

## Context

ADRs 0035 through 0038 provide an exact browser proposal/decision boundary, a proposal-only signed
device route, and one fixed native connector command. Phase 4 still needs a conversational agent to
turn a user's styling intent into that command without adding conversation collection, a generic
connector escape hatch, a direct HTTP client, or device activation authority.

An instruction that merely says “call the connector” is insufficient. User-supplied origin and label
values can become shell input, an agent could drift from the canonical enums or CLI flags, and an
ambiguous POST must not trigger an automatic retry. The repository also has no supported or released
connector that an agent may silently discover or install.

## Decision

The repository owns one self-contained Agent Skill at
`.agents/skills/viberacing-propose-car/SKILL.md`. It reduces the user's existing styling request to
the exact seven `CarRecipeV1` enums plus schema version 1 and a 0-through-65535 seed. The skill
sends no prompt, conversation, free text, arbitrary color, URL, path, file, markup, arbitrary JSON,
profile ID, source ID, or proposal ID to Vibe Racing.

The user supplies the origin and already-paired device label explicitly. The skill never discovers,
downloads, builds, updates, or replaces the connector and never inspects credentials, environment,
browser state, logs, repositories, or processes to infer those values. Until a reviewed connector
release exists, it states that local development binaries are unsupported.

Before shell execution, the skill narrows the connector's accepted input further. The origin must be
a canonical HTTPS origin or explicit loopback HTTP origin with no credentials, path, query, or
fragment. The label must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`; every recipe value and the seed
are also single shell-safe tokens. The skill prefers an argument-vector tool and otherwise renders
one shell command only after those checks. It adds no quoting, redirection, environment assignment,
pipe, substitution, extra flag, or second command.

The only permitted process shape is the existing `viberacing-connector propose-car` command with the
eight fixed recipe-selection flags, explicit origin, and explicit label; the connector supplies the
constant schema version. The skill invokes it once, never retries an ambiguous result, and
recognizes success only from a successful exit plus the exact generic connector line. It never calls
`connect`, `sync`, App Server, direct HTTP, browser, or database capabilities.

The skill shows the reduced fields and explains that the result remains a private pending proposal.
Only the existing possessed browser session may approve or reject it. The skill cannot inspect
proposal state, activate a recipe, publish a profile, or claim that submission changed public state.

`scripts/check-agent-skills.mjs` cross-checks the skill's field inventory against the canonical JSON
Schema, its flag sequence and success line against the real Rust CLI, its exact executable examples,
front matter, UI metadata, safety instructions, and minimal directory shape. The checker and eleven
black-box mutation cases run inside the root verification gate.

## Security and privacy consequences

- This closes the local orchestration part of `VR-CAR-001` and `VR-ABUSE-CAR-INJECTION` without
  changing the Web, database, public API, App Server, or device-key authority boundaries.
- The agent environment may already process the user's request under its own product terms, but this
  skill neither forwards nor retains that text in Vibe Racing. Only the exact derived recipe reaches
  the existing signed proposal route.
- The narrower label grammar trades compatibility with labels containing spaces or punctuation for a
  shell-injection-resistant one-command workflow. Users with another existing label must use the
  connector directly or pair a separately reviewed safe label; the skill never rewrites it.
- A compromised agent can choose an unwanted pending recipe or consume proposal capacity using an
  already available active device, but it still cannot activate or publish the result. Browser
  review remains the authority boundary.
- No new dependency, service route, secret, retained field, third-party destination, analytics,
  cache, log, or release claim is added.

## Alternatives considered

- **Let the agent call HTTP directly:** rejected because it would duplicate signing, key custody,
  parser, transport, and response policy outside the reviewed connector.
- **Accept arbitrary JSON, stdin, or a recipe file:** rejected because it widens the fixed CLI and
  introduces an unnecessary file/content boundary.
- **Discover or install the connector automatically:** rejected until packaging, provenance,
  support, and clean-machine admission are implemented.
- **Retry a failed or ambiguous proposal:** rejected because the first request may have committed;
  browser review is the safe reconciliation path.
- **Let the agent approve the result:** rejected because a device or agent is not profile
  administration authority.

## Migration and rollback

This is an additive repository instruction and checker with no persisted-data or protocol change.
Rollback removes the skill, checker, scripts, and documentation while leaving the fixed connector
command and device route unchanged. A future packaged skill may replace this local path only after
the released connector identity, installation, upgrade, revoke, and uninstall workflow is reviewed;
it must preserve the same recipe-only and browser-decision boundary.

## Verification

- The standard skill validator shape is reproduced by the repository checker for exact two-key front
  matter, canonical naming, bounded size, and matching UI metadata.
- The checker derives all seven enum inventories and seed/version bounds from
  `car-recipe.schema.json`, then derives the fixed flag sequence and success line from Rust source.
- Eleven black-box mutations reject schema/enum drift, command widening, contradictory invocation
  input, unsafe origin/label grammar, retry permission, ambiguous-response overstatement, stale
  output, front-matter widening, and changed skill invocation metadata.
- Root documentation, architecture, spelling, formatting, public-file, Rust, and application gates
  continue to verify the complete public tree.

## References

- [ADR 0005](0005-enum-only-car-recipe.md)
- [ADR 0035](0035-bounded-session-car-recipe-proposal.md)
- [ADR 0038](0038-bounded-device-car-recipe-proposal-ingress.md)
- [CarRecipe reference](../reference/car-recipe.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
