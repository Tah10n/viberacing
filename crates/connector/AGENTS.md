# Connector guidance

This crate is the native, least-privileged provider-reader and connector protocol boundary. Read the
root `AGENTS.md`, `docs/architecture/SECURITY_INVARIANTS.md`,
`docs/architecture/COMPATIBILITY_POLICY.md`, and `docs/reference/codex-compatibility.md` before
changing it.

- Keep `unsafe` forbidden and keep every inbound frame, string, collection, and state transition
  explicitly bounded.
- Treat App Server stdout as untrusted JSONL. Reject malformed, duplicate, unknown, experimental,
  out-of-order, and over-budget messages without reflecting their content into errors or logs.
- Emit only reviewed method names and fixed-shape parameters. Never add a generic arbitrary-method
  escape hatch.
- Keep App Server communication on local stdio only. Connector commands may call only the two
  versioned pairing paths, the versioned Community usage path, and the proposal-only CarRecipe path
  over HTTPS (or explicit loopback HTTP), with proxies and redirects disabled; do not add WebSocket,
  generic TCP/URL methods, shell interpolation, or inherited secret access.
- Never read, retain, log, or transmit prompts, conversations, repositories, Codex credentials,
  account email, or App Server paths.
- Treat exact usage bodies, daily usage, nonces, and device-signature messages as private security
  material. Keep their types non-reflective, bind signatures to returned bytes, and match the
  `UsageSyncV1` Ingest authentication policy and shared synthetic vector exactly. No legacy
  Community sync route or connector fallback exists before the first release.
- Keep AgentAccount/device/time/nonce context construction confined to the reviewed account-scoped
  sync command, which owns server binding, canonical time, and replay behavior. The composer/signer
  boundary must not grow a scheduler, generic upload client, or provider network client.
  Installation and per-candidate key generation/storage remain confined to the native-store
  boundary.
- Keep candidate executable selection confined to Windows x86_64, the two reviewed fixed filenames,
  absolute `PATH` entries, canonical path/directory/hash budgets, exact candidate size/SHA-256, and
  the retained no-write-sharing handle. `sync` must perform that selection only after validation of
  the exact active record. The sole credential-free exception is explicit `check-codex`, which may
  reuse only the same selector and must not open credential storage, start a process, read an
  account, persist a result, use a network, or become callable through the proposal-only Agent
  Skill. Its optional diagnostic preview may expose only the reviewed compile-time versions, fixed
  platform contract, closed admission class, and empty support state; it must omit local values,
  retain failure status, and never save or send output. Never add environment-derived executable
  extensions, wrappers, shell lookup, recursive or registry search, version negotiation, path
  reflection, or a way for explicit `--codex` to bypass identical admission.
- Keep `propose-car` confined to explicit version 1 enum flags and a bounded seed. It may load only
  an active native device record, sign the exact proposal-domain body message, send once without
  retry, and accept only the generic acknowledgement. Never add prompts, conversation, arbitrary
  JSON, proposal reads, approval, activation, or profile administration to this command.
- Pairing-start and poll possession must match `connector-pairing-authentication.json` byte for
  byte. Bind start proof to the canonical ordered manifest and persist an uncertain-start state
  before HTTP. Keep pending key/challenge capabilities inaccessible outside the crate, keep
  poll-token custody, HTTP, and native storage in `connect.rs`, and leave browser approval
  server-side.
- Keep `forget-local` confined to deletion of the fixed installation entry and deterministic
  account-slot inventory. It must not load or decode a record, construct a signer, contact a server,
  imply revoke, reveal which entries existed, or become callable through the proposal-only Agent
  Skill.
- A generated schema proves only the exact Codex CLI version that generated it. Do not mark a
  version supported until its checked-in fixtures and fail-closed compatibility tests pass.
- Candidate schema/parser evidence is not support. Keep the public matrix empty until the manifest
  has no blockers and executable admission, official-artifact, platform, privacy-egress, packaging,
  and release evidence all pass.
- Keep executable admission, sync upload, credential rotation, server-revoke composition, packaging,
  and desktop UI outside a parser/composer/signer or pairing-client change unless the task
  explicitly includes that boundary.

Run `cargo test --workspace --all-targets --all-features --locked` while developing. Before handoff,
run the root `pnpm run verify` gate. Use `pnpm run verify:release` and the Windows portable
lifecycle only for release preparation or when those exact boundaries change.
