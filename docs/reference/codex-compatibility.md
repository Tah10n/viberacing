# Codex compatibility matrix

## Current support

Compatibility status: no supported versions.

No Codex version and no Vibe Racing connector version is supported. A library-only connector now
implements the bounded initialization exchange and a candidate parser for exact version `0.144.5`,
plus a bounded one-shot supervisor. After active-record validation, a Windows x86_64 development
command can select the candidate through bounded fixed-name `PATH` discovery or an explicit path,
construct its private launch capability only for the exact artifact size and SHA-256, and perform
one signed upload. A separate explicit `check-codex` command can perform only that exact candidate
admission without opening credential storage, starting Codex, reading an account, retaining a
result, or using the network; success explicitly remains unsupported and later sync re-admits.
macOS/Linux admission, clean-machine real-account results, packaging, provenance, and a released
connector do not exist. This empty matrix is fail-closed evidence, not an invitation to run an
arbitrary local version.

| Codex version | Stable schema digest | Compatible connector | Platforms tested | Status and evidence                                 |
| ------------- | -------------------- | -------------------- | ---------------- | --------------------------------------------------- |
| None          | Not available        | Not released         | None             | Unsupported until the full admission process passes |

## Candidate evidence, not support

[`compat/codex/0.144.5/manifest.json`](../../compat/codex/0.144.5/manifest.json) records the
official `rust-v0.144.5` tag, immutable release commit and artifact metadata, full stable-bundle and
client request digests, three minimal account schema extracts, and nine synthetic JSONL fixtures.
The bundle was generated from a local CLI reporting `0.144.5` with experimental API omitted. The
Windows admission policy matches the recorded official release asset filename/size/digest. Its
candidate-only discovery tests use synthetic files and fixed resource bounds; repository
verification does not discover or execute an installed artifact, and this is not protected
clean-machine release evidence. The credential-free diagnostic has only parser, selector,
non-reflective-output, and error-mapping evidence; no repository test invokes it against an
installed artifact.

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
`ReviewedCodexLaunch` has no public constructor. ADR 0031 adds exact internal artifact admission and
held-handle launch wiring; repository tests still do not execute an installed Codex account.

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
accepts only the inaccessible `ReviewedCodexLaunch` capability. A composer and one-use signer keep
the exact sync bytes and device key behind two further inaccessible capabilities. `connect`
generates and activates the native-store credential. The Windows x86_64 `sync` command validates
that active record before bounded fixed-name discovery or an explicit path, canonicalizes and
hash-admits only the exact candidate, keeps a no-write-sharing handle through launch, creates fresh
request context, and sends one closed signed request without proxy, redirect, retry, or edge-origin
credentials. It cannot admit another version or platform, create a release, or make the candidate
supported. `check-codex` separately reuses only the artifact selector and grants no launch, account,
credential, network, or cached authority. Every matrix row still requires the complete admission
evidence above.

## Planned stable surface

The implementation plan names `account/read` for a local auth-mode decision and `account/usage/read`
for bounded usage daily buckets. The `0.144.5` candidate proves those methods and reviewed fields
exist in one generated stable schema and implements their closed parser. It is still not a current
support claim. The first proposed row must additionally prove clean-machine supported platforms,
real-account privacy egress, packaged artifact signature/SBOM/provenance, release review, and a
released connector range. The shared signed sync vector and loopback upload remain synthetic
cryptographic/transport evidence only.

All other App Server methods and transports are denied for connector v1. In particular, Vibe Racing
does not consume thread, turn, item, approval, MCP, file, shell, login, conversation, or repository
surfaces, and it does not connect over WebSocket.
