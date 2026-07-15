# ADR 0017: Protected Ingest origin proof key configuration

- Status: Accepted (local config-backed verifier implemented; secret-manager deployment pending)
- Date: 2026-07-15
- Decision owners: Ingest, Edge, Security, Privacy, and Operations
- Supersedes: None
- Superseded by: None

## Context

ADR 0015 verifies a body-bound HMAC-SHA-256 origin proof with one or two injected 32-byte keys, but
the application had no reviewed way to obtain those keys. Leaving that seam to a future wrapper
could permit tracked literals, dummy production fallbacks, partial rotation, permissive decoding,
file or command lookup, accidental key serialization, or a configuration exception containing the
submitted value.

The public repository cannot contain a real proof key, deployment value, secret-manager binding, or
Cloudflare signer. It can define and verify the exact process-side configuration contract without
adding a replay store, HTTP listener, edge route, deployment, or production secret.

## Decision

Add one private Ingest configuration boundary in `origin-proof-config.ts`. It is the only production
file besides `database-config.ts` allowed by the workspace lint policy to read process environment.
It may not import the PostgreSQL driver or an HTTP framework/runtime. No checked-in environment
file, example key, default key, file reader, subprocess, network lookup, or fallback source is
introduced.

The reader accepts exactly these namespaced values:

- mandatory `VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_ID` and
  `VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_BASE64URL`; and
- optional `VIBERACING_INGEST_ORIGIN_SECONDARY_KEY_ID` and
  `VIBERACING_INGEST_ORIGIN_SECONDARY_KEY_BASE64URL`, which must both be absent or both be present.

Each ID must satisfy the versioned `edge_` identifier grammar. Each key must be the canonical,
unpadded base64url encoding of exactly 32 bytes. A rotation pair must have distinct IDs and distinct
key material. Both configured IDs verify inbound proofs; the edge signer chooses the active ID.
Rotation therefore installs a new primary while retaining the previous key as secondary only for the
bounded request window, then removes the secondary pair. This local reader does not perform or
schedule rotation.

`createConfiguredCommunitySyncVerifier` accepts only the verifier's exact nonce-consumer, clock, and
minimal-device-lookup dependencies. It validates that dependency record without invoking accessors,
resolves the protected key values, and constructs the existing verifier internally. Raw
configuration and a reusable key container are never returned. The verifier copies each key into
private state. The reader then overwrites its temporary decoded buffers in `finally`; this limits an
extra application copy but does not claim that JavaScript strings, environment storage, runtime
copies, swap, crash dumps, or host memory are erased.

Configuration failure uses one generic message and a bounded non-reflective code for unreadable
environment, invalid primary/secondary pair, or duplicate rotation state. It attaches no cause, key,
ID, environment name, callback detail, or stack from a caught dependency. Verifier request failures
retain ADR 0015's generic behavior and unknown-key dummy-HMAC path.

This is protected configuration plumbing, not a deployed secret. It does not validate Cloudflare
signing, authenticate Railway ingress, persist replay state, accept a network request, compose a
submission, create a public response, log rotation, or provide a secret-manager integration.

## Security and privacy consequences

The exact source, encoding, pair, and no-fallback rules close a local portion of TB-06 and reduce
key-confusion and accidental-publication paths in VR-ABUSE-ORIGIN-BYPASS. Two-key rotation avoids a
forced proof outage without accepting an unbounded keyring. Keeping construction internal avoids a
normal API that hands raw proof keys to unrelated code. Process compromise, host-admin access,
debuggers, crash dumps, and a compromised deployment secret manager can still expose the keys; key
rotation and origin denial remain required recovery controls.

No user field, database row, log, metric, cache, export, or retention class is added. The reader
implements the already mapped Edge origin HMAC key/key-ID Security class in process environment and
memory only. The ID still reaches only the existing proof verifier and future replay tuple; the raw
key must never enter either persistence or logs. No real key or identifier is present in repository
tests or documentation.

Affected invariants are VR-INGEST-001, VR-DATA-001, and VR-ABUSE-001. Primary attacker stories are
VR-ABUSE-ORIGIN-BYPASS, VR-ABUSE-RESOURCE-EXHAUSTION, and VR-ABUSE-DEPENDENCY-PR.

## Alternatives considered

- **Keep accepting injected keys only:** rejected because the first HTTP wrapper would otherwise
  invent a high-risk secret and rotation contract without a separately verified boundary.
- **Use one key with no overlap:** rejected because safe rotation would require an avoidable outage
  or a window where edge and origin disagree.
- **Accept an arbitrary JSON keyring:** rejected because it broadens parsing, count, duplicate,
  ordering, and accidental-log surfaces beyond the one-current/one-previous requirement.
- **Read a key file, command output, or remote secret API directly:** rejected because path,
  permission, subprocess, network, caching, identity, and refresh semantics require separate
  deployment-specific review.
- **Return a decoded configuration object to callers:** rejected because the only current consumer
  is the verifier and a reusable secret-bearing object makes accidental inspection or serialization
  easier.
- **Add replay storage and HTTP composition in the same slice:** rejected because persistence,
  atomic consume/expiry, socket framing, admission, proxy trust, and public responses are separate
  trust boundaries and evidence sets.

## Migration and rollback

There is no database, contract, dependency, listener, route, deployment, or stored-data migration.
No live environment value is added by this repository. A future deployment must provision the
mandatory pair through its protected secret mechanism, keep edge and origin key IDs synchronized,
and exercise rotation and rollback before enabling ingress.

Rollback removes the reader/factory, tests, lint exception, documentation, and this ADR while
leaving the injection-only verifier and database adapter disabled at the network boundary. Once a
route uses this contract, rollback must first deny the origin route; it must not substitute a dummy,
tracked, stale, file-sourced, or broadly shared key. Suspected exposure requires route denial and
rotation rather than continued acceptance.

## Verification

Current local evidence includes:

- mandatory primary and all-or-none secondary pairs under four exact namespaced environment keys;
- canonical exact-length base64url decoding, closed key-ID grammar, and distinct rotation IDs and
  material;
- explicit/default environment readers with unreadable-environment containment and generic bounded
  errors without causes or reflected values;
- exact plain/null-prototype dependency reconstruction with rejection of missing, extra,
  non-function, accessor-backed, array, and proxy-failing values before protected configuration is
  read;
- primary and secondary keys each authenticating the existing exact-body origin path before the
  parser, while the returned verifier exposes no own key/configuration property;
- temporary decoded-buffer overwrite after verifier construction and on configuration failure;
- lint regression proving process-environment access only in the two reviewed configuration files,
  PostgreSQL-driver isolation, and the continuing HTTP import ban; and
- 28 new configuration/proof/boundary cases, bringing the Ingest suite to 242 tests at 100%
  statement, branch, function, and line coverage, plus strict lint, types, build, root verification,
  and staged public-data review.

Tests use synthetic keys. They do not prove a secret manager, Cloudflare signer, rotation event,
persistent replay store, direct-origin denial, HTTP request, live database connection, connector,
deployment, or production memory-erasure property.

## References

- [Community sync verification kernel](0015-bounded-community-sync-verification-kernel.md)
- [Bounded Ingest PostgreSQL adapter](0016-bounded-ingest-postgresql-adapter.md)
- [Ingest workspace](../../apps/ingest/README.md)
- [Authentication policy](../../contracts/v1/connector-sync-authentication.json)
- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [System context](../architecture/SYSTEM_CONTEXT.md)
- [Data flow](../architecture/DATA_FLOW.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
