# Connector guidance

This crate is the native, least-privileged Codex App Server protocol boundary. Read the root
`AGENTS.md`, `docs/architecture/SECURITY_INVARIANTS.md`,
`docs/architecture/COMPATIBILITY_POLICY.md`, and `docs/reference/codex-compatibility.md` before
changing it.

- Keep `unsafe` forbidden and keep every inbound frame, string, collection, and state transition
  explicitly bounded.
- Treat App Server stdout as untrusted JSONL. Reject malformed, duplicate, unknown, experimental,
  out-of-order, and over-budget messages without reflecting their content into errors or logs.
- Emit only reviewed method names and fixed-shape parameters. Never add a generic arbitrary-method
  escape hatch.
- Use local stdio only. Do not add WebSocket, TCP, remote URL, shell interpolation, inherited secret
  access, or direct network transport.
- Never read, retain, log, or transmit prompts, conversations, repositories, Codex credentials,
  account email, or App Server paths.
- A generated schema proves only the exact Codex CLI version that generated it. Do not mark a
  version supported until its checked-in fixtures and fail-closed compatibility tests pass.
- Candidate schema/parser evidence is not support. Keep the public matrix empty until the manifest
  has no blockers and executable admission, official-artifact, platform, privacy-egress, packaging,
  and release evidence all pass.
- Keep process launch, credential storage, upload, and desktop UI outside a parser change unless the
  task explicitly includes that boundary.

Run `cargo test --workspace --all-targets --all-features --locked` while developing. Before handoff,
run the root `pnpm run verify` gate.
