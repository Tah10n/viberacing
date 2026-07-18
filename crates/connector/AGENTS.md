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
- Keep App Server communication on local stdio only. Connector commands may call only the two
  versioned pairing paths, the versioned Community sync path, and the proposal-only CarRecipe path
  over HTTPS (or explicit loopback HTTP), with proxies and redirects disabled; do not add WebSocket,
  generic TCP/URL methods, shell interpolation, or inherited secret access.
- Never read, retain, log, or transmit prompts, conversations, repositories, Codex credentials,
  account email, or App Server paths.
- Treat exact sync bodies, daily usage, nonces, and device-signature messages as private security
  material. Keep their types non-reflective, bind signatures to returned bytes, and match the
  versioned Ingest authentication policy and shared synthetic vector exactly.
- Keep source/device/time/nonce context construction confined to the reviewed one-shot sync command,
  which owns source binding, canonical time, and replay behavior. The composer/signer boundary must
  not grow a scheduler, generic upload client, or Codex network client. Pairing key
  generation/storage remains confined to the one-command native-store boundary.
- Keep `propose-car` confined to explicit version 1 enum flags and a bounded seed. It may load only
  an active native device record, sign the exact proposal-domain body message, send once without
  retry, and accept only the generic acknowledgement. Never add prompts, conversation, arbitrary
  JSON, proposal reads, approval, activation, or profile administration to this command.
- Pairing possession must match `connector-pairing-authentication.json` byte for byte. Keep the
  pending key/challenge capabilities inaccessible outside the crate, sign only the fixed
  domain-separated message, and keep poll-token custody, HTTP, and native storage in `connect.rs`;
  browser approval remains server-side.
- Keep `forget-local` confined to exact canonical origin/label credential deletion. It must not load
  or decode the record, construct a signer, contact a server, imply revoke, reveal whether an entry
  existed, or become callable through the proposal-only Agent Skill.
- A generated schema proves only the exact Codex CLI version that generated it. Do not mark a
  version supported until its checked-in fixtures and fail-closed compatibility tests pass.
- Candidate schema/parser evidence is not support. Keep the public matrix empty until the manifest
  has no blockers and executable admission, official-artifact, platform, privacy-egress, packaging,
  and release evidence all pass.
- Keep executable admission, sync upload, credential rotation, server-revoke composition, packaging,
  and desktop UI outside a parser/composer/signer or pairing-client change unless the task
  explicitly includes that boundary.

Run `cargo test --workspace --all-targets --all-features --locked` while developing. Before handoff,
run the root `pnpm run verify` gate.
