# Contract workspace agent guidance

Read the root `AGENTS.md`, `contracts/README.md`, the privacy data map, security invariants, and
this workspace's `README.md` before changing a public contract or validator.

## Non-negotiable boundaries

- JSON Schemas and the closed manifest operations under `contracts/v1/` are canonical.
  `src/generated.ts` and the OpenAPI document are generated derivatives; never patch them as the
  source of a change.
- Connector-writable schemas must not gain profile identity, trust tier, score, rank, streak,
  season, moderation, server receipt time, account email, prompt, conversation, repository,
  credential, arbitrary URL, or arbitrary content fields.
- Keep every object closed and every scalar/collection bounded. A body-size limit must exist before
  JSON parsing in any future service; parsing must also reject duplicate keys and excessive nesting.
  Validator budgets are an additional boundary after those checks.
- Validation issues may contain only stable codes and schema-owned paths. Do not echo unknown
  property names, values, bodies, signatures, identifiers, or internal exceptions.
- Do not add `eval`, dynamic code generation, network schema resolution, remote references, or a
  runtime dependency merely for convenience.
- `observedAt` is client time for replay checks only. `codexReportedDate` has no claimed timezone,
  and neither value may control finalization.

## Required workflow

1. Change the canonical schema or manifest.
2. Run `pnpm run generate:contracts`.
3. Review generated TypeScript and OpenAPI diffs, including the source digest.
4. Add positive, reject-unknown, bounds, malformed-structure, privacy, and resource-budget tests.
5. Run `pnpm run check:contracts`, package lint/type/unit tests, and root `pnpm run verify`. Add
   coverage/build when the contract or validator behavior changes; use `pnpm run verify:release`
   only at the release or broad cross-cutting boundary.

A contract change also updates its API/reference documentation, privacy classification, threat or
abuse mapping, compatibility notes, and migration/version decision when applicable.
