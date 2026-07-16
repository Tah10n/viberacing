# Vibe Racing connector protocol, candidate adapter, supervisor, and sync composer

This Rust crate contains the fail-closed local Codex App Server initialization boundary and one
candidate-only account/usage adapter for the exact `0.144.4` schema extract. It also contains a
bounded one-shot child supervisor behind a reviewed-launch capability with no public constructor. It
also contains an exact-body unsigned Community sync composer behind a second inaccessible reviewed
context. It is a library foundation, not a runnable, supported, or released connector.

The implemented surface is deliberately narrow:

- one fixed `initialize` request over newline-terminated JSONL, with request ID `0`;
- fixed client metadata and no `capabilities` or experimental API opt-in;
- a 16 KiB whole-frame ceiling and exact one-line framing;
- closed, duplicate-rejecting validation of the matching stable initialization response;
- immediate discard of the server's Codex home, platform, and user-agent values;
- one fixed `initialized` notification only after the response validates;
- terminal failure for malformed, oversized, unknown, duplicated, or out-of-order server input;
- after a completed handshake only, fixed `account/read` ID `1` with refresh disabled and fixed
  `account/usage/read` ID `2` with null parameters;
- closed exact-version response visitors that confirm ChatGPT mode while discarding email, plan, and
  nullable summary values; and
- at most 31 sorted unique daily entries with real `20xx` dates and sync-safe token integers;
- one fixed `app-server` argument, reviewed working directory, cleared ambient environment,
  capability-owned allowlist values, and local piped stdio only;
- three stdout frames of at most 16 KiB each, discard-only stderr capped at 8 KiB, a 10-second
  response deadline, a 45-second lifetime, and a 500-millisecond graceful-exit window; and
- exact handshake/account/usage composition that returns daily data only after terminal output is
  checked and the synthetic child is reaped;
- exact closed identifier, calendar, timestamp, entry-count, integer, and 8 KiB sync-body bounds;
- fixed manual seven-field JSON serialization, connector/candidate versions, SHA-256 digest, and
  repository-owned unpadded base64url encoding; and
- the exact eight-field LF-separated device-signature message with no trailing separator, checked
  against one synthetic vector shared with the production Ingest verifier.

`ReviewedCodexLaunch` and `ReviewedCommunitySyncContext` have no public constructors. There is no
executable discovery, link/ownership review, artifact or version admission, live Codex launch path,
source/device context provider, trusted clock, entropy source, WebSocket or network transport,
generic JSON-RPC method, credential-store access, device key, signer, upload, retry loop, scheduler,
CLI, installer, or release artifact. The checked-in
[`0.144.4` candidate evidence](../../compat/codex/0.144.4/manifest.json) is development evidence
only. The [compatibility matrix](../../docs/reference/codex-compatibility.md) remains empty until
official-artifact, executable-admission, platform, privacy, packaging, and release evidence all
pass.

Run the focused gate from the repository root:

```text
cargo test --workspace --all-targets --all-features --locked
node scripts/check-codex-compatibility.mjs
```

The root `pnpm run verify` additionally checks formatting, Clippy, licenses, public-data safety, and
the rest of the repository. Rust process tests launch only a target-built synthetic fixture; they
never discover or execute a local Codex installation.
