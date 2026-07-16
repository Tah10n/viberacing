# ADR 0021: Fail-closed Codex App Server handshake foundation

- Status: Accepted (library-only protocol foundation; operational connector pending)
- Date: 2026-07-15
- Decision owners: Connector, Security, Privacy, Compatibility, Dependencies, and Release
- Supersedes: None
- Superseded by: None

## Context

Phase 2 requires a local connector that eventually launches one reviewed Codex App Server release,
reads only the stable account and usage fields admitted by the compatibility matrix, and submits a
strictly smaller signed payload. TB-03 begins earlier: stdout framing and the initialization state
machine already consume hostile process bytes. A generic JSON-RPC client, permissive JSON value
model, experimental capability, unknown field, duplicate key, unbounded line, reflected parser
error, or retry after a partial handshake could widen that boundary before any useful method is
implemented.

The official App Server contract uses newline-delimited JSON over local stdio, omits the JSON-RPC
version member on the wire, and requires one `initialize` exchange followed by `initialized`.
Generated schemas are exact to the Codex release that produced them. The repository still has no
admitted Codex version, committed version fixture, process launcher, account/usage adapter, device
key, upload path, CLI, installer, or release artifact. A protocol foundation must preserve that
empty-support posture rather than turning local schema inspection into a compatibility claim.

## Decision

Create `viberacing-connector` as a library-only Rust workspace member. The crate exposes one
`ConnectorHandshake` state machine and no generic transport or arbitrary-method API.

`start` may run once on a fresh instance. It emits one compile-time fixed request with numeric ID
`0`, method `initialize`, and closed client name/title/version metadata. The package version is
embedded at compile time. The request omits `jsonrpc`, `capabilities`, and `experimentalApi`.

`accept_initialize_response` is legal only after `start`. It requires exactly one LF-terminated
frame of at most 16 KiB, with no CR, NUL, embedded LF, or leading/trailing bytes outside the JSON
object. Manual Serde visitors reject duplicate and unknown envelope/result members rather than
deserializing through a permissive map. The response must contain request ID `0` and exactly the
reviewed stable `codexHome`, `platformFamily`, `platformOs`, and `userAgent` result fields. Strings
are non-empty, control-free, and individually bounded; the Codex home must be syntactically
absolute. All values are validated and discarded, so the local path and platform metadata never
become connector output or diagnostics.

Only a valid matching response advances the state and returns the one fixed `initialized`
notification. Any malformed, oversized, open, duplicated, mismatched, or server-error message
returns a stable non-reflective error and permanently fails that instance. Local out-of-order calls
return `InvalidState`; initialization cannot be repeated or reinterpreted on a ready or failed
connection.

This slice deliberately does not discover or launch Codex, read stderr, negotiate a supported
version, emit `account/read` or `account/usage/read`, retain any server field, access a credential
store, sign or upload data, open a socket, or provide a user command. WebSocket and every other
transport are absent. A later supported-version adapter must be a separate closed API backed by the
full compatibility admission process.

## Dependency review

Serde 1.0.228 without derive and serde_json 1.0.150 are exact-pinned direct dependencies. A mature
streaming JSON parser is preferred to a new repository-owned parser, while manual visitors preserve
duplicate rejection and the closed response shape. The enabled runtime graph has six non-workspace
crates: serde, serde_core, serde_json, itoa, memchr, and zmij. Cargo.lock contains five additional
derive/proc-macro records through impossible `cfg(any())` edges; `cargo tree --all-features` proves
they are not compiled.

Canonical registries/repositories, current exact releases, maintenance, supported Rust versions,
feature edges, lock checksums, upstream unsafe surface, licenses, and every build script were
reviewed on 2026-07-15. The active build scripts inspect only compiler/target metadata or write
generated internal source to Cargo OUT_DIR; none downloads content, links a native library, or adds
a network client. The eleven inventory records use reviewed permissive license expressions. Exact
OSV queries reported no known advisory for those versions at review time. The connector crate itself
forbids unsafe code. These facts do not replace future RustSec/cargo-deny, SBOM, provenance, or
binary review before distribution.

