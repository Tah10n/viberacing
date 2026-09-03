# Cursor exact-usage evidence gate

Status on 2026-09-03: **closed**. Cursor is not a registered Vibe Racing agent and contributes no
ranking usage.

This document records the investigation boundary for adding Cursor Desktop and Cursor CLI as one
future `cursor` agent. Vibe Racing enables a collector only after a current, reproducible source
proves provider-recorded integer token counters, stable local deduplication identities, UTC
attribution, and privacy-safe account separation for every supported surface. Request counts,
context-window occupancy, text-derived estimates, costs, subscription dashboards, and
organization/admin APIs are not token usage.

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

The root-only probe helps an authenticated Cursor user gather future schema evidence without putting
raw payloads in this repository. It is research tooling, not part of the published connector archive
and not a production collector.

Choose a new absolute output directory outside the repository. The probe creates a missing directory
as owner-only and rejects an existing directory that is accessible to another user. It stores only:

- structural field paths and primitive types;
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
  --scenario desktop-one-turn
```

Run only the named scenario, then remove the probe entries. Foreign hook entries and unknown
top-level hook configuration are preserved:

```bash
node scripts/cursor-evidence-probe.mjs remove-hooks \
  --output-dir /absolute/private/cursor-evidence
```

Repeat installation with `--surface cli-interactive` for interactive CLI scenarios. Installation
fails closed for linked, oversized, non-regular, or other-user hook files. It never changes Cursor
hook trust or bypasses an approval UI.

### Headless CLI

Wrap an explicitly chosen absolute `agent` executable. Arguments after `--` are forwarded; the
wrapper requires official `stream-json`, forwards stdout/stderr and termination signals, and
preserves the exit status while saving only sanitized observations:

```bash
node scripts/cursor-evidence-probe.mjs run-cli \
  --output-dir /absolute/private/cursor-evidence \
  --agent /absolute/path/to/agent \
  --scenario cli-headless-one-turn \
  -- --print "your private prompt"
```

For an already captured local JSONL file, `inspect-jsonl` performs the same bounded streaming
sanitization. The input must be an absolute, current-user, single-link regular file and is never
copied into the output directory.

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

`gatePassed: true` is only a mechanical signal that the required labels, three surfaces, two local
account keys, event identities, provider timestamps, valid counters, and the four-component total
formula were observed. It is not authorization to enable Cursor. Before production code, a reviewer
must inspect the minimized schemas and reproduce every scenario against the current stable Desktop
and CLI versions. A fixture may be committed only after proving that it contains no private content.

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
