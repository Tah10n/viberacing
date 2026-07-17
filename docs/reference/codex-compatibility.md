# Codex compatibility matrix

## Current support

Compatibility status: no supported versions.

No Codex version and no Vibe Racing connector version is supported. A library-only connector now
implements the bounded initialization exchange and a candidate parser for exact version `0.144.4`,
plus a synthetic one-shot process supervisor behind a launch capability with no public constructor.
Executable discovery/admission, official-artifact execution, cross-platform results, secure keys,
upload, packaging, and a released connector do not exist. This empty matrix is fail-closed evidence,
not an invitation to run the candidate against an arbitrary local version.

| Codex version | Stable schema digest | Compatible connector | Platforms tested | Status and evidence                                 |
| ------------- | -------------------- | -------------------- | ---------------- | --------------------------------------------------- |
| None          | Not available        | Not released         | None             | Unsupported until the full admission process passes |

## Candidate evidence, not support

[`compat/codex/0.144.4/manifest.json`](../../compat/codex/0.144.4/manifest.json) records the
official `rust-v0.144.4` tag, immutable release commit and artifact metadata, full stable-bundle and
client request digests, three minimal account schema extracts, and nine synthetic JSONL fixtures.
The bundle was generated from a local CLI reporting `0.144.4` with experimental API omitted. The
official artifact itself was not independently downloaded and verified for this extract.

The candidate Rust adapter is reachable only after the handshake. It emits the fixed IDs `1` and `2`
for `account/read` and `account/usage/read`, accepts only ChatGPT mode, discards email, plan, and
summary values, and returns at most 31 sorted unique daily date/token entries within the sync
contract. Ten adapter tests plus generated hostile cases exercise exact bytes, nullable/missing
values, schema drift, dates, integer/count bounds, framing, terminal failure, and non-reflective
diagnostics.

Nine supervisor unit cases launch only a target-built Rust fixture. They prove one fixed
`app-server` argument and working directory, cleared ambient environment with a narrow
capability-owned allowlist, exact handshake/account/usage composition, three-frame stdout and 8 KiB
discard-only stderr budgets, response/lifetime deadlines, early-exit handling, late-output checks,
stable errors, nonzero terminal-status rejection, and reap-before-success cleanup.
`ReviewedCodexLaunch` has no public constructor, so this is not an installed-Codex or
selected-artifact execution result.

The repository compatibility checker verifies manifest paths, shapes, byte counts, digests,
provenance syntax, fixed methods, fixture coverage, and the candidate/support-matrix separation. Its
fourteen black-box cases prove those fail-closed rules. ADRs 0022 and 0023 record the parser and
process decisions. None of this clears the remaining admission requirements below.

## Admission requirements

A matrix row needs all of the following:

- immutable Codex release identity and canonical provenance;
- generated stable App Server schema digest with experimental API disabled;
- committed minimal schema extract and synthetic fixtures;
- exact allowlisted method/field review;
- proof that prohibited account, prompt, repository, credential, and process data cannot enter the
  connector payload or diagnostics;
- handshake, framing, nullable/missing/unknown field, malformed date, integer bound, oversized
  output, timeout, overload, stderr, and cleanup tests;
- supported-platform clean-machine results;
- compatible signed connector range, limitations, reviewer, and release notes.

The generic process and version rules are defined in the
[compatibility policy](../architecture/COMPATIBILITY_POLICY.md). A scheduled latest-version probe
can open an issue but cannot edit this matrix, release an artifact, or turn an unknown version into
a supported version.

## Implemented library boundaries

The Rust library emits one fixed `initialize` request with ID `0`, fixed client metadata, and no
experimental capability. It accepts only one LF-terminated frame up to 16 KiB, manually rejects
duplicate and unknown members, validates the four reviewed stable initialization result strings,
discards them, then emits one fixed `initialized` notification. A remote protocol failure is
terminal for that state-machine instance and errors do not reflect server content.

The candidate adapter adds exact-version parsing evidence described above. The one-shot supervisor
adds fixed local launch mechanics and synthetic timeout/overload/cleanup evidence but accepts only
the inaccessible `ReviewedCodexLaunch` capability. A composer now consumes the normalized output
only behind an equally inaccessible `ReviewedCommunitySyncContext` and fixes the exact sync body,
SHA-256 digest, nonce encoding, and device message. An isolated one-use signer consumes that closed
material only with an inaccessible device-bound key capability. A separate pairing-only command can
generate a native-store device key and complete the local start/approve/poll transaction, but it
does not admit or run Codex. No library boundary discovers a binary, resolves its links/ownership,
constructs the operational App Server or sync capability, verifies or executes the selected release
artifact, uploads data, admits a release, or creates a supported connector artifact. Every matrix
row still requires the complete admission evidence above.

## Planned stable surface

The implementation plan names `account/read` for a local auth-mode decision and `account/usage/read`
for bounded usage daily buckets. The `0.144.4` candidate proves those methods and reviewed fields
exist in one generated stable schema and implements their closed parser. It is still not a current
support claim. The first proposed row must additionally prove executable admission, the official
artifact, clean-machine platforms, reviewed context/key-store/pairing/upload behavior, privacy
egress, and a released connector range. The shared signed sync vector is synthetic cryptographic
contract evidence only.

All other App Server methods and transports are denied for connector v1. In particular, Vibe Racing
does not consume thread, turn, item, approval, MCP, file, shell, login, conversation, or repository
surfaces, and it does not connect over WebSocket.
