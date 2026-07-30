# Vibe Racing connector

This crate is the thin, provider-neutral local connector for Vibe Racing. It owns bounded agent
discovery, privacy-minimized daily token collection, installation and account-scoped keys in the
operating-system credential store, batch pairing, and signed `UsageSyncV1` submission.

It is still an unreleased development connector. A checked manual-main candidate workflow and local
Windows candidate builder now cover the explicit five-target matrix, portable lifecycle, checksum,
compatibility manifest, SPDX, and GitHub attestation policy. No hosted matrix result, native
platform signature, official package, installer, public download, production endpoint, or real-user
ingestion evidence exists.

## Reader boundary

`AgentUsageReader` exposes only closed metadata, opaque local handles, safe labels, UTC dates, and
cumulative decimal token totals. Raw provider records stay private to each reader implementation.
The canonical boundary has no fields for prompts, conversations, code, repositories, paths, email,
login, access tokens, API keys, plan, price, model, or billing data.

The checked-in Codex reader:

- admits only the exact Windows x86_64 Codex `0.144.5` candidate artifact;
- uses fixed local App Server JSONL methods and a cleared, allowlisted process environment;
- maps one explicit account-scoped candidate to at most 31 sorted UTC-day cumulative totals;
- discards email, plan, summary, home path, platform, user-agent, and fixture privacy sentinels;
- has exact parser, process, admission, privacy-egress, and reader fixtures.

Claude Code, opencode, Qwen Code, Cline, and Aider remain recognized without a reader. Recognition
grants no pairing or sync authority. Codex also remains out of the supported-provider registry: the
tree has synthetic batch-pairing and sync components, but not one authorized clean-machine
real-account read, one same-artifact composed connect/approval/credential/first-sync/snapshot
result, or the required package lifecycle and protected release evidence.

## Batch connection

`connect --origin <https-origin>` performs one bounded batch:

1. creates or loads one installation identity from the native credential store;
2. runs each enabled built-in reader once and displays only safe candidate metadata and the current
   UTC-week preview;
3. creates one separate Ed25519 account key for each of at most 16 candidates;
4. signs the exact canonical discovery-manifest digest with the installation key;
5. persists a `starting` state before the pairing-start HTTP request;
6. opens the returned `/connect?code=...` deep link and always prints the URL and fallback code;
7. polls with the separate installation possession proof;
8. persists approved account bindings and deletes skipped candidate keys;
9. performs one first sync for each activated account before printing the final aggregate.

An ambiguous pairing-start result is never retried automatically. The persisted `starting` state
blocks discovery and network reuse until its bounded expiry, because the server may have committed
the first request. Pending pairing is resumable. Active installation state blocks an accidental
second enrollment.

The start signature binds the canonical manifest digest, a local high-entropy rate identifier,
canonical millisecond UTC, and a nonce. The manifest binds connector/platform metadata, ordered
candidates, exact reader/accounting/scope metadata, account public keys, safe preview totals, and
the installation public key. Pairing approval and provider/account binding remain server-side.

## Local credentials

The connector uses one fixed installation entry and 16 deterministic account slots in Windows
Credential Manager, macOS Keychain, or Linux Secret Service. Fixed-shape versioned records bind the
exact origin digest and reject unknown versions, padding drift, invalid state, and cross-origin
reuse. There is no plaintext private-key fallback and no supported-platform file-store fallback.

Each active account key is independently revocable server-side. Installation possession cannot
submit usage. An account key cannot approve pairing, manage another account, change provider or
accounting revision, manage passkeys, or delete a profile.

`forget-local` deletes the exact fixed local inventory without first loading or decoding it. It does
not revoke server authority. `disconnect` opens the authenticated dashboard revoke flow because
device revocation is a fresh-passkey action; the connector does not silently weaken that boundary.

## Usage sync

`sync` discovers the enabled readers and submits each active account independently.
`account sync <1..16>` selects one active local slot. Each request:

- uses a fresh `syncId`, nonce, and canonical millisecond UTC;
- contains only a server-issued `agentAccountId`, reader version, and bounded UTC-day decimal
  cumulative totals;
- is signed by the matching account-scoped key over the exact body digest and request context;
- sends one proxy-free, redirect-free request to `/v1/usage`;
- accepts only the closed acknowledgement; and
- is not automatically retried after an ambiguous POST.

Provider, accounting revision, scope, trust tier, profile, and competitive metric are derived by the
server from the device-key binding. The sync body cannot set them.

## Other bounded commands

```text
viberacing-connector connect --origin <https-origin>
viberacing-connector sync [--codex <absolute-path>]
viberacing-connector status
viberacing-connector doctor
viberacing-connector account list
viberacing-connector account sync <1..16>
viberacing-connector disconnect
viberacing-connector forget-local
viberacing-connector check-codex [--codex <absolute-path>] [--diagnostic-preview]
viberacing-connector propose-car --origin <https-origin> --label <device-label> --chassis <formula|rally|roadster> --nose <classic|scoop|wedge> --cockpit <canopy|open|rally> --wing <high|low|none> --wheels <all-terrain|slick|street> --palette <magenta|mint|redline|sunburst|turbo-blue> --trail <grid|none|spark> --seed <0..65535>
```

Remote origins require HTTPS. Plain HTTP is allowed only for explicit `localhost`, `127.0.0.1`, or
`::1` development origins. Browser opening uses fixed platform programs without a shell or inherited
environment. Status, doctor, account-list, removal, and success output omit key material, poll
tokens, challenges, and server account/device identifiers.

`check-codex` performs only point-in-time artifact admission: no credential store, child process,
account read, persistence, or network. Its optional diagnostic preview is closed and redacted.
`propose-car` starts no agent process and accepts only exact `CarRecipeV1` enums and a bounded seed.

## Verification

From the repository root:

```text
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo test --workspace --all-targets --all-features --locked
node scripts/check-codex-compatibility.mjs
pnpm run test:connector:windows-portable
pnpm run test:connector:release-candidate
```

Tests use synthetic fixtures and ephemeral loopback HTTP only. They do not execute a real user
account, write a real production credential, upload real usage, or prove a hosted run.
