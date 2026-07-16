# Vibe Racing connector protocol foundation

This Rust crate contains the fail-closed local Codex App Server initialization boundary. It is a
library foundation, not a runnable or released connector.

The implemented surface is deliberately narrow:

- one fixed `initialize` request over newline-terminated JSONL, with request ID `0`;
- fixed client metadata and no `capabilities` or experimental API opt-in;
- a 16 KiB whole-frame ceiling and exact one-line framing;
- closed, duplicate-rejecting validation of the matching stable initialization response;
- immediate discard of the server's Codex home, platform, and user-agent values;
- one fixed `initialized` notification only after the response validates; and
- terminal failure for malformed, oversized, unknown, duplicated, or out-of-order server input.

There is no process discovery or launch, WebSocket or network transport, generic JSON-RPC method,
account/usage adapter, credential-store access, device key, upload, scheduler, CLI, installer, or
release artifact. The [compatibility matrix](../../docs/reference/codex-compatibility.md) remains
empty until a pinned Codex release passes the complete schema, fixture, privacy, process, and
platform admission process.

Run the focused gate from the repository root:

```text
cargo test --workspace --all-targets --all-features --locked
```

The root `pnpm run verify` additionally checks formatting, Clippy, licenses, public-data safety, and
the rest of the repository.
