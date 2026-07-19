# Architecture decision records

ADRs record durable decisions that change trust boundaries, public contracts, identity, data,
scoring, compatibility, deployment, release, or repository safety. They explain why a choice exists,
what it costs, how it is verified, and how it can be replaced.

## Index

| ADR                                                             | Decision                                                            | Status                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------ |
| [0000](0000-template.md)                                        | Template                                                            | Template                                               |
| [0001](0001-community-trust-tier.md)                            | Community-only launch and disabled Verified tier                    | Accepted; Community DB lifecycle implemented           |
| [0002](0002-opaque-multi-source-aggregation.md)                 | Opaque multi-source profiles with one profile cap                   | Accepted; aggregation/finalization DB implemented      |
| [0003](0003-identity-step-up-and-device-authority.md)           | GitHub identity, passkey step-up, and source-bound device authority | Accepted; identity/passkey/recovery/device DB          |
| [0004](0004-edge-service-and-database-isolation.md)             | Cloudflare ingress plus service and database capability isolation   | Accepted; role DB and bounded local adapters           |
| [0005](0005-enum-only-car-recipe.md)                            | Enum-only deterministic car customization                           | Accepted; v1 and local browser slice implemented       |
| [0006](0006-public-repository-boundary.md)                      | Every tracked artifact is immediately public-safe                   | Accepted; repository controls partially implemented    |
| [0007](0007-restricted-recovery-authority.md)                   | Recovery codes grant only short-lived passkey-replacement authority | Accepted; recovery DB capability implemented           |
| [0008](0008-community-season-grace-and-finalization.md)         | Server-time Community grace and immutable finalization              | Accepted; finalization DB and local runner             |
| [0009](0009-public-community-score-projection.md)               | Bounded active-only public Community score projection               | Accepted; score-read DB capability implemented         |
| [0010](0010-community-score-response-contract.md)               | Closed Community score response with explicit trust metadata        | Accepted; response schema/validators implemented       |
| [0011](0011-bounded-web-postgresql-score-adapter.md)            | Bounded least-privileged Web PostgreSQL score adapter               | Accepted; server-only adapter implemented              |
| [0012](0012-bounded-public-http-problem-boundary.md)            | Bounded request IDs and public HTTP problem responses               | Accepted; server-only factory implemented              |
| [0013](0013-public-community-score-http-contract.md)            | Closed query and local Community score GET                          | Accepted; implemented locally; deployment pending      |
| [0014](0014-bounded-community-maintenance-job-runner.md)        | Bounded one-shot Community maintenance runner                       | Accepted; local integration; scheduler pending         |
| [0015](0015-bounded-community-sync-verification-kernel.md)      | Bounded Community sync request verification kernel                  | Accepted; local kernel; integration pending            |
| [0016](0016-bounded-ingest-postgresql-adapter.md)               | Bounded least-privileged Ingest PostgreSQL adapter                  | Accepted; local adapter; live integration pending      |
| [0017](0017-protected-ingest-origin-key-configuration.md)       | Protected two-key Ingest origin proof configuration                 | Accepted; local reader; deployment pending             |
| [0018](0018-persistent-ingest-origin-replay-store.md)           | Persistent atomic Ingest origin replay consumption                  | Accepted; database and local adapter implemented       |
| [0019](0019-bounded-community-sync-application-composition.md)  | Bounded Community sync application composition                      | Accepted; local application boundary implemented       |
| [0020](0020-bounded-community-sync-fastify-http-boundary.md)    | Bounded Community sync Fastify HTTP boundary                        | Accepted; local server; deployment pending             |
| [0021](0021-fail-closed-codex-handshake-foundation.md)          | Fail-closed Codex App Server handshake foundation                   | Accepted; library-only protocol foundation             |
| [0022](0022-candidate-codex-account-usage-adapter.md)           | Candidate exact-version Codex account and usage adapter             | Accepted; candidate only; support pending              |
| [0023](0023-bounded-candidate-app-server-supervisor.md)         | Bounded candidate App Server process supervisor                     | Accepted; synthetic only; admission pending            |
| [0024](0024-bounded-candidate-community-sync-composer.md)       | Bounded candidate Community sync composer                           | Accepted; unsigned composition boundary                |
| [0025](0025-bounded-candidate-device-signing-boundary.md)       | Bounded candidate device signing boundary                           | Accepted; key store and transport pending              |
| [0026](0026-bounded-pairing-possession-proof.md)                | Bounded pairing possession proof                                    | Accepted; pure kernels; composed by ADR 0027           |
| [0027](0027-bounded-pairing-activation-composition.md)          | Bounded pairing activation composition                              | Accepted; local application; transport pending         |
| [0028](0028-bounded-pairing-start-composition.md)               | Bounded pairing start composition                                   | Accepted; local start; transport pending               |
| [0029](0029-bounded-pairing-retention-cleanup.md)               | Bounded pairing retention cleanup                                   | Accepted; database and local command; schedule pending |
| [0030](0030-bounded-connector-pairing-transport.md)             | Bounded connector pairing transport and native key custody          | Accepted; local vertical slice; deployment pending     |
| [0031](0031-one-shot-candidate-community-sync.md)               | One-shot exact-candidate Community sync                             | Accepted; Windows development slice; release pending   |
| [0032](0032-bounded-auth-retention-cleanup.md)                  | Bounded authentication retention cleanup                            | Accepted; database and local command; schedule pending |
| [0033](0033-bounded-railway-ingest-host.md)                     | Bounded Railway Ingest host                                         | Accepted; local entry point; deployment pending        |
| [0034](0034-bounded-profile-deletion-purge.md)                  | Bounded primary profile deletion purge                              | Accepted; database and local command; schedule pending |
| [0035](0035-bounded-session-car-recipe-proposal.md)             | Bounded session-owned CarRecipe proposal and approval               | Accepted; local Web/DB and agent path                  |
| [0036](0036-bounded-car-recipe-proposal-cleanup.md)             | Bounded CarRecipe proposal retention cleanup                        | Accepted; database and local command; schedule pending |
| [0037](0037-bounded-public-community-race-projection.md)        | Bounded public active-CarRecipe race projection                     | Accepted; local Web/DB slice; deployment pending       |
| [0038](0038-bounded-device-car-recipe-proposal-ingress.md)      | Bounded device CarRecipe proposal ingress                           | Accepted; local vertical slice; deployment pending     |
| [0039](0039-bounded-agent-car-proposal-orchestration.md)        | Bounded agent CarRecipe proposal orchestration                      | Accepted; local skill; connector release pending       |
| [0040](0040-bounded-public-community-race-status.md)            | Bounded public Community race status projection                     | Accepted; local Web/DB slice; deployment pending       |
| [0041](0041-bounded-local-connector-credential-removal.md)      | Bounded local connector credential removal                          | Accepted; local command; release evidence pending      |
| [0042](0042-bounded-expired-session-retention-cleanup.md)       | Bounded expired-session retention cleanup                           | Accepted; database and local command; schedule pending |
| [0043](0043-bounded-invite-retention-cleanup.md)                | Bounded invite retention cleanup                                    | Accepted; database and local command; schedule pending |
| [0044](0044-bounded-repository-verification-skill.md)           | Bounded repository verification orchestration                       | Accepted; local read-only skill implemented            |
| [0045](0045-bounded-terminal-deletion-job-retention-cleanup.md) | Bounded terminal deletion-job retention cleanup                     | Accepted; database and local command; schedule pending |
| [0046](0046-bounded-audit-event-retention-cleanup.md)           | Bounded database audit-event retention cleanup                      | Accepted; database and local command; schedule pending |
| [0047](0047-bounded-pairing-approval-provenance-retention.md)   | Bounded pairing approval-provenance retention                       | Accepted; database and local command; schedule pending |

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
