# ADR 0022: Candidate Codex account and usage adapter

- Status: Accepted (candidate-only schema adapter; support admission pending)
- Date: 2026-07-15
- Decision owners: Connector, Security, Privacy, Compatibility, and Release
- Supersedes: None
- Superseded by: None

## Context

ADR 0021 bounds the generic App Server initialization exchange but intentionally emits no useful
method. Phase 2 next needs the smallest version-specific boundary that confirms ChatGPT mode and
extracts daily usage without retaining account email, plan, summary statistics, or any broader App
Server surface. The work must not turn a locally generated schema or one successful parser test into
a compatibility claim.

The official OpenAI Codex release `rust-v0.144.4` points to immutable commit
`8c68d4c87dc54d38861f5114e920c3de2efa5876`. A local CLI reporting the same version generated the
stable schema bundle without `--experimental`. The generated bundle contains stable `account/read`
and `account/usage/read` requests, but its response objects are open and its strings, integer
semantics, and daily-bucket count are not sufficient by themselves for the narrower Vibe Racing sync
contract. The official release asset metadata is recorded, but that artifact has not been
independently downloaded and verified for this extract. Process discovery, launch, timeout, stderr,
cleanup, and cross-platform execution evidence also remain absent.

## Decision

Add a candidate-only evidence directory at `compat/codex/0.144.4`. Its manifest records the exact
release tag, commit, publication time, official Windows x86-64 asset metadata, full stable-bundle
digest, `ClientRequest` digest, and the three minimal checked-in account schema extracts. The
checked-in extracts differ from generator bytes only by a final LF and record both source and
checked-in byte/digest values. Nine compact JSONL fixtures cover positive, nullable, unsupported,
missing, malformed, and unknown-field cases. Generated tests cover cases that should not become
large or invalid checked-in files, including invalid UTF-8, duplicate JSON keys, oversized frames,
collection overflow, unsafe integers, wrong IDs, and duplicate dates.

A repository-owned compatibility checker enforces canonical duplicate-free JSON, exact manifest
shape, immutable OpenAI release URL/commit syntax, stable generation without experimental API, file
byte counts and SHA-256 digests, safe paths, the exact two-method allowlist, fixture categories,
generated adversarial-case inventory, and a complete manifest of every version artifact. A
`candidate` manifest is forbidden from the public support matrix; a future `supported` manifest must
have a matching matrix row and no unresolved support blockers.

Extend the Rust library with `CandidateCodex01444AccountUsage`, obtainable only by consuming a
completed `ConnectorHandshake`. It is deliberately not a generic JSON-RPC client:

- `start_account_read` emits only request ID `1`, `account/read`, and `{"refreshToken":false}`;
- the matching response is a closed, duplicate-rejecting shape; it accepts only a structurally
  complete ChatGPT account with no reauthentication requirement, validates then discards email and
  plan, and rejects API-key, Amazon Bedrock, missing, null, or reauthentication-required modes
  before any usage request;
- `start_usage_read` then emits only request ID `2`, `account/usage/read`, and null parameters;
- the matching response validates and discards the closed nullable summary; a missing or null daily
  bucket collection becomes an empty local result so a later composer can skip upload;
- at most 31 daily buckets survive, each with a real `20xx` Gregorian `YYYY-MM-DD` label and an
  integer from zero through `9007199254740991`; output is sorted by date and duplicate dates fail;
  and
- every invalid remote frame permanently fails the adapter, while errors remain stable and
  non-reflective.

The returned `DailyUsage` exposes only the intended private date/token entries. Its diagnostic
representation contains only the entry count, and `DailyUsageEntry` deliberately has no `Debug`
implementation. No account email, plan, summary statistic, release path, or raw response is stored
in the adapter.

This decision does not mark Codex `0.144.4` supported and does not create a runnable connector. The
matrix remains empty until official artifact verification, safe process lifecycle evidence,
Windows/macOS/Linux execution, secure key storage, signed upload, CLI/packaging, and protected
review/release evidence all pass.

## Security and privacy consequences

The adapter narrows TB-03 from one generic handshake to the only two planned stable reads without
introducing an arbitrary-method escape hatch. Closed visitors intentionally reject additive schema
drift rather than silently collecting new upstream fields. The 16 KiB frame ceiling, fixed IDs,
terminal remote failure, 31-entry ceiling, strict calendar, safe integer maximum, and duplicate date
rejection bound hostile local-process work before any later signing or upload.

