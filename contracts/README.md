# Public protocol contracts

This directory is the language-neutral source of truth for Vibe Racing wire shapes. The current
files establish request and response boundaries plus one locally implemented public score operation;
revision 0007 maps the bounded Community sync into a database-only procedure and revision 0011
provides a database-only score projection. No connector, application signature verifier, deployed
endpoint, or live database credential exists.

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
- [`ConnectorSyncResultV1`](v1/connector-sync-result.schema.json) acknowledges accepted, duplicate,
  or quarantined input without returning a private anomaly reason.
- [`ProblemDetailsV1`](v1/problem-details.schema.json) returns a stable error code and request ID,
  plus one fixed generic title, never a stack trace, SQL detail, secret, request body, or internal
  hostname. A server-only Web factory now generates an opaque 128-bit request ID, fixes each
  status/title/retry mapping, validates the complete body, and emits `no-store`
  `application/problem+json`; its closed vocabulary now includes explicit 405 and 406 handling.
- [`manifest.json`](v1/manifest.json) defines the reviewed schema generation order, public
  type/export names, and the locally implemented `GET /v1/community/scores` operation with exact
  query, response, problem, cache, same-origin CORS, and repository-status policies.

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

- [`openapi.v1.json`](generated/openapi.v1.json), which exposes one locally implemented score path
  and explicitly states that repository implementation does not prove deployment;
- [`packages/contracts/src/generated.ts`](../packages/contracts/src/generated.ts), containing
  readonly TypeScript shapes, embedded schemas, source digest, and validator wrappers.

`pnpm run check:contracts` regenerates both artifacts in memory and fails on drift. Do not edit a
generated file to make a check pass.

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

Runtime validation is defense in depth after a service has already enforced content type and a small
raw-body limit. A future ingest parser must also reject duplicate object keys and excessive nesting
before ordinary object validation, and request signatures must bind the exact received body bytes.
Runtime traversal budgets do not replace edge limits, deadlines, backpressure, or database
constraints.
