# Public protocol contracts

This directory is the language-neutral source of truth for Vibe Racing wire shapes. The current
files establish request and response boundaries plus locally implemented public score, race, and
sync operations; revision 0007 maps the bounded Community sync into a database-only procedure,
revision 0041 adds server-owned provider attribution and a separate Usage Sync wrapper, revision
0011 provides a database-only score projection, and revision 0027 adds a compatible active-recipe
race projection. A local pure Ingest kernel now authenticates and parses the exact bounded sync
request, a separate local adapter constrains its PostgreSQL mapping, and a transport-free
application boundary composes them into validated result/problem decisions. A separate bounded
Fastify server factory now preserves the exact raw request and serializes only those validated
decisions. The candidate Rust connector now signs one exact pairing-possession message, then
separately composes exact unsigned body/device-message material and signs it behind an inaccessible
source-bound key capability. A server-only Web kernel strictly verifies the pairing proof against
the exact approved database material. A separate proposal-only Rust/Web path now shares an exact
`CarRecipeV1` body/device-signature vector and never grants activation authority. One legacy
[`sync vector`](v1/connector-sync-device-request.test-vector.json) and one current
[`UsageSyncV1` vector](v1/connector-usage-sync-device-request.test-vector.json) prove exact bodies,
digests, nonces, messages, public keys, and signatures against production Ingest code; another
vector proves the exact Rust/Web pairing message and signature. Local Web/Auth boundaries now
compose a generated nine- minute pairing start, protected keyed poll lookup, strict proof, and
atomic activation through exact versioned routes. Local Rust commands retain the real key in the
native OS credential store and exercise pairing, one exact candidate sync, and proposal-only
signing. No released or supported connector, real-account Codex result, deployed endpoint, working
database credential, edge signer, trusted external TLS/edge route, or composed live flow exists. A
separate local Ingest host can now bind the reviewed application/server composition under a closed
loopback or explicitly declared Railway-edge listener contract; that local executable evidence does
not establish any of those deployment claims. An opt-in synthetic integration now carries
independently signed requests through the emitted host, a disposable least-privileged Ingest login,
and the reviewed PostgreSQL procedures. It proves the closed response and persistence contract
locally, not protected secret delivery, external TLS/edge routing, production credentials, real-user
input, or capacity.

## Canonical version 1 schemas

- [`CarRecipeV1`](v1/car-recipe.schema.json) is the exact nine-field customization object used by
  the local deterministic renderer and session-owned proposal boundary. It fixes version 1,
  project-owned body/part/palette/trail enums, and an integer seed from 0 through 65535. It rejects
  arbitrary color, text, URL, path, file, markup, drawing command, conversation, and unknown fields.
  The dedicated device-authenticated proposal POST uses it as a request contract; authenticated
  browser decision forms remain private application routes.
- [`connector-car-proposal-authentication.json`](v1/connector-car-proposal-authentication.json)
  fixes the 512-byte exact-body route, parser/header budgets, fresh 16-byte nonce, canonical time,
  and domain-separated Ed25519 message. Web verifies it only against an active source-bound device.
- [`connector-car-proposal-device-request.test-vector.json`](v1/connector-car-proposal-device-request.test-vector.json)
  fixes one synthetic exact recipe body, digest, nonce, timestamp, public key, message, and
  signature shared by Rust and Web. It contains no private key or real identifier.
- [`ConnectorCarProposalResultV1`](v1/connector-car-proposal-result.schema.json) returns only one
  generic accepted acknowledgement and request ID; it exposes no proposal/profile/source identity.
- [`CommunityScorePageV1`](v1/community-score-page.schema.json) is a response-only top-32 score
  page. It fixes the trust tier to `community`, fixes `selfReported` to true, mirrors only the ten
  reviewed revision 0011 fields, and permits an empty result without private-state disclosure. It
  contains no profile/source/device ID, raw or daily usage, exact timestamp, car, streak, freshness,
  profile detail, cursor, or caller-controlled sorting/filtering.
- [`CommunityRacePageV1`](v1/community-race-page.schema.json) preserves the same trust metadata,
  page bound, ten score fields, and ordering while allowing exactly one optional canonical
  `CarRecipeV1` per participant. Its absence means no approved active recipe. Proposal identity,
  state, timestamps, private IDs, daily/raw usage, and arbitrary content remain forbidden. The
  stable `CommunityScorePageV1` remains unchanged and rejects this additional field.
- [`CommunityRaceStatusPageV1`](v1/community-race-status-page.schema.json) is a separate compatible
  race component. It preserves the race fields, requires one UTC-day-rounded `freshnessDays`, and
  permits `streakDays` only when the profile has enabled public streak visibility. Exact receipt
  timestamps, underlying daily scores, preferences, private IDs, and proposal state remain
  forbidden. Both older page components remain unchanged and reject these status fields.
- [`CommunityScoreQueryV1`](v1/community-score-query.schema.json) accepts exactly one inclusive
  Monday `seasonStart` from `1999-12-27` through `2099-12-28`. The Web URL parser rejects duplicate,
  missing, encoded-name, and unknown parameters before applying the generated value validator.