Account email and plan are transient prohibited/account inputs needed only to prove the exact
variant shape; they are immediately discarded and cannot enter the public adapter result or its
diagnostics. Summary metrics are likewise validated and discarded. The returned daily date/token
entries are Usage data already mapped in the privacy data map; this slice keeps them in caller-owned
memory only and adds no log, file, cache, database, HTTP, analytics, export, key, or network sink.

Affected invariants are VR-PRIVACY-001, VR-CODEX-001, VR-CODEX-002, and VR-RELEASE-001. Primary
attacker stories are VR-ABUSE-CONNECTOR-LOCAL, VR-ABUSE-USAGE-FORGERY, VR-ABUSE-RESOURCE-EXHAUSTION,
and VR-ABUSE-RELEASE-SUBSTITUTION.

## Alternatives considered

- **Mark `0.144.4` supported after local schema generation:** rejected because an exact schema and
  parser do not prove artifact provenance, process containment, cleanup, platform behavior, or a
  released connector.
- **Copy the complete generated bundle:** rejected because the repository needs only the reviewed
  account extracts; a digest preserves full-bundle identity without committing a large unrelated
  protocol surface.
- **Accept unknown response members for forward compatibility:** rejected because additive drift can
  introduce account or usage fields that have not passed privacy and semantic review.
- **Deserialize email, plan, and summary into public structs:** rejected because those values are
  unnecessary for sync and would create avoidable retention, debugging, and egress risk.
- **Upload summary lifetime usage when daily buckets are missing:** rejected because the version 1
  contract accepts bounded daily labels only and must not invent a temporal distribution.
- **Request token refresh:** rejected because the adapter only reads current mode and must not
  broaden authentication side effects.

## Migration and rollback

This change adds a candidate manifest, schema extracts, synthetic fixtures, a checker, and a
library-only exact-version parser. It adds no dependency, database migration, public service
contract, environment variable, stored value, listener, process, credential, network request, or
support row. Rollback removes the candidate adapter/evidence/checker and restores ADR 0021's
handshake-only library; no server or stored-data migration is required.

A future process boundary may select this adapter only after verifying the exact executable version
and admitted artifact. Promotion to `supported` requires its own evidence change that clears every
manifest blocker, adds the matrix row, records the connector release range, and passes protected
review. Schema drift creates a new exact-version directory or an explicit reviewed replacement; it
never edits this extract silently.

## Verification

Ten account/usage integration tests exercise the public production API and checked-in fixtures.
Together with the seven handshake tests they prove:

- handshake-before-adapter state order and exact capability-free request bytes for IDs `1` and `2`;
- ChatGPT acceptance with string or null email, complete disposal of email/plan/summary, and
  unsupported-account rejection before usage;
- fixed response IDs, closed envelopes/objects, escaped duplicate keys, server errors, invalid
  UTF-8, whole-frame size, and terminal failure;
- positive, missing, nullable, malformed, unknown-field, duplicate-date, over-31, wrong-type,
  negative, floating, and unsafe-integer usage behavior;
- real Gregorian/leap-day checking across the `20xx` range, deterministic sorting, and exact sync
  integer boundaries; and
- diagnostics that expose only entry count and never synthetic private fixture markers or exact
  usage values.

Fourteen black-box compatibility-checker cases prove the baseline plus rejection of missing or
unmanifested artifacts, digest drift, path traversal, candidate/matrix contradiction, unsupported
promotion, missing fixtures or adversarial coverage, method drift, duplicate JSON keys, and
noncanonical release provenance. Root verification runs the checker, checker regressions, all Rust
tests, formatting, checking, and Clippy with warnings denied. No test claims a live process,
official artifact execution, platform cleanup, key store, signed upload, package, or release.

## References

- [Official Codex `0.144.4` release](https://github.com/openai/codex/releases/tag/rust-v0.144.4)
- [Candidate compatibility manifest](../../compat/codex/0.144.4/manifest.json)
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [ADR 0021](0021-fail-closed-codex-handshake-foundation.md)
- [Compatibility policy](../architecture/COMPATIBILITY_POLICY.md)
- [Codex compatibility matrix](../reference/codex-compatibility.md)
- [Connector library](../../crates/connector/README.md)
- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
