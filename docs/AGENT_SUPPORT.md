# Agent support

Last researched against current upstream sources on 2026-09-03. “Exact” means provider-recorded
token counters; Vibe Racing never estimates tokens from text.

Cursor is not a supported eighth agent. Its current documented Desktop hooks and CLI output schema
do not establish exact input/output/cache/reasoning counters across both surfaces. The
[Cursor evidence gate](CURSOR_EVIDENCE.md) records the missing live evidence and the opt-in local
probe; no `cursor` registry entry or source is created while that gate is closed.

| Agent       | Source and formula                                                                                                                                                                                   | Surface               | Profiles                                        | Aggregation   | Trigger and limitations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex       | App Server `account/read` + `account/usage/read` authoritative account-wide daily `tokens`; local `sessions` and `archived_sessions` `.jsonl`/`.jsonl.zst` `token_count.last_token_usage` components | CLI + Desktop account | up to 8 ChatGPT accounts per `CODEX_HOME`       | `account_max` | one additive `Stop` hook per physical profile. Local `tokens.account_id` is read only from file-backed `CODEX_HOME/auth.json` before App Server starts and after usage; two non-refreshing account reads must return the same normalized, non-null email. Email plus account ID form a local salt-scoped HMAC, while either value alone is insufficient. Keyring-only and ephemeral identity are unsupported; separate `CODEX_HOME` roots help only when each contains its own auth file. Direct OS-keyring access requires separate security design. Identifier-unavailable, API-key, Bedrock, and unstable states fail closed. Unknown stable identities become generic logical sources through server-confirmed registration. Cumulative counters deduplicate repeated/copied events across active, archived, plain, and compressed rollout representations; provider-recorded last-call counters supply exact local components only while the profile has one identity. Multi-identity profiles remain total-only because transcript components are not account-scoped. Context-window occupancy events are not usage contributions. JSON-RPC errors are failures, not zero usage. |
| Claude Code | `$CLAUDE_CONFIG_DIR/projects/**/*.jsonl` (default `~/.claude`); exact input/output/cache/reasoning counters                                                                                          | CLI                   | additional roots through `source add`           | `source_sum`  | additive `Stop` hook; stable message-ID dedupe and incremental state. Verified format for Claude Code 2.1.231.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| OpenCode    | `$XDG_DATA_HOME/opencode/opencode[-channel].db` or `$OPENCODE_DB`; current SQLite `message.data.tokens`                                                                                              | CLI                   | every compatible channel database               | `source_sum`  | names must match `^opencode(?:-[A-Za-z0-9._-]+)?\.db$`; each candidate is opened read-only and must have `message(id,time_created,data)`. WAL/SHM, backups, arbitrary databases, and incompatible schemas are ignored. An installation-owned global plugin observes `session.status: idle` with deduplicated `session.idle` fallback and bulk-marks every active mapped database. It passes no event payload, session ID, or project context. Manual `sync` remains supported.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Kimi Code   | `$KIMI_CODE_HOME/sessions/**/agents/*/wire.jsonl` (default `~/.kimi-code`), current `usage.record.usage`; legacy `~/.kimi` uses `StatusUpdate.payload.token_usage`                                   | CLI                   | current root plus explicitly added legacy roots | `source_sum`  | additive marked `Stop` hook in the selected root's `config.toml`; current `time` is milliseconds and camelCase counters follow the persisted `TokenUsage` type. Auto-discovery prefers current and falls back to legacy only when current is absent, preventing migrated sessions from being counted twice. Additional Python-format archives require explicit `source add ... --legacy`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Qwen Code   | runtime `usage/token-usage-YYYY-MM.jsonl`; authoritative `totalTokens`; cached input is included in input while current thoughts are separate from output                                            | CLI                   | selected runtime root or explicitly added roots | `source_sum`  | root priority is `QWEN_RUNTIME_DIR`, user `advanced.runtimeOutputDir`, `QWEN_HOME`, then `~/.qwen`. User settings are JSONC and support `$VAR`, `${VAR}`, and tilde expansion. Routing variables and only names referenced by `runtimeOutputDir` are read from user-level `.env` with dotenv-compatible quotes/comments; unrelated values are discarded. Relative values are never guessed from connector CWD. Runtime and config roots remain separate, and the additive `SessionEnd` hook is written to `<QWEN_HOME>/settings.json`. Live verification against Qwen Code 0.21.12 confirmed the hook on interactive TUI exit; upstream also wires it into ACP, but headless `qwen -p` does not emit `SessionEnd`. Headless usage remains exact and is collected by manual `viberacing sync` or a later supported lifecycle trigger. UTC uses `timestamp`, not writer-local `localDate`. Legacy records where thoughts overlap output remain supported when their authoritative arithmetic identifies that contract.                                                                                                                                                                   |
| Antigravity | native terminal `result.usage`; exact input/output/cache counters                                                                                                                                    | wrapped CLI sessions  | source-specific Personal/Work captures          | `source_sum`  | only sessions launched with `viberacing run antigravity [--source ID] -- …` are counted. Earlier or directly launched `agy` sessions and Antigravity Desktop are not included. Official local transcripts contain private conversation data and there is no documented usage-only daily export; the official status-line surface exposes current conversation totals, not account-wide daily history.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Gemini CLI  | `$GEMINI_CLI_HOME/.gemini/tmp/**/chats/session-*.jsonl` message `tokens`; authoritative total                                                                                                        | CLI                   | multiple project/profile roots                  | `source_sum`  | additive `SessionEnd` hook. Prompt count includes cached input, so cached is subtracted for component display; authoritative total wins. Verified against Gemini CLI 0.55.1 recording schema.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## Current-year history coverage

