# TypeScript contract runtime

This private workspace consumes the canonical [`contracts/v1`](../../contracts/README.md) schemas.
It supplies generated readonly types and validator wrappers plus a small dependency-free runtime
interpreter for the reviewed schema subset.

A service must enforce content type, raw byte size, duplicate-key rejection, and nesting depth while
parsing before it calls this package. Ordinary `JSON.parse` has already discarded duplicate-key
evidence, so the runtime cannot reconstruct or police that ambiguity afterward.

The validator is designed for already parsed, raw-body-bounded JSON. It:

- rejects unknown fields, accessors, non-plain objects, sparse/extended arrays, cycles, unsafe
  integers, malformed calendar dates, out-of-range/incorrect-weekday dates, and non-canonical
  timestamps;
- caps depth, nodes, object keys, array items, and returned issue count;
- returns only stable issue codes and paths made from schema-owned names or array indexes;
- never includes an unknown property name, submitted value, request body, or schema description in a
  validation issue;
- catches reflective failures and returns `invalid_structure` instead of exposing an exception.

Generated schema objects are recursively frozen before export. The package root exposes only the
generated validators and validation result types, not the generic interpreter function, so normal
consumers cannot substitute a runtime or network-provided schema.

The runtime intentionally supports only the subset accepted by `scripts/check-contracts.mjs`. New
JSON Schema keywords require implementation, negative tests, documentation, and security review;
they must not be ignored silently.

Run from the repository root:

```text
pnpm run check:contracts
pnpm run lint:contracts
pnpm run typecheck:contracts
pnpm run test:contracts:coverage
```

Generated code is committed so TypeScript and future Rust consumers can review an immutable source
digest. The generated OpenAPI operation is marked `implemented-local`: the Web route imports and
validates the Community query/response components, but no deployment consumes a live database
credential, no service imports the connector contract, and no real usage data is accepted.