- [`ConnectorSyncV1`](v1/connector-sync.schema.json) accepts one bounded, self-reported Community
  snapshot from a source-bound device. It contains no trust tier, profile ID, rank, score, season,
  moderation state, account email, prompt, repository, credential, or server receipt time.
- [`UsageSyncV1`](v1/usage-sync.schema.json) is the additive provider-neutral request for exact
  `POST /v1/community/usage`. It carries only opaque source/sync IDs, canonical observation time,
  client/agent versions, and one through 31 unique date/daily-total pairs. Provider and accounting
  revision are deliberately absent and derived from the registered source.
- [`connector-usage-sync-authentication.json`](v1/connector-usage-sync-authentication.json) retains
  the sync proof and transport policy but binds both signatures to the separate Usage Sync path. The
  Edge and Ingest implementations keep that route absent unless their exact independent
  `VIBERACING_USAGE_SYNC_ENABLED=true` decision is present.
- [`connector-usage-sync-device-request.test-vector.json`](v1/connector-usage-sync-device-request.test-vector.json)
  fixes the current candidate connector's exact `UsageSyncV1` body, SHA-256 digest, nonce,
  path-bound device message, public key, and signature for Rust/Ingest verification. It contains no
  private key or real identifier.
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
- [`ConnectorPairingStartV1`](v1/connector-pairing-start.schema.json) accepts one closed anonymous
  public-key and bounded device-metadata request. It contains no account, usage, poll secret,
  source, or device binding.
- [`ConnectorPairingStartResultV1`](v1/connector-pairing-start-result.schema.json) returns the one-
  time poll token, possession challenge, short user code, expiry, and server request ID only after
  the pending transaction is committed.
- [`ConnectorPairingPollV1`](v1/connector-pairing-poll.schema.json) accepts the short-lived poll
  token plus the exact Ed25519 possession signature and no caller-selected identity or binding.
- [`ConnectorPairingPollResultV1`](v1/connector-pairing-poll-result.schema.json) returns either an
  empty pending array or exactly one activated source/device binding. Generic problem responses
  cover invalid, expired, rejected, and unavailable states without reflecting private reasons.
- [`connector-pairing-transport.json`](v1/connector-pairing-transport.json) fixes the two POST
  paths, body budgets, anonymous client-ID header, four-call local admission, fixed
  global-and-64-bucket database shaping, no-store policy, and same-origin/no-CORS response boundary.
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
- [`UsageSyncResultV1`](v1/usage-sync-result.schema.json) preserves the same closed acknowledgement
  vocabulary for the additive Usage Sync operation without exposing derived source attribution.
- [`ProblemDetailsV1`](v1/problem-details.schema.json) returns a stable error code and request ID,
  plus one fixed generic title, never a stack trace, SQL detail, secret, request body, or internal
  hostname. A server-only Web factory now generates an opaque 128-bit request ID, fixes each
  status/title/retry mapping, validates the complete body, and emits `no-store`
  `application/problem+json`; its closed vocabulary now includes explicit 405 and 406 handling.
- [`manifest.json`](v1/manifest.json) defines the reviewed schema generation order, public
  type/export names, closed authentication-policy inventory, and the locally implemented nine
  operations: the four Community score/race/status/token GETs, `POST /v1/community/sync`,
  `POST /v1/community/usage`, `POST /v1/connector/cars/proposals`, and the two pairing start/poll
  POST routes, with method-specific query/body, response, problem, no-queue, authentication, cache,
  same-origin CORS, and repository-status policies.

Every object rejects unknown fields. Every string, integer, array, identifier, version, date, and
timestamp is bounded. Reviewed date-range and ISO-weekday extensions make the score season boundary
executable instead of relying on prose. The legacy contract retains `codexReportedDate`; the new
provider-neutral request uses `reportedDate`, and connector input; only `observedAt` uses a
canonical UTC timestamp, and server receipt time remains authoritative for replay and season
deadlines. Duplicate sync dates and duplicate public display positions are rejected by the
documented `x-viberacing-uniqueBy` extension.

The token maximum is a numeric serialization safety bound, not an honesty claim. A valid signature
identifies the registered device, not the truth of self-reported usage. Server-side anomaly and
fair-use policies remain separate and do not become client-writable fields. Server-derived score and
trust fields exist only in the response component and never become writable connector input.

## Derived artifacts

`node scripts/generate-contracts.mjs` deterministically creates:

- [`openapi.v1.json`](generated/openapi.v1.json), which documents the eight locally implemented HTTP
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
success/problem decision. ADR 0033's separate local host binds only this server/application
composition through exact listener modes and bounded process shutdown. Its `railway-edge` value is
an operator declaration, not proof of a provisioned Ingest login, external TLS, or trusted edge
route. The local transport bounds one process but does not replace edge rate shaping, direct-origin
denial, distributed backpressure, capacity testing, monitoring, or database constraints.
`pnpm run test:ingest:postgres-integration` additionally checks the complete synthetic loopback
contract against disposable PostgreSQL, including accepted, duplicate, replay, and revoked-device
decisions plus exact stored state. It also observes four valid requests blocked at the first
replay-store call, rejects a fifth without a fifth replay call, and validates the four accepted
responses after release; this is no-queue correctness evidence, not capacity testing.