## Security and privacy consequences

The state machine implements part of VR-CODEX-001 and reduces parser/resource risk at TB-03, but it
does not establish executable provenance, process containment, supported methods, or release trust.
The strict 16 KiB frame, exact state order, duplicate/unknown rejection, non-reflective errors, and
terminal remote failure make hostile output bounded before later account data is considered.

No new collected, logged, cached, exported, transmitted, or retained field is introduced. The four
server strings are transient Security/Operational compatibility input and are discarded inside the
call. In particular, `codexHome` is a prohibited local path outside this validation boundary. There
is no log, metric, diagnostic payload, file, database, HTTP, analytics, or network sink.

Affected invariants are VR-PUBLIC-001, VR-CODEX-001, VR-CODEX-002, and VR-RELEASE-001. Primary
attacker stories are VR-ABUSE-CONNECTOR-LOCAL, VR-ABUSE-DEPENDENCY-PR, and
VR-ABUSE-RESOURCE-EXHAUSTION.

## Alternatives considered

- **Deserialize into `serde_json::Value`:** rejected because duplicate object names collapse before
  validation and an open recursive value tree gives the boundary authority it does not need.
- **Use derive-generated response structs:** rejected for this small boundary because manual
  visitors make duplicates, unknown members, bounds, and discarded fields explicit while avoiding an
  active proc-macro feature.
- **Write a complete JSON parser in the repository:** rejected because mature parsing and Unicode
  handling reduce implementation risk; the reviewed dependency remains behind one narrow visitor.
- **Emit `initialized` without matching the response:** rejected because a server error or
  mismatched ID must not advance local state.
- **Add the account/usage methods now:** deferred until an immutable Codex release, minimal schema
  extracts, fixtures, privacy-egress tests, and platform evidence can admit one matrix row.
- **Add process launch or WebSocket transport now:** deferred because executable discovery,
  environment, stderr, timeout, cleanup, and release provenance are distinct high-risk boundaries;
  WebSocket is outside connector v1.

## Migration and rollback

This decision adds one library crate, two exact direct dependencies, a Cargo lock graph, and no
database migration, public contract, environment variable, stored value, listener, executable, or
supported-version row. Rollback removes the crate and restores the empty Rust workspace and Cargo
inventory. It does not change server contracts, SQL, or accepted data.

A future process or supported-version adapter must wrap this state machine without adding a generic
method escape hatch, increasing bounds silently, retaining initialization values, reflecting remote
errors, or changing the empty compatibility matrix without its own evidence and review.

## Verification

Seven integration tests exercise the public production API and prove:

- exact fixed request/notification bytes, package version, omitted capability and JSON-RPC members;
- one initialization exchange, legal field reordering, readiness only after a valid response, and
  terminal state after hostile input;
- LF-only framing, whole-frame size, invalid UTF-8, CR/NUL/embedded-line, and surrounding-byte
  rejection;
- wrong/missing/string/floating/duplicate IDs, errors, notifications, unknown envelope fields,
  duplicate result fields, and non-object results;
- exact required fields, absolute-path syntax, per-field bounds, safe Unicode, control-character,
  wrong-type, missing, duplicate, and unknown-field rejection; and
- stable error text that cannot contain a server-provided marker.

The root Rust gate now runs formatting, all-target/all-feature checking, these tests, and Clippy
with warnings denied under the pinned toolchain and lockfile. No test claims a live Codex process,
supported release, account/usage response, OS credential store, upload, installer, signed artifact,
or clean-machine platform result.

## References

- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Compatibility policy](../architecture/COMPATIBILITY_POLICY.md)
- [Codex compatibility matrix](../reference/codex-compatibility.md)
- [Connector protocol foundation](../../crates/connector/README.md)
- [Dependency policy](../security/DEPENDENCY_POLICY.md)
- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
