# ADR 0023: Bounded candidate App Server process supervisor

- Status: Accepted (library-only supervisor; executable admission pending)
- Date: 2026-07-15
- Decision owners: Connector, Security, Privacy, Compatibility, and Release
- Supersedes: None
- Superseded by: None

## Context

ADRs 0021 and 0022 implement the fail-closed stable handshake and exact `0.144.4` candidate
account/usage parser without a process boundary. Phase 2 also requires a local child with a bounded
lifetime and output, separate stderr, sanitized environment, fixed arguments and working directory,
and deterministic cleanup. Directly accepting a caller-provided path would prematurely combine those
mechanics with the harder executable-admission decision: link resolution, path ownership and
writability, artifact provenance, exact version selection, user-visible confirmation, and
cross-platform policy.

TB-03 treats every App Server byte, timing decision, and process exit as hostile. TB-04 also treats
the ambient environment, working directory, scheduler, and selected path as attacker-controlled. The
process slice therefore needs real child evidence without making an arbitrary executable API or
claiming that a locally installed Codex release is safe to run.

## Decision

Add a one-shot Rust supervisor behind `ReviewedCodexLaunch`. The capability privately owns an
executable path, isolated working directory, and explicit environment values, has no `Debug`,
accessor, or public constructor, and cannot be assembled by a crate consumer. A future admission
boundary must resolve and verify every value before constructing it inside the crate. The collector
does not read the parent environment at launch time.

For a capability that has already passed that future boundary, the supervisor:

- invokes the executable directly with exactly one `app-server` argument and never uses a shell;
- fixes the capability-owned working directory, calls `env_clear`, and re-adds only a small
  platform-specific key allowlist from the capability; `PATH`, `CODEX_HOME`, API-key, token, and
  other ambient variables are not inherited;
- uses local piped stdin, stdout, and stderr only and requests a hidden child window on Windows;
- writes only the existing compile-time handshake, initialized, account, and usage messages;
- admits at most three stdout frames, each under the existing 16 KiB whole-frame limit, so an
  unsolicited fourth response or unterminated oversized frame fails closed;
- drains stderr on its own thread, retains none of its bytes, and terminates after more than 8 KiB;
- allows at most 10 seconds for one response and 45 seconds for the whole child;
- closes stdin after the final response, allows 500 milliseconds for graceful exit, then kills and
  waits when needed;
- joins both output readers, drains terminal events, and returns `DailyUsage` only after the child
  has been reaped; and
- returns stable errors that contain no path, environment value, child output, status detail, or
  operating-system error. Every explicit failure synchronously attempts termination, reap, and
  reader joins; RAII repeats best-effort cleanup on any remaining or unwinding path.

`CandidateCodex01444Collector` composes the already reviewed state machines in this fixed order:
initialize request/response, initialized notification, account request/response, usage
request/response, terminal-output check, and cleanup. It exposes no generic frame writer, method,
argument, environment, or process API.

Add a Rust fixture binary enabled only by the `process-test-fixture` Cargo feature. The fixture
requires the exact `app-server` argument, selects synthetic behavior only from its isolated test
working-directory name, speaks the fixed protocol, and can intentionally remain silent, exit,
linger, or overload either output pipe. It is test infrastructure in a non-publishable crate, not a
connector artifact; future packaging and release checks must exclude it explicitly.

This decision does not make `ReviewedCodexLaunch` publicly constructible, identify or admit an
installed binary, verify or execute the official `0.144.4` artifact, establish a supported platform,
access a Codex account, store a device key, sign or upload data, create a CLI, or add a
compatibility row.

## Security and privacy consequences

The fixed direct invocation removes shell interpolation and arbitrary arguments from the future
process boundary. Clearing the ambient environment prevents silent `CODEX_HOME`, `PATH`, API-key, or
token inheritance; an eventual admission layer must obtain any required home/runtime values from
reviewed operating-system sources and place only those values in the capability. The working
directory is likewise capability-owned so a caller cannot silently make a repository the child
context.

