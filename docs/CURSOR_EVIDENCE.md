# Cursor exact-usage evidence gate

Status on 2026-09-03: **closed**. Cursor is not a registered Vibe Racing agent and contributes no
ranking usage.

This document records the investigation boundary for adding Cursor Desktop and Cursor CLI as one
future `cursor` agent. Vibe Racing enables a collector only after a current, reproducible source
proves provider-recorded integer token counters, stable local deduplication identities, UTC
attribution, and privacy-safe account separation for every supported surface. Request counts,
context-window occupancy, text-derived estimates, costs, and subscription dashboards are not token
usage. Cursor's Team [Admin API](https://prod.cursor.com/docs/account/teams/admin-api) and
[Organization API](https://prod.cursor.com/docs/account/organizations/organization-admin-api) do
publish exact `tokenUsage` for some team usage events, but they are credentialed,
organization-level, non-universal feeds and are outside this local Desktop/CLI evidence gate. They
do not establish the required local source or account-switch contract.

## Evidence reviewed

The repository base was `de23c761ff08686a69e96c8c4ea67625fca4d6e4` from `main`.

- The official [Cursor download page](https://cursor.com/download) offered Desktop 3.18. The local
  macOS application was 3.0.12 and displayed the signed-out screen, so it could not produce a real
  Desktop turn or account-switch sequence.
- The stable CLI installer resolved to build `2026.09.02-c22c1a3`. A fresh isolated copy reported
  that version, but `agent status --format json` reported `unauthenticated`, with neither an access
  nor refresh token. No authenticated CLI turn was available.
- The documented [CLI output formats](https://docs.cursor.com/en/cli/reference/output-format) expose
  terminal result/session metadata and streamed prompt, text, and tool events. The documented
  terminal result has no input, output, cache-read, cache-write, reasoning, or total token field.
  The streamed events are content-bearing and are therefore not a safe Vibe Racing usage source.
- The current [Cursor hooks](https://cursor.com/docs/hooks) document common conversation,
  generation, model, workspace, email, transcript, and version fields. `afterAgentResponse`, `stop`,
  and `sessionEnd` document response/status/lifecycle fields, but no exact token counters. Those
  content-bearing fields cannot be retained by Vibe Racing.
- Cursor documents [CLI authentication](https://docs.cursor.com/en/cli/reference/authentication) and
  [headless operation](https://docs.cursor.com/en/cli/headless), but neither reference establishes a
  privacy-safe exact-usage ledger shared with Desktop.

The investigation found no current official local schema that proves exact per-event token counters
for both Desktop and CLI. It also could not prove stable event IDs across live and history views,
account identity during A/B/A switching, subagent attribution, aborted-turn semantics, UTC-midnight
attribution, history retention, or reconciliation after an offline period. An older undocumented
shape is not sufficient evidence for a current parser.

Consequently this change deliberately does **not**:

- add `cursor` to either registry;
- add migration 012 or any source rows;
- add a connector adapter, discovery rule, lifecycle integration, or sync trigger;
- change protocol v5, aggregation semantics, or connector version 0.6.0;
- use Team/Admin/Organization APIs, browser cookies, request counts, estimates, a daemon, or a
  watcher.

## Opt-in local probe

The repository-only probe helps an authenticated Cursor user gather future schema evidence without
putting raw payloads in this repository. It is research tooling, not part of the published connector
archive and not a production collector.

Choose a new absolute output directory outside the repository. The probe creates a missing directory
as owner-only and rejects an existing directory that is accessible to another user. On POSIX it
enforces owner-only modes. On Windows it applies and verifies current-user-only ACLs for probe
state, observations, and installed launcher files. It stores only:

- structural field paths and primitive types, with unrecognized field names replaced by local HMACs;
- allowlisted non-negative integer token fields as canonical decimal strings;
- locally HMACed account and event identities;
- a parse status, safe Cursor version/status, and parseable provider timestamp.

It never stores raw prompt, response, code, tool payload, transcript, repository, path, email,
provider account ID, credential, model, cost, stdout, stderr, or unrecognized scalar value. Review
the script before use; do not share the output directory because even minimized local evidence may
describe account-switch patterns.

### Desktop and interactive CLI hooks

Install additive probe-owned hooks for one surface and scenario:

```bash
node scripts/cursor-evidence-probe.mjs install-hooks \
  --output-dir /absolute/private/cursor-evidence \
  --surface desktop \
  --scenario desktop-one-turn \
  --run-id 11111111-1111-4111-8111-111111111111 \
  --step single
```

Run only the named scenario, then remove the probe entries. Foreign hook entries and unknown
top-level hook configuration are preserved:

```bash
node scripts/cursor-evidence-probe.mjs remove-hooks \
  --output-dir /absolute/private/cursor-evidence
```

Repeat installation with `--surface cli-interactive` for interactive CLI scenarios. `surface`,
`scenario`, `run-id`, and `step` are operator-declared labels, not claims inferred from Cursor.
Installation writes a fixed relative launcher under `~/.cursor/hooks/`; dynamic paths never enter a
shell command. An owned lock, file fingerprint comparison, exclusive no-replace publication, and a
recoverable displaced-file journal preserve concurrent foreign edits, with one retry before failing
closed. Installation also fails closed for linked, oversized, non-regular, or other-user hook files.
It never changes Cursor hook trust or bypasses an approval UI.

### Headless CLI

Wrap an explicitly chosen absolute `agent` executable. Arguments after `--` are forwarded; the
wrapper requires official `stream-json`, forwards stdout/stderr and termination signals, and
preserves the exit status while saving only sanitized observations:

```bash
node scripts/cursor-evidence-probe.mjs run-cli \
  --output-dir /absolute/private/cursor-evidence \
  --agent /absolute/path/to/agent \
  --scenario cli-headless-one-turn \
  --run-id 22222222-2222-4222-8222-222222222222 \
  --step single \
  -- --print "your private prompt"
```

The wrapper uses a streaming UTF-8 decoder, honors stdout backpressure, processes and saves records
sequentially, waits for stdio `close`, terminates and awaits the child after a processing failure,
removes temporary signal listeners, and preserves the child's exit code or terminating signal.
Malformed middle records, unterminated tails, byte limits, and observation limits leave an explicit
non-qualifying observation without suppressing later complete records.

For an already captured local JSONL file, `inspect-jsonl` performs the same bounded streaming
sanitization and also requires `--run-id` and `--step`. The input must be an absolute, current-user,
single-link regular file and is never copied into the output directory.

### Required scenarios

Run and label all ten scenarios independently:

1. `desktop-one-turn`
2. `cli-interactive-one-turn`
3. `cli-headless-one-turn`
4. `desktop-cli-same-account`
5. `desktop-cli-different-accounts`
6. `cli-a-b-a`
7. `desktop-a-b-a`
8. `subagent`
9. `aborted-error`
10. `utc-midnight`

Generate the minimized coverage report with:

```bash
node scripts/cursor-evidence-probe.mjs report \
  --output-dir /absolute/private/cursor-evidence
```

`mechanicalCoverageComplete: true` means only that the probe mechanically verified the explicit
steps for all ten scenarios: same/different account relationships, CLI and Desktop A/B/A reuse,
three usage-bearing surfaces, parent/subagent observations, aborted/error status, UTC rollover, and
one hook/history identity reconciliation. Ambiguous timestamps/accounts, invalid counters,
truncation, and incomplete scenarios cannot qualify. Email aliases and case-sensitive opaque account
IDs are HMACed separately and are linked into one local account only when they co-occur in an
unambiguous observation.

`productionGate` is always `closed`, and `limitations` is never empty. The report lists only
observed candidate counter equalities; it does not select an authoritative token formula. Before
production code, a reviewer must authenticate the source, interpret the minimized schemas, and
reproduce every scenario against current stable Desktop and CLI versions. A fixture may be committed
only after proving that it contains no private content.

## Acceptance boundary for a future integration

A later Draft PR may add `cursor` only when evidence proves all of the following together:

- Desktop, interactive CLI, and headless CLI expose the same authoritative usage semantics;
- exact `input + output + cache read + cache write = total`, with reasoning represented according to
  the provider's documented non-overlapping formula;
- stable event identity deduplicates hook, history, retry, restart, copied, and repeated records;
- account identity is locally stable across A/B/A switching without sending provider identity;
- subagent usage and aborted/error turns have explicit, tested ownership and accounting behavior;
- provider timestamps support exact UTC-day attribution and retained history can reconcile offline
  gaps without double counting;
- malformed, fractional, negative, overflowed, ambiguous, or schema-drifted records fail closed.

Until then, Cursor remains visibly unsupported rather than approximately counted.
