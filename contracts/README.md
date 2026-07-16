# Public protocol contracts

This directory is the language-neutral source of truth for Vibe Racing wire shapes. The current
files establish request and response boundaries plus locally implemented public score and sync
operations; revision 0007 maps the bounded Community sync into a database-only procedure and
revision 0011 provides a database-only score projection. A local pure Ingest kernel now
authenticates and parses the exact bounded sync request, a separate local adapter constrains its
PostgreSQL mapping, and a transport-free application boundary composes them into validated
result/problem decisions. A separate bounded Fastify server factory now preserves the exact raw
request and serializes only those validated decisions. The candidate Rust connector now signs one
exact pairing-possession message behind inaccessible pending-key/challenge capabilities, then
separately composes exact unsigned body/device-message material and signs it behind an inaccessible
source-bound key capability. A server-only Web kernel strictly verifies the pairing proof against
the exact approved database material. One synthetic
[`test vector`](v1/connector-sync-device-request.test-vector.json) proves its body, digest, nonce,
message, public key, and signature against production Ingest code; a second vector proves the exact
Rust/Web pairing message and signature. A separate dormant Web/Auth boundary now composes protected
keyed poll lookup, that strict proof, and atomic activation locally. No operational connector, real
key generation/store, pairing start/approval or HTTP client/route, deployed endpoint, working
database credential, edge signer, host/port/TLS entry point, or composed live flow exists.

## Canonical version 1 schemas

- [`CommunityScorePageV1`](v1/community-score-page.schema.json) is a response-only top-32 score
  page. It fixes the trust tier to `community`, fixes `selfReported` to true, mirrors only the ten
  reviewed revision 0011 fields, and permits an empty result without private-state disclosure. It
  contains no profile/source/device ID, raw or daily usage, exact timestamp, car, streak, freshness,
  profile detail, cursor, or caller-controlled sorting/filtering.
- [`CommunityScoreQueryV1`](v1/community-score-query.schema.json) accepts exactly one inclusive
  Monday `seasonStart` from `1999-12-27` through `2099-12-28`. The Web URL parser rejects duplicate,
  missing, encoded-name, and unknown parameters before applying the generated value validator.
- [`ConnectorSyncV1`](v1/connector-sync.schema.json) accepts one bounded, self-reported Community
  snapshot from a source-bound device. It contains no trust tier, profile ID, rank, score, season,
  moderation state, account email, prompt, repository, credential, or server receipt time.
- [`connector-sync-authentication.json`](v1/connector-sync-authentication.json) fixes the exact
  method, target, media type, raw body/header/JSON budgets, required headers, canonical base64url
  and timestamp encodings, LF-separated origin/device proof messages, and bounded local HTTP
  transport policy. The local Ingest verifier binds both proofs to SHA-256 of the exact received
  body, rejects duplicate headers and decoded JSON keys, consumes a fresh origin nonce before body
  parsing or device lookup, validates `ConnectorSyncV1`, and verifies the source-bound signature
  under strict RFC 8032/FIPS semantics.
- [`connector-pairing-authentication.json`](v1/connector-pairing-authentication.json) fixes the
  domain-separated pairing-possession message over one canonical version-4 transaction ID, exact
  32-byte server challenge, and exact pending Ed25519 public key. It also records that exact poll
  possession, browser approval, unexpired pending-key state, and strict signature verification are
  all required before activation; the local pure verifier implements only the last check.
- [`connector-pairing-possession.test-vector.json`](v1/connector-pairing-possession.test-vector.json)
  fixes one synthetic pairing ID/challenge, exact message, public key, and signature shared by the
  Rust signer and Web verifier. It deliberately reuses the sync vector's synthetic public key and
  contains no private key or bearer token.
- [`connector-sync-device-request.test-vector.json`](v1/connector-sync-device-request.test-vector.json)
  fixes one synthetic exact body, SHA-256 digest, 16-byte nonce encoding, and canonical device
  message plus a synthetic public key/signature for cross-language Rust/Ingest verification. It
  contains no private key and is not a production request sample.
