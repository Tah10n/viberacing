# Architecture decision records

ADRs record durable decisions that change trust boundaries, public contracts, identity, data,
scoring, compatibility, deployment, release, or repository safety. They explain why a choice exists,
what it costs, how it is verified, and how it can be replaced.

## Index

| ADR                                                   | Decision                                                            | Status                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------- |
| [0000](0000-template.md)                              | Template                                                            | Template                                            |
| [0001](0001-community-trust-tier.md)                  | Community-only launch and disabled Verified tier                    | Accepted design; implementation pending             |
| [0002](0002-opaque-multi-source-aggregation.md)       | Opaque multi-source profiles with one profile cap                   | Accepted; pairing/lifecycle DB slices implemented   |
| [0003](0003-identity-step-up-and-device-authority.md) | GitHub identity, passkey step-up, and source-bound device authority | Accepted; identity/passkey/device DB implemented    |
| [0004](0004-edge-service-and-database-isolation.md)   | Cloudflare ingress plus service and database capability isolation   | Accepted; database roles implemented                |
| [0005](0005-enum-only-car-recipe.md)                  | Enum-only deterministic car customization                           | Accepted design; implementation pending             |
| [0006](0006-public-repository-boundary.md)            | Every tracked artifact is immediately public-safe                   | Accepted; repository controls partially implemented |

## Lifecycle

1. Copy [0000-template.md](0000-template.md) to the next four-digit number and a stable lowercase
   slug.
2. Start as `Proposed`. Link the issue or design evidence without embedding private discussion.
3. Obtain required product, security, privacy, compatibility, migration, and operations review.
4. Mark `Accepted` only when the decision is authoritative. “Accepted” does not claim its code is
   implemented; implementation status remains separate.
5. Never rewrite a materially changed historical decision. Add a new ADR with `Supersedes` and mark
   the old record `Superseded`.
6. Use `Deprecated` when the decision remains historical but new work must not depend on it.

Allowed statuses are `Proposed`, `Accepted`, `Rejected`, `Superseded`, and `Deprecated`, with an
optional parenthetical implementation note.

## Review triggers

An ADR is required before changing any [security invariant](../architecture/SECURITY_INVARIANTS.md),
collecting or publishing a new data class, enabling Verified ingestion or score-backed benefit,
changing identity/recovery/device authority, widening the Codex App Server surface, accepting
arbitrary content, merging runtime/database roles, adding a privileged workflow, or weakening
deletion and release evidence.
