# Compatibility policy

## Principle

Compatibility is explicit evidence, not a broad version guess. Vibe Racing fails closed when an
upstream schema, public contract, signing format, scoring rule, or stored-data expectation is
unknown. The [Codex compatibility matrix](../reference/codex-compatibility.md), rather than this
policy, records whether any exact Codex and connector combination is currently supported.

## Version axes

| Axis                    | Version owner                                                            | Compatibility rule                                                                                        | Breaking-change path                                                               |
| ----------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Codex App Server schema | Installed Codex release                                                  | Exact pinned entries in the [Codex matrix](../reference/codex-compatibility.md)                           | Add generated schema/fixtures and connector adapter; unknown versions stop locally |
| Connector CLI/binary    | Vibe Racing connector release                                            | Semantic version plus published supported service/API range                                               | Signed release, migration notes, minimum-version policy, rollback/revoke plan      |
| Connector sync schema   | `schemaVersion` in `contracts/v1`                                        | Server validates one documented version at a time with bounded overlap                                    | New schema version; explicit deprecation window; no silent reinterpretation        |
| Public HTTP API         | Path such as `/v1`                                                       | Additive compatible fields only when old clients ignore them by contract; unknown request fields rejected | New path version or documented migration                                           |
| CarRecipe               | Recipe version and enum set                                              | Renderer and server share exact versioned enums/assets                                                    | New recipe version, deterministic migration or safe fallback                       |
| Scoring                 | Season `scoreVersion`                                                    | Fixed for an entire season; finalized scores are not rewritten                                            | New version begins only with a new season and public simulator/update              |
| Season closure          | [ADR 0008](../decisions/0008-community-season-grace-and-finalization.md) | Community grace ends Wednesday 00:00 UTC after the ISO week; existing definitions are immutable           | Superseding ADR and future-season compatibility plan; never extend existing grace  |
| Database schema         | Migration revision                                                       | Expand-and-contract across deployed application overlap                                                   | Reviewed migration, backup/restore evidence, rollback or forward-fix               |
| Edge origin proof       | Proof version/key epoch                                                  | Edge and origin accept only reviewed bounded overlap                                                      | Coordinated key/version rotation; fail closed outside overlap                      |
| Release metadata        | SBOM, provenance, checksum, signature formats                            | Artifact and verification instructions identify exact formats                                             | Dual-publish during migration, then revoke old trust root explicitly               |

These axes are independently versioned. A connector version does not imply a database migration or
scoring change, and a web deployment does not silently change a finalized season.

Revision 0011's internal PostgreSQL score projection is not itself a public HTTP contract. ADR 0010
defines a closed response-only v1 component and generated derivatives, while ADR 0013 now adds the
local path, request validation, exact mapping, response headers, no-store policy, and compatibility
evidence. Deployment, edge behavior, and any future cache remain separate compatibility surfaces.

## Codex App Server contract

