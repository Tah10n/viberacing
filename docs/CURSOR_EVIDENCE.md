# Cursor exact-usage evidence gate

Status on 2026-09-04: **exact-source evidence accepted; production implementation in progress**.
This branch registers Cursor as the eighth server agent with `source_sum` and migration 012. The
connector implements strict stop capture, account routing and the explicit headless wrapper; final
continuity, secondary deduplication and release checks remain in progress. Rollout remains blocked
until a reviewed server-first deployment. The historical investigation below describes the earlier
gate, not the current availability of authenticated token counters.

## Authenticated contract and narrow follow-up

Implementation base: `265ce5e82ad19d3867d8f6289fad055527b302d3` (main after PR #64). The accepted
local evidence establishes Desktop 3.18.25, interactive CLI `2026.09.02-c22c1a3`, successful
headless aggregate usage, matching Desktop/CLI account identity, matching headless result/sessionEnd
session identity, aggregate subagent accounting, and failed aborted invocations. Raw observations
and local identity hashes are not included here.

Selected exact paths in the minimized schemas:

| Contract                     | Counters                                                                                             | Account identity    | Event/correlation identity        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------- | --------------------------------- |
| Desktop / interactive `stop` | `$.input_tokens`, `$.output_tokens`, `$.cache_read_tokens`, `$.cache_write_tokens`                   | `$.user_email`      | `$.generation_id`, `$.session_id` |
| Headless final result        | `$.usage.inputTokens`, `$.usage.outputTokens`, `$.usage.cacheReadTokens`, `$.usage.cacheWriteTokens` | Bound by sessionEnd | `$.request_id`, `$.session_id`    |
| `sessionEnd`                 | None                                                                                                 | `$.user_email`      | `$.session_id`                    |

Hook version evidence uses `$.cursor_version`; headless CLI version evidence comes from the CLI
version invocation. The normalized probe counter names must not be mistaken for raw hook paths. The
accepted formula is input + output + cache read + cache write; reasoning is already in output. There
is no separately observed total counter in these contracts.

On 2026-09-04, two consecutive live Desktop turns were captured in one fresh session on Desktop
**3.19.7**. Session and account HMAC equality passed; generation HMAC inequality passed. Only the
following minimized counters are retained in this report:

| Turn   | Input | Output | Cache read | Cache write | Computed sum |
| ------ | ----: | -----: | ---------: | ----------: | -----------: |
| First  | 17193 |    230 |       2176 |           0 |        19599 |
| Second | 17467 |     29 |       2176 |           0 |        19672 |

The second output counter is smaller than the first in the same session, consistent with per-turn
usage and inconsistent with a monotonic cumulative session snapshot. The first test prompt was
affected by keyboard input translation and received a clarification response; the second was pasted
correctly and requested a minimal response. Both completed successfully. Temporary probe hooks and
their runtime artifacts were removed after capture; foreign hooks were preserved.

**Approved capture-time policy (2026-09-04):** the user explicitly approved using immutable
`capturedAt` and the UTC day of capture in place of the originally requested provider timestamp. A
stop hook fixes this time at invocation; the wrapper fixes it on receipt of the successful final
result. The first durable event keeps that time across retries, replay and delayed synchronization.
Headless attribution uses the result's capture time regardless of when sessionEnd arrives. Missing
or invalid capture time fails closed. This is exact captured usage, not provider-dated history.

None of the reviewed stop, final stream result, or sessionEnd observations contains a provider
timestamp. Production fixtures must not invent one. The approved policy changes UTC attribution; it
does not weaken counter, identity, schema, deduplication or lifecycle validation.

A narrow follow-up inspected the installed Desktop 3.19.7 and CLI `2026.09.02-c22c1a3` application
code. The CLI emits `timestamp_ms` on intermediate stream events using its own `Date.now()`; the
successful final result deliberately has no timestamp. This field was privacy- hashed by the earlier
probe, so its absence from `timestampCandidates` alone was not proof that all stream records lacked
times. Neither an intermediate delta timestamp nor `duration_ms` provides the final run's absolute
completion time. Official [hook reference](https://prod.cursor.com/docs/hooks) also exposes no
absolute lifecycle timestamp.

The Desktop hook producer supplies identities, counters, status and version, without an absolute
time. A read-only metadata query matched the latest generation of the two-turn session without
returning message content. Its serialized conversation state contained no persisted `turnTimings`.
Session-level `createdAt`/`lastUpdatedAt` and message creation times are not a durable,
per-generation completion contract. No provider store, log, transcript, or application-code
dependency has been added to the production connector. Capture time must not be relabeled as
provider time.

The existing evidence contains one local account identity across Desktop and CLI. Live A/B/A with a
second account remains unverified and is a Draft blocker. The server registry, policy-driven dynamic
registration, migration 012, Cursor labels/notices, and protocol-v1 account Sync presentation are
implemented in this branch. Local tests cover fresh/upgrade migration, idempotent registration,
cross-agent isolation and two machine-local Cursor sources summing 42 + 17 to 59 for one server
account. Browser E2E also checks Cursor account Sync with protocol v1 and accessibility.

The connector now implements a sanitized durable capture ledger, installation-owned stop/sessionEnd
hooks, physical-profile/logical-account routing, account-scoped and automatic synchronization, and
`viberacing run cursor -- <agent arguments>`. The wrapper selects a version-checked executable,
requires stream-json, preserves stdout/stderr and the child outcome, and commits only after a
successful process exit. A durable random marker suppresses its stop hook. Result/sessionEnd halves
pair in either order; the first result receipt determines UTC attribution. Aborted or malformed
streams add no usage. Synthetic installed-runtime tests cover these paths and raw-data exclusion.

Secondary stop/headless correlation without the marker, durable hook continuity, global checkpoint
and acknowledgement compaction integration, final standalone packaging, the full privacy matrix,
remaining live smoke and final cross-platform checks are still pending. These local tests do not
establish production readiness; live A/B/A remains a separate Draft blocker.

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

## Historical evidence reviewed on 2026-09-03

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
enforces owner-only modes. On Windows it changes ACLs only on newly created probe-owned directories
and files; existing output and shared Cursor directories are inspected read-only and rejected when
unsafe. It stores only:

- structural field paths and primitive types, with unrecognized field names replaced by local HMACs;
- allowlisted non-negative integer token fields as canonical decimal strings;
- locally HMACed account and event identities;
- a parse status, reviewer-approved exact-path version/status evidence, and a parseable provider
  timestamp.

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
  --step single \
  --event stop \
  --expected-event-id-kind request_id \
  --expected-event-id-path '$.request_id' \
  --expected-event-id-file /absolute/private/expected-request-id.json \
  --version-path '$.cursor_version'
```

The expected-ID file contains one JSON string, is read only from an owner-only regular file, and is
never copied; the installation stores only its local HMAC. A hook installed without this immutable
binding remains useful for schema discovery but cannot qualify mechanical coverage. The optional
provider version path must be an exact top-level path. Values from any other payload path are kept
only as path plus HMAC, never raw.

Run only the named scenario, then remove the probe entries. Foreign hook entries and unknown
top-level hook configuration are preserved:

```bash
node scripts/cursor-evidence-probe.mjs remove-hooks \
  --output-dir /absolute/private/cursor-evidence
```

Repeat installation with `--surface cli-interactive` for interactive CLI scenarios. Select exactly
one of `afterAgentResponse`, `stop`, or `sessionEnd` with `--event` for each run/step; lifecycle
events are evaluated as separate schema contracts rather than assumed to be equivalent. `surface`,
`scenario`, `run-id`, and `step` are operator-declared labels, not claims inferred from Cursor.

Each installation gets a deterministic probe/run/step/event-specific relative command and an
immutable owner-only runtime bundle under `~/.cursor/hooks/`. The bundle contains its own probe and
required helpers instead of importing the repository checkout. Before every import the launcher
rechecks regular-file ownership/mode (or the current-user-only Windows ACL), size, and SHA-256 for
every runtime file. A later branch switch or file edit therefore cannot change the installed hook;
bundle tampering is a safe no-op. Delayed events keep the immutable labels of the installation that
received them.

An owned lock, file fingerprint comparison, exclusive no-replace publication, and displaced-file
journal preserve concurrent foreign edits. If a concurrent current file appears after displacement,
the original and concurrent documents are validated and merged without dropping either hook set; all
seven non-empty combinations of current, recovery, and reconcile files are recovered idempotently.
Unmergeable or ambiguous states fail closed with every version preserved. `remove-hooks` validates
the output probe identity, exact command, state, runtime manifest, hashes, and ACLs before changing
`hooks.json`. Installation also fails closed for linked, oversized, non-regular, or other-user hook
files. It never changes Cursor hook trust or bypasses an approval UI.

If a process is killed while writing its private stage, startup removes the unpublished, owner-only
single-link stage without parsing its potentially partial JSON. If it is killed after no-replace
publication but before the stage link is removed, startup removes that stage only when it is the
single second hard link to the same validated `hooks.json` inode and bytes. Ambiguous or additional
links remain preserved and fail closed.

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
Malformed middle records, unterminated tails, byte limits, observation limits, nonzero exits, and
signals durably fail that invocation even when earlier complete records were sanitized.

For an already captured local JSONL file, `inspect-jsonl` performs the same bounded streaming
sanitization and also requires `--run-id` and `--step`. The input must be an absolute, current-user,
single-link regular file and is never copied into the output directory. Supply `--version-path` only
for a reviewer-approved exact top-level provider version field.

Every run/step/event has one content-free durable manifest. Installation creates it as `pending`;
exactly one invocation may move it to `completed`, while any parse, persistence, identity, child, or
repeat-invocation failure moves it to `failed`. A completed manifest binds the exact observation IDs
within each minimized schema contract. The report ignores observations from pending, failed,
conflicting, incomplete, or multiply invoked manifests. Hook launcher failures remain fail-open to
Cursor, but the pending/failed manifest keeps their evidence fail-closed.

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
  --output-dir /absolute/private/cursor-evidence \
  --event-identity-kind request_id \
  --counter-path '$.usage' \
  --account-path '$.account_id,$.user_email' \
  --event-id-path '$.request_id' \
  --timestamp-path '$.timestamp' \
  --version-source '$.cursor_version,cli'
```

These are exact canonical schema paths selected after reviewing minimized output. Merely matching a
field name is never enough. Candidates below `prompt`, `response`, `content`, `message`,
`attachments`, `args`, or any `tool*` descendant cannot qualify even when a selected name appears
there. Unknown keys remain visible only as HMACed `field1_*` schema segments for structural review;
paths containing those privacy-hashed segments are rejected as qualifying selections, so candidates
under unknown wrappers never qualify. Raw version text is accepted only from a clean, successful CLI
`--version` process or an installed/pre-approved top-level provider path. Version evidence is
required for every qualifying surface/schema contract. Traversal truncation confined to unselected
paths is reported separately and cannot disqualify a complete exact-path tuple; a truncated or
missing selected tuple still cannot qualify.

`mechanicalCoverageComplete: true` means only that the probe mechanically verified the structural
one-turn, same/different-account, CLI/Desktop A/B/A, three-surface, and adjacent chronological UTC
rollover checks. It does not claim that parent/subagent totals or aborted/error accounting semantics
are authoritative. Those observations are listed separately under `semanticEvidence`, with candidate
parent/subagent relationships and distinct `exactUsageObserved`, `explicitZeroObserved`, and
`usageAbsent` states; `semanticCoverageComplete` remains false pending reviewer interpretation.

Hook/history reconciliation requires a reviewer-selected `event_id`, `request_id`, or
`generation_id`. Conversation and session IDs never qualify automatically. Matching records must
also have the same account component, exact counter tuple, and provider timestamp; a contradictory
tuple with the same selected identity closes coverage. Email aliases and case-sensitive opaque
account IDs are HMACed separately and linked only when they co-occur. The report rejects global
one-to-many account-ID/email relationships as `accountAliasConflict`. Ambiguous timestamps/accounts,
invalid counters, non-parsed mandatory observations, incomplete run manifests, missing exact path or
version selections, truncation, conflicting event identities, and incomplete scenarios cannot
qualify. Each hook event and minimized schema signature is reported as a separate candidate
contract.

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
