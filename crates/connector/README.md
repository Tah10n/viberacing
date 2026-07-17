# Vibe Racing connector and bounded protocol foundation

This Rust crate contains the fail-closed local Codex App Server initialization boundary and one
candidate-only account/usage adapter for the exact `0.144.5` schema extract. It also contains a
bounded one-shot child supervisor behind a reviewed-launch capability with no public constructor, an
isolated pairing-possession signer, and an exact-body Community sync composer/request signer behind
inaccessible reviewed capabilities. One runnable `connect` command completes the versioned pairing
journey with native OS key custody. A second Windows x86_64 development command admits one exact
Codex candidate, collects, signs, and uploads one bounded sync. It is not a supported, packaged, or
released connector. A third fixed command signs one explicit enum-only CarRecipe proposal without
starting Codex or receiving proposal decision authority.

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
  against one synthetic vector shared with the production Ingest verifier;
- an unsigned prepared type with no public accessors, clone, diagnostic, or serialization surface;
- one consumed device-bound key capability, exact device-ID equality, Ed25519 signing of only that
  prepared message, and an exact body-plus-five-header signed envelope; and
- key/body/message drop zeroization plus cross-language verification of the synthetic public key and
  signature, including rejection of a one-byte message mutation;
- the exact four-field LF-separated pairing-possession message with no trailing separator, binding
  one canonical version-4 pairing ID, exact 32-byte server challenge, and the public key derived
  from the consumed pending private-key capability; and
- a one-use proof exposing only the pairing ID and canonical signature, checked against a second
  synthetic Rust/Web vector that uses the same public key as the sync vector;
- one exact `connect --origin <origin> --label <label>` command with HTTPS-only remote origins,
  explicit loopback HTTP development support, disabled proxies/redirects, platform certificate
  verification, 1024/2048-byte request/response ceilings, and fixed ten/five-second request/connect
  deadlines;
- OS CSPRNG generation of one Ed25519 key plus a non-authoritative 16-byte rate ID, stored in a
  fixed versioned binary record through Windows Credential Manager, macOS Keychain, or Linux Secret
  Service with no plaintext or supported-platform mock fallback;
- prepared/pending/active persistence that saves before authority is displayed, resumes an
  interrupted poll, retries every two seconds for at most eight local minutes, and saves activation
  before success output; and
- output limited to the exact `/connect` URL, human code, generic progress, and success without key,
  token, challenge, source, or device identifiers;
- one explicit `sync --origin <origin> --label <label> --codex <absolute-path>` command that
  requires an active record and never discovers a binary or accepts an environment path override;
- Windows x86_64 admission for the exact `0.144.5` official artifact byte count and SHA-256 digest,
  with exact-version-only output and a no-write-sharing handle retained through direct launch;
- fresh OS-random sync ID and nonce, canonical millisecond UTC, active-record source/device/key
  binding, and one existing exact composition/signing path;
- one fixed `/v1/community/sync` POST with proxies and redirects disabled, platform TLS, only the
  five device headers, an 8192-byte request, and a closed 1024-byte acknowledgement; and
- no automatic retry after an ambiguous POST and only generic accepted, duplicate, or review output.
- one exact `propose-car` command whose seven enum flags and canonical `0..65535` seed serialize to
  `CarRecipeV1`, with no prompt, free text, profile/source/proposal ID, file, URL, or arbitrary
  JSON;
- fresh OS-random nonce and canonical millisecond UTC bound with the active device ID and exact
  512-byte body digest under a proposal-specific Ed25519 domain separator;
- one fixed `/v1/connector/cars/proposals` POST through the same proxy-free, redirect-free TLS
  agent, no retry, a closed generic acknowledgement, and output containing no identifier or recipe
  data; and
- drop clearing for every owned proposal body, signature-message, raw-nonce, encoded-nonce, and
  encoded-signature byte buffer.

`ReviewedCodexLaunch`, `PendingDevicePairingSigningKey`, `ReviewedPairingChallenge`,
`ReviewedCommunitySyncContext`, and `ReviewedDeviceSigningKey` have no public constructors. The
private pairing command constructs only its two pending capabilities; the private sync command can
construct the launch/context/key capabilities only after exact artifact and active-record review.
There is no automatic discovery, macOS/Linux executable admission, WebSocket transport, generic
JSON-RPC or HTTP method, scheduler, installer, credential rotation/uninstall, package, or release
artifact. Browser approval and edge origin proof remain separate server-side boundaries. The
checked-in [`0.144.5` candidate evidence](../../compat/codex/0.144.5/manifest.json) is development
evidence only. The [compatibility matrix](../../docs/reference/codex-compatibility.md) remains empty
until clean-machine platform, privacy, packaging, provenance, and release evidence all pass.

The local command shapes are:

```text
viberacing-connector connect --origin <https-origin> --label <device-label>
viberacing-connector sync --origin <https-origin> --label <device-label> --codex <absolute-path>
viberacing-connector propose-car --origin <https-origin> --label <device-label> --chassis <formula|rally|roadster> --nose <classic|scoop|wedge> --cockpit <canopy|open|rally> --wing <high|low|none> --wheels <all-terrain|slick|street> --palette <magenta|mint|redline|sunburst|turbo-blue> --trail <grid|none|spark> --seed <0..65535>
```

Plain HTTP with `localhost`, `127.0.0.1`, or `::1` is accepted only for explicit local development.
Running `connect` creates a real local keyring entry even when the server later fails; use one
connect process at a time. `sync` is Windows x86_64 candidate development behavior: it reads the
active native record, starts only the exact admitted artifact, and sends private daily usage once to
the explicit origin. `propose-car` uses the same active native record but starts no Codex process
and can only create a private proposal for later browser review. No checked-in default server,
credential, code, or released binary exists.

Run the focused gate from the repository root:

```text
cargo test --workspace --all-targets --all-features --locked
node scripts/check-codex-compatibility.mjs
```

The root `pnpm run verify` additionally checks formatting, Clippy, licenses, public-data safety, and
the rest of the repository. Rust tests launch only target-built synthetic fixtures and ephemeral
loopback HTTP; they never execute a local Codex account, open a real user credential, or upload real
usage.