The official [Codex App Server documentation](https://learn.chatgpt.com/docs/app-server) describes a
required `initialize`/`initialized` handshake, version-specific schema generation, local stdio as
the default transport, and a separate opt-in for experimental API capability. The final connector
must therefore:

- launches a reviewed Codex executable locally and uses stdio only;
- sends the required handshake once per connection;
- omits experimental API capability;
- rejects WebSocket, Unix-socket, thread, turn, item, approval, MCP, file, shell, login, and unknown
  methods;
- plans to allowlist only the account-mode and usage reads named in the implementation plan, but
  does not treat those names as supported until a pinned release's generated stable schema and
  synthetic fixtures prove them;
- extracts only the bounded mode decision, reported date, and token value needed locally; account
  email and other response fields never enter the egress contract;
- stops before upload on missing fields, unknown fields, malformed dates, oversized output, protocol
  errors, unsupported auth mode, or schema drift.

The Rust library implements the fixed stable handshake plus a candidate-only Codex `0.144.4`
account/usage parser. After the handshake, it emits only fixed IDs `1` and `2`, confirms ChatGPT
mode, discards email/plan/summary fields, and returns at most 31 sorted unique date/token buckets
under the sync bounds. The candidate manifest records release metadata, full generated schema
digests, minimal extracts, fixtures, and unresolved blockers. A one-shot supervisor now composes
those exact state machines through a fixed `app-server` argument, local pipes, a capability-owned
working directory/environment, bounded output/time, and reap-before-success cleanup. The capability
has no public constructor. A second inaccessible reviewed context now permits exact unsigned
`ConnectorSyncV1` body, SHA-256 digest, nonce, and device-message composition from that candidate
output. The library still cannot discover or admit an executable, construct either context, execute
the selected official artifact, store a key, sign, upload, negotiate support, or alter the empty
matrix. ADRs 0021 through 0024 record those distinctions.

Generated schema output is exact to the Codex version that produced it. The repository commits only
reviewed relevant schema extracts and synthetic fixtures, not account data or a developer's local
configuration.

`scripts/check-codex-compatibility.mjs` requires canonical duplicate-free evidence files, verifies
their byte counts and digests, closes the method/fixture inventory, and forbids a candidate manifest
from appearing in the supported matrix. A future supported manifest must have a matching matrix row
and no unresolved blockers.

## Codex support matrix process

For each proposed Codex version:

1. Obtain the release from its canonical signed/published channel and record immutable provenance.
2. Generate the stable App Server JSON schema with experimental capability disabled.
3. Diff the full account-related schema against the prior supported release.
4. Extract the minimal reviewed contract and generate synthetic positive, nullable, missing,
   malformed, oversized, and unknown-field fixtures.
5. Run connector handshake, parsing, privacy-egress, timeout, overload, and child-cleanup tests on
   Windows, macOS, and Linux where supported.
6. Record schema digest, release provenance, connector range, test evidence, limitations, and review
   in the public matrix.
7. Release a signed connector only after the matrix entry merges through protected review.

A scheduled non-blocking probe may report a newer Codex release, but it cannot silently widen the
support matrix or publish a connector.

## Date and time semantics

The planned upstream date is treated as `codexReportedDate`, a strict `YYYY-MM-DD` label. Until a
pinned upstream contract documents a timezone, Vibe Racing does not call it UTC or reinterpret it
through local timezone conversion.

- Season grouping uses the reported calendar label with ISO Monday boundaries.
- Server `receivedAt`, never connector time, controls replay windows, grace deadlines, and
  finalization.
- Community grace is 48 hours after the next Monday begins and closes inclusively at Wednesday 00:00
  UTC under [ADR 0008](../decisions/0008-community-season-grace-and-finalization.md).
- Clock-skew policy is bounded and deployment-configured; client time cannot reopen a season.
- An upstream timezone clarification requires an ADR, compatibility update, migration analysis, and
  tests against existing season labels.

## API and schema rules

- Requests with a body declare a supported schema version and content type and remain under explicit
  byte, collection, string, integer, and timestamp bounds. URL-only reads use the versioned path and
  a closed query contract instead of inventing a body content type.
- Unknown request fields are rejected. Responses may gain additive fields only where clients are
  documented and tested to ignore them safely.
- `CommunityScorePageV1` is closed and its generated consumers reject unknown fields; extend it only
  through a separately reviewed component/version, not an unannounced additive response field.
- The reviewed `x-viberacing-dateMinimum`, `x-viberacing-dateMaximum`, and `x-viberacing-isoWeekday`
  keywords are executable contract semantics. A consumer that treats them as inert annotations
  cannot be the server admission validator for a score season.
- Client-writable schemas exclude profile identity, accepted source binding, trust tier, score,
  rank, streak, season, server receipt time, moderation, and deletion state.
- Errors use a versioned bounded problem-details shape and request ID without stack, SQL, hostname,
  secret, or record disclosure. The common server-only factory now enforces the closed mapping,
  generated opaque ID, runtime validation, and no-store response baseline. The manifest-generated
  public score operation and local Web route enforce the same query, response, status, cache,
  same-origin, and implementation-status contract. This does not claim deployment or make future
  `/v1` operations implicitly compatible.
- Generated OpenAPI, TypeScript, Rust fixtures, and documentation identify their canonical schema
  source; CI rejects drift.

## Deprecation and emergency block

Normal deprecation publishes the affected versions, reason, replacement, support window, user
impact, and verification steps before enforcement. The server may require a minimum connector
version only after signed replacements exist and staged rollout/rollback has been exercised.

An actively dangerous connector or contract may be blocked faster. The project publishes a security
advisory when safe, distinguishes compromised from merely unsupported versions, revokes affected
artifacts/keys where possible, and never restores compatibility by disabling signature, origin,
schema, or privacy checks.

## Compatibility evidence

Every compatibility claim links to immutable fixtures and CI results. “Works on latest,” an
unbounded semantic-version range, a developer's successful local run, or absence of a reported bug
is not evidence. Unsupported paths return a clear local/service error and must not upload a partial
interpretation.