Stdout memory is bounded by three finite frames, stderr is discard-only and byte-bounded, deadlines
bound silence, and success depends on terminal event review plus reap. Late stderr flooding or a
fourth stdout frame cannot race after the usage parser and still return data. Stable errors and
private capability fields prevent untrusted content, local paths, environment values, and process
details from entering diagnostics.

The supervisor adds no persistent, logged, cached, exported, or networked field. Its only successful
result is the already mapped minimized date/token collection in caller memory. The fixture uses
synthetic reserved values and a temporary directory; it never discovers Codex or reads a local
account.

Affected invariants are VR-PUBLIC-001, VR-CODEX-001, VR-CODEX-002, and VR-RELEASE-001. Primary
attacker stories are VR-ABUSE-CONNECTOR-LOCAL, VR-ABUSE-RESOURCE-EXHAUSTION, and
VR-ABUSE-RELEASE-SUBSTITUTION.

## Alternatives considered

- **Accept an arbitrary executable path in the public collector:** rejected because lexical
  absolute-path checks cannot establish Windows ACL ownership, link safety, release provenance, or
  version admission.
- **Read a path or Codex home from the ambient environment:** rejected because a poisoned scheduler
  or parent process could silently select a binary or account context.
- **Inherit the full environment and remove a short denylist:** rejected because secret and override
  variable names are open-ended; clearing then allowlisting is the fail-closed direction.
- **Capture stderr for diagnostics:** rejected because it may contain account, path, prompt, or
  credential material. This slice keeps only a byte counter and returns no child text.
- **Use `wait_with_output`:** rejected because it buffers complete output and does not provide the
  fixed frame, stderr, response, or lifetime limits required here.
- **Return usage before cleanup settles:** rejected because a lingering or late-flooding child would
  become invisible to the caller while data continued toward signing or upload.
- **Execute a developer's installed Codex for integration evidence:** rejected because no reviewed
  path/provenance admission exists and repository verification must not touch a real account.

## Migration and rollback

This change adds one library module, public capability/collector/error types, constants, unit tests,
and a feature-gated synthetic binary target. It adds no dependency, stored data, environment
variable, network route, service, release artifact, support row, or database migration. Rollback
removes the supervisor exports, module, fixture target, tests, and this decision; the standalone
ADRs 0021/0022 protocol state machines remain usable for synthetic parser verification.

The next executable-admission slice must construct the capability only after platform-specific link,
ownership/writability, artifact, version, working-directory, and explicit environment review. It
must add clean-machine evidence without weakening this supervisor or populating the matrix. A future
release pipeline must also prove that the synthetic fixture cannot enter connector packages.

## Verification

Nine Rust unit cases execute the production supervisor against the target-built fixture and prove:

- one direct fixed argument, fixed working directory, ambient-environment clearing, and allowlist
  filtering that excludes silent overrides, tokens, API keys, and `PATH`;
- exact handshake, initialized, account, and usage order with only minimized sorted output;
- bounded response timeout and prompt reap of a silent child;
- stdout and stderr overload rejection both before and immediately after the final usage response;
- early-exit, nonzero terminal status, malformed-frame, missing-executable, and non-reflective error
  behavior; and
- graceful exit plus forced kill/wait/join when a valid child ignores closed stdin.

The existing ten account/usage and seven handshake tests remain independent. Root verification also
runs Rust formatting, checking, all-target/all-feature tests, Clippy with warnings denied, public
data scanning, documentation/architecture checks, compatibility evidence checks, and license
inventory. Current execution evidence is synthetic Windows-only; no test claims official-artifact,
installed-Codex, account, macOS/Linux, packaging, signing, upload, or release behavior.

## References

- [ADR 0021](0021-fail-closed-codex-handshake-foundation.md)
- [ADR 0022](0022-candidate-codex-account-usage-adapter.md)
- [Connector library](../../crates/connector/README.md)
- [Compatibility policy](../architecture/COMPATIBILITY_POLICY.md)
- [Codex compatibility matrix](../reference/codex-compatibility.md)
- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