Connector 0.6.0 refreshes the recent rolling range first and then requests the rest of the current
UTC year in resumable chunks of at most 31 dates. Codex uses account-wide App Server buckets plus
exact local tail evidence; historical snapshots are conservatively partial when that surface cannot
prove every requested date, while an individually authoritative returned date can still correct a
stored value down. OpenCode applies the requested range in its read-only `time_created` SQL query.
Qwen opens only `token-usage-YYYY-MM.jsonl` files whose month intersects the chunk. Claude, Kimi,
and Gemini scan only their documented roots and discard parsed events outside the chunk before
ledger limits or completeness are evaluated. Antigravity can import only retained wrapper captures
and therefore marks historical coverage partial; direct CLI runs, older compacted captures, and
Desktop usage remain unavailable. Every adapter uses isolated historical state, so backfill cannot
replace rolling incremental checkpoints, fingerprints, or operational diagnostics.

A terminal `complete` status means every requested chunk for that source was authoritative. A
terminal `partial` status means the import reached January 1 but at least one chunk was incomplete;
the exact dates that were available still count. The server separately retains unresolved dates from
partial/omitted days and gaps between acknowledged rolling ranges. A complete snapshot clears only
its own range; a complete entry inside a mixed snapshot clears only its date. `connect` and manual
Sync drain returned gap cursors, while automatic and browser Sync collect at most one gap chunk.
`viberacing sync --full` explicitly rescans the current year after either terminal status. An
inactive Codex logical account keeps its cursor for a later run after the user switches accounts. A
new UTC year starts a new cursor without deleting server rows from prior years; only explicit
account/source deletion removes retained history.

If an authoritative total differs from the visible component formula, only the authoritative total
is uploaded for every agent except Codex. Codex's separately exact local component tuple may differ
from its account-wide total, and the dashboard labels that difference. Other contradictory
components are omitted or rejected. Records that are clearly irrelevant to usage are skipped.
Malformed JSONL records and records that still look like usage candidates but use an unsupported
schema make the collection `partial`, preserve the previous file state and daily usage, and report
`local_store_schema_unsupported`. An unterminated JSONL tail is likewise provisional and cannot
replace previously committed file state. Unreadable or bounded collections become `partial`, and an
unavailable source is reported by `doctor` rather than submitted as zero.

Claude, OpenCode, Kimi, Qwen, Gemini, and captured Antigravity retain a bounded range-aware ledger
of hashed event identity, UTC date, exact token tuple, and parser version. It survives record
deletion, movement, or copying within the retained range and deduplicates copies. A repeated
identity with a different tuple preserves the first observation, makes the collection partial, and
reports `local_event_identity_conflict`.

Codex reports overlapping counters: cached/cache-write input is removed from regular input and
reasoning output is removed from regular output. Qwen cached input is removed from regular input,
while current Qwen thoughts are added beside output; legacy records that include thoughts in output
are identified by their authoritative total. The cache and reasoning values are carried in their own
fields, so the five displayed components sum exactly once to `totalTokens`.

## Exact-source discovery

Automatic discovery is based on token stores, not installed applications. Claude, Kimi, and Gemini
must contain matching session records; OpenCode databases must pass the read-only schema check; Qwen
must have the selected runtime `usage` directory; and Codex must have its account-usage path. An
agent that is installed but has never produced a token store is therefore correctly reported as not
detected. Discovery checks only documented roots, environment overrides, the Qwen user JSONC
settings and user-level `.env` files, and explicitly added roots. It never scans the whole home
directory or disk.