- [`ConnectorSyncResultV1`](v1/connector-sync-result.schema.json) acknowledges accepted, duplicate,
  or quarantined input without returning a private anomaly reason. The local Ingest application now
  reconstructs and validates this body only after verification and database settlement.
- [`ProblemDetailsV1`](v1/problem-details.schema.json) returns a stable error code and request ID,
  plus one fixed generic title, never a stack trace, SQL detail, secret, request body, or internal
  hostname. A server-only Web factory now generates an opaque 128-bit request ID, fixes each
  status/title/retry mapping, validates the complete body, and emits `no-store`
  `application/problem+json`; its closed vocabulary now includes explicit 405 and 406 handling.
- [`manifest.json`](v1/manifest.json) defines the reviewed schema generation order, public
  type/export names, closed authentication-policy inventory, and the locally implemented
  `GET /v1/community/scores` and `POST /v1/community/sync` operations with method-specific
  query/body, response, problem, no-queue, authentication, cache, same-origin CORS, and
  repository-status policies.

Every object rejects unknown fields. Every string, integer, array, identifier, version, date, and
timestamp is bounded. Reviewed date-range and ISO-weekday extensions make the score season boundary
executable instead of relying on prose. Dates use the upstream-neutral `codexReportedDate` name for
connector input; only `observedAt` uses a canonical UTC timestamp, and server receipt time remains
authoritative for replay and season deadlines. Duplicate sync dates and duplicate public display
positions are rejected by the documented `x-viberacing-uniqueBy` extension.

The token maximum is a numeric serialization safety bound, not an honesty claim. A valid signature
identifies the registered device, not the truth of self-reported usage. Server-side anomaly and
fair-use policies remain separate and do not become client-writable fields. Server-derived score and
trust fields exist only in the response component and never become writable connector input.

## Derived artifacts

`node scripts/generate-contracts.mjs` deterministically creates:

- [`openapi.v1.json`](generated/openapi.v1.json), which documents the two locally implemented HTTP
  operations and explicitly states that repository implementation does not prove deployment;
- [`packages/contracts/src/generated.ts`](../packages/contracts/src/generated.ts), containing
  readonly TypeScript shapes, embedded schemas, source digest, and validator wrappers.

`pnpm run check:contracts` regenerates both artifacts in memory and fails on schema, operation, or
policy-source drift. Do not edit a generated file to make a check pass.

## Change rules

1. Update the canonical schema and manifest operation, never the derived artifact first.
2. Preserve `additionalProperties: false` and explicit size/value bounds at every nested level.
3. Map each new field to the privacy data map and identify whether the client is allowed to write
   it. Server-derived trust, score, identity, moderation, and season fields stay absent from
   connector requests.
4. Add positive and negative runtime tests, regenerate, review the complete diff, and run
   `pnpm run verify`.
5. Use a new contract version or separately named component for a breaking wire change. Generated
   consumers reject unknown response fields, so do not silently expand or reinterpret an existing
   shape.

The local Ingest server preserves the exact body bytes and duplicate raw-header evidence, enforces
socket/parser/header/connection/time/admission bounds, rejects proxy and inbound request-ID trust,
and serializes only revalidated `no-store` success/problem contracts. The Ingest kernel enforces the
content type, raw envelope/parser budgets, duplicate object-key rejection, exact-body proofs,
generated contract, and strict device signature before returning a frozen allowlist. A protected
local factory supplies only one exact primary and optional secondary origin-key pair to that
verifier; no real key or deployment binding is present. The local application composer binds the
persistent replay/device/submission adapter, generates one request ID, and validates the closed
success/problem decision. A future deployment entry point may use only this server/application
composition through a deployment-provisioned Ingest login and verified TLS. The local transport
bounds one process but does not replace edge rate shaping, direct-origin denial, distributed
backpressure, capacity testing, monitoring, or database constraints.
