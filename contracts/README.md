# Public protocol contracts

This directory is the language-neutral source of truth for Vibe Racing wire shapes. The current
files establish a pre-implementation boundary; they do not claim that an API endpoint, connector,
database, or deployment exists.

## Canonical version 1 schemas

- [`ConnectorSyncV1`](v1/connector-sync.schema.json) accepts one bounded, self-reported Community
  snapshot from a source-bound device. It contains no trust tier, profile ID, rank, score, season,
  moderation state, account email, prompt, repository, credential, or server receipt time.
- [`ConnectorSyncResultV1`](v1/connector-sync-result.schema.json) acknowledges accepted, duplicate,
  or quarantined input without returning a private anomaly reason.
- [`ProblemDetailsV1`](v1/problem-details.schema.json) returns a stable error code and request ID,
  plus one fixed generic title, never a stack trace, SQL detail, secret, request body, or internal
  hostname.
- [`manifest.json`](v1/manifest.json) defines the reviewed generation order and public type/export
  names.

Every object rejects unknown fields. Every string, integer, array, identifier, version, date, and
timestamp is bounded. Dates use the upstream-neutral `codexReportedDate` name; only `observedAt`
uses a canonical UTC timestamp, and server receipt time remains authoritative for replay and season
deadlines. Duplicate dates in one sync are rejected by the documented `x-viberacing-uniqueBy`
extension.

The token maximum is a numeric serialization safety bound, not an honesty claim. A valid signature
identifies the registered device, not the truth of self-reported usage. Server-side anomaly and
fair-use policies remain separate and do not become client-writable fields.

## Derived artifacts

`node scripts/generate-contracts.mjs` deterministically creates:

- [`openapi.v1.json`](generated/openapi.v1.json), which currently exposes components with no paths
  and explicitly states that no endpoint is implemented;
- [`packages/contracts/src/generated.ts`](../packages/contracts/src/generated.ts), containing
  readonly TypeScript shapes, embedded schemas, source digest, and validator wrappers.

`pnpm run check:contracts` regenerates both artifacts in memory and fails on drift. Do not edit a
generated file to make a check pass.

## Change rules

1. Update the canonical schema and manifest, never the derived artifact first.
2. Preserve `additionalProperties: false` and explicit size/value bounds at every nested level.
3. Map each new field to the privacy data map and identify whether the client is allowed to write
   it. Server-derived trust, score, identity, moderation, and season fields stay absent from
   connector requests.
4. Add positive and negative runtime tests, regenerate, review the complete diff, and run
   `pnpm run verify`.
5. Use a new contract version for a breaking wire change. Do not silently reinterpret an existing
   field or enum.

Runtime validation is defense in depth after a service has already enforced content type and a small
raw-body limit. A future ingest parser must also reject duplicate object keys and excessive nesting
before ordinary object validation, and request signatures must bind the exact received body bytes.
Runtime traversal budgets do not replace edge limits, deadlines, backpressure, or database
constraints.