Paths are made absolute and compared using `realpath` when available. Windows and typical macOS
case-insensitive semantics are applied for comparison, while the user's original display path is
preserved. A symlink to an existing store is not added twice, but genuinely distinct profile roots
remain separate sources.

## Capture mode

```bash
viberacing source add --agent antigravity --name Personal
viberacing source add --agent antigravity --name Work
viberacing run antigravity [--source <client-source-id>] -- <native agy arguments>
```

The wrapper launches the real executable (including npm `.cmd`/`.bat` shims through `ComSpec` on
Windows), adds print/headless and official `stream-json` flags without duplicating user flags,
forwards stdout, stderr, SIGINT, and SIGTERM, and preserves the exit code. For Antigravity it stores
only event ID, UTC date, and authoritative usage counters. The resolved executable path is retained
only in local `sources.json` so portable installs continue working from later processes. It never
stores the native stream, prompt, response, tool calls, path, model, or credential fields.
Antigravity captures are incremental. A successful safe collection binds its pending payload to the
capture inode, acknowledged byte offset, and prefix hash. Under the same capture lock, cleanup
revalidates that proof and removes only acknowledged records older than 35 days; appended or
malformed suffixes and replaced/truncated files are preserved. Cleanup repeats after later
successful Sync, is crash-idempotent, and remains best-effort per source. Antigravity Desktop has no
supported exact local usage export. Every capture source defaults to
`~/.viberacing/captures/<clientSourceId>.jsonl`; labels and agent IDs are not used as filenames. One
matching source is selected automatically, while multiple profiles require `--source`. That option
is never forwarded to `agy`.

## Sync behavior

Codex, Claude, Kimi, Qwen, and Gemini have current official lifecycle hooks. Codex uses `Stop` after
each completed turn; the others use the lifecycle event listed above. Each hook carries its stable
local source ID and marks only that source dirty under a short file lock. The hook itself only
discards stdin and starts/reuses one detached timer; it does not scan histories, start an App
Server, read SQLite, or use the network. OpenCode's generated global plugin starts the stable
launcher synchronously at idle and returns immediately; the hidden hook atomically dirties all
active mapped OpenCode sources for that installation. Antigravity requires its wrapper. Codex runs a
new or changed non-managed hook only after the user reviews it through `/hooks`; `doctor` reports
the trust status, and the connector never writes or bypasses Codex trust state.

Qwen Code 0.21.12 emits `SessionEnd` for interactive TUI exits and wires the event into ACP, but its
headless `qwen -p` runner does not call the event. Those headless sessions still append exact token
records to the same usage store; `viberacing sync` or a later interactive/ACP lifecycle event
collects the accumulated totals.

Automatic attempts are debounced for 15 seconds, limited to one about every 120 seconds, and cannot
be postponed past 120 seconds from the first dirty event. It drains pending uploads without
rescanning, then collects only active dirty sources; events for different sources can share one
batch. The scheduler exits after its batch and there is no daemon, watcher, or polling loop. Manual
sync and initial connect are immediate and collect all active sources. Every run reads a bounded
rolling window of at most 31 UTC dates. Initial connect and manual sync then finish all eligible
current-year chunks; automatic and browser-triggered runs advance at most one. Later rolling
file-backed syncs are incremental. An unchanged automatic rolling snapshot sends no HTTP request,
while manual and browser-triggered Sync submit a confirmation snapshot so **Last sync** advances.
Seven agents currently contribute exact counters.

## Upstream references

The implementation and synthetic fixtures were checked against primary sources:
[Codex App Server documentation](https://developers.openai.com/codex/app-server),
[Codex hooks documentation](https://developers.openai.com/codex/hooks),
[Claude Code hooks](https://code.claude.com/docs/en/hooks),
[OpenCode source](https://github.com/anomalyco/opencode),
[Kimi Code sessions](https://www.kimi.com/code/docs/en/kimi-code-cli/guides/sessions.html),
[Qwen Code settings](https://github.com/QwenLM/qwen-code/blob/main/docs/users/configuration/settings.md),
[Qwen Code telemetry](https://github.com/QwenLM/qwen-code/blob/main/docs/developers/development/telemetry.md),
[Gemini CLI sessions](https://geminicli.com/docs/cli/session-management/), and the
[Antigravity CLI changelog](https://antigravity.google/changelog). The exact Codex usage response
was additionally validated against JSON Schema generated by the locally installed
`codex app-server`.
