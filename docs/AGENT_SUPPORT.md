# Agent support

Last researched against current upstream sources on 2026-08-15. “Exact” means provider-recorded
token counters; Vibe Racing never estimates tokens from text.

| Agent       | Source and formula                                                                                                                                                 | Surface               | Profiles                                        | Aggregation   | Trigger and limitations                                                                                                                                                                                                                                                                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- | ----------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex       | App Server `account/usage/read`; authoritative daily `tokens`                                                                                                      | CLI + Desktop account | separate `CODEX_HOME` roots                     | `account_max` | `SessionEnd` hook; totals are account-wide. The executable resolver covers PATH, package-manager bins, and installed ChatGPT/Codex applications on macOS and Windows, with `VIBERACING_CODEX_BIN` for portable installs. Every profile gets its own `CODEX_HOME`. JSON-RPC errors are failures, not zero usage.                                                                                       |
| Claude Code | `$CLAUDE_CONFIG_DIR/projects/**/*.jsonl` (default `~/.claude`); exact input/output/cache/reasoning counters                                                        | CLI                   | additional roots through `source add`           | `source_sum`  | additive `Stop` hook; stable message-ID dedupe and incremental state. Verified format for Claude Code 2.1.231.                                                                                                                                                                                                                                                                                        |
| OpenCode    | `$XDG_DATA_HOME/opencode/opencode[-channel].db` or `$OPENCODE_DB`; current SQLite `message.data.tokens`                                                            | CLI                   | every compatible channel database               | `source_sum`  | names must match `^opencode(?:-[A-Za-z0-9._-]+)?\.db$`; each candidate is opened read-only and must have `message(id,time_created,data)`. WAL/SHM, backups, arbitrary databases, and incompatible schemas are ignored. Documented manual `sync`; no supported global completion hook is assumed.                                                                                                      |
| Kimi Code   | `$KIMI_CODE_HOME/sessions/**/agents/*/wire.jsonl` (default `~/.kimi-code`), current `usage.record.usage`; legacy `~/.kimi` uses `StatusUpdate.payload.token_usage` | CLI                   | current root plus explicitly added legacy roots | `source_sum`  | additive marked `Stop` hook in the selected root's `config.toml`; current `time` is milliseconds and camelCase counters follow the persisted `TokenUsage` type. Auto-discovery prefers current and falls back to legacy only when current is absent, preventing migrated sessions from being counted twice. Additional Python-format archives require explicit `source add ... --legacy`.             |
| Qwen Code   | runtime `usage/token-usage-YYYY-MM.jsonl`; authoritative `totalTokens`                                                                                             | CLI                   | selected runtime root or explicitly added roots | `source_sum`  | root priority is `QWEN_RUNTIME_DIR`, user `advanced.runtimeOutputDir`, `QWEN_HOME`, then `~/.qwen`. Absolute and tilde settings are supported. A relative setting is not guessed from connector CWD and requires `source add`. Additive `SessionEnd` hook; UTC uses `timestamp`, not writer-local `localDate`.                                                                                        |
| Antigravity | native terminal `result.usage`; exact input/output/cache counters                                                                                                  | wrapped CLI sessions  | source-specific Personal/Work captures          | `source_sum`  | only sessions launched with `viberacing run antigravity [--source ID] -- …` are counted. Earlier or directly launched `agy` sessions and Antigravity Desktop are not included. Official local transcripts contain private conversation data and there is no documented usage-only daily export; the official status-line surface exposes current conversation totals, not account-wide daily history. |
| Gemini CLI  | `$GEMINI_CLI_HOME/.gemini/tmp/**/chats/session-*.jsonl` message `tokens`; authoritative total                                                                      | CLI                   | multiple project/profile roots                  | `source_sum`  | additive `SessionEnd` hook. Prompt count includes cached input, so cached is subtracted for component display; authoritative total wins. Verified against Gemini CLI 0.55.1 recording schema.                                                                                                                                                                                                         |

If an authoritative total differs from the visible component formula, only the authoritative total
is uploaded; contradictory components are omitted. Malformed records are skipped, unreadable or
bounded collections become `partial`, and an unavailable source is reported by `doctor` rather than
submitted as zero.

## Exact-source discovery

Automatic discovery is based on token stores, not installed applications. Claude, Kimi, and Gemini
must contain matching session records; OpenCode databases must pass the read-only schema check; Qwen
must have the selected runtime `usage` directory; and Codex must have its account-usage path. An
agent that is installed but has never produced a token store is therefore correctly reported as not
detected. Discovery checks only documented roots, environment overrides, the Qwen user settings
file, and explicitly added roots. It never scans the whole home directory or disk.

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
Antigravity captures are incremental, records older than 35 days are removed after successful sync,
and oversized files are atomically compacted. Antigravity Desktop has no supported exact local usage
export. Every capture source defaults to `~/.viberacing/captures/<clientSourceId>.jsonl`; labels and
agent IDs are not used as filenames. One matching source is selected automatically, while multiple
profiles require `--source`. That option is never forwarded to `agy`.

## Sync behavior

Codex, Claude, Kimi, Qwen, and Gemini have current official lifecycle hooks. Each hook carries its
stable local source ID and marks only that source dirty under a short file lock. The hook itself
only discards stdin and starts/reuses one detached timer; it does not scan histories, start an App
Server, read SQLite, or use the network. OpenCode is manual-sync only. Antigravity requires its
wrapper.

Automatic attempts are debounced for 15 seconds, limited to one about every 120 seconds, and cannot
be postponed past 120 seconds from the first dirty event. It drains pending uploads without
rescanning, then collects only active dirty sources; events for different sources can share one
batch. The scheduler exits after its batch and there is no daemon, watcher, or polling loop. Manual
sync and initial connect are immediate and collect all active sources. A first sync reads a bounded
31-day UTC window; later file-backed syncs are incremental and an unchanged snapshot sends no HTTP
request. Seven agents currently contribute exact counters.

## Upstream references

The implementation and synthetic fixtures were checked against primary sources:
[Codex App Server documentation](https://developers.openai.com/codex/app-server),
[Claude Code hooks](https://code.claude.com/docs/en/hooks),
[OpenCode source](https://github.com/anomalyco/opencode),
[Kimi Code sessions](https://www.kimi.com/code/docs/en/kimi-code-cli/guides/sessions.html),
[Qwen Code telemetry](https://github.com/QwenLM/qwen-code/blob/main/docs/developers/development/telemetry.md),
[Gemini CLI sessions](https://geminicli.com/docs/cli/session-management/), and the
[Antigravity CLI changelog](https://antigravity.google/changelog). The exact Codex usage response
was additionally validated against JSON Schema generated by the locally installed
`codex app-server`.
