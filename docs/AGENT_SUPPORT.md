# Agent support

Last researched against current upstream sources on 2026-08-14. “Exact” means provider-recorded
token counters; Vibe Racing never estimates tokens from text.

| Agent       | Source and formula                                                                                          | Surface               | Profiles                                        | Aggregation   | Trigger and limitations                                                                                                                                                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex       | App Server `account/usage/read`; authoritative daily `tokens`                                               | CLI + Desktop account | separate `CODEX_HOME` roots                     | `account_max` | `SessionEnd` hook; totals are account-wide. Every configured profile starts one App Server with its own `CODEX_HOME`; never configure the same profile twice. JSON-RPC errors are failures, not zero usage.                                              |
| Claude Code | `$CLAUDE_CONFIG_DIR/projects/**/*.jsonl` (default `~/.claude`); exact input/output/cache/reasoning counters | CLI                   | additional roots through `source add`           | `source_sum`  | additive `Stop` hook; stable message-ID dedupe and incremental state. Verified format for Claude Code 2.1.231.                                                                                                                                           |
| OpenCode    | `$XDG_DATA_HOME/opencode/*.db` or `$OPENCODE_DB`; current SQLite `message.data.tokens`                      | CLI                   | multiple SQLite roots                           | `source_sum`  | documented manual `sync`; no supported global completion hook is assumed. Node 24 built-in read-only SQLite. Verified against OpenCode 1.18.18 schema.                                                                                                   |
| Kimi Code   | `$KIMI_SHARE_DIR/sessions/**/wire.jsonl` (default `~/.kimi`), nested `StatusUpdate.payload.token_usage`     | CLI                   | multiple share/session roots                    | `source_sum`  | additive marked `Stop` hook in `$KIMI_SHARE_DIR/config.toml`; numeric wire timestamps are seconds. Verified against stable Kimi CLI 1.49.0 and current upstream wire types.                                                                              |
| Qwen Code   | runtime `usage/token-usage-YYYY-MM.jsonl`; authoritative `totalTokens`                                      | CLI                   | `QWEN_RUNTIME_DIR`, `QWEN_HOME`, or added roots | `source_sum`  | additive `SessionEnd` hook. UTC uses `timestamp`, not writer-local `localDate`. Cached tokens are removed from input before component reporting. Verified against Qwen Code 0.21.11.                                                                     |
| Cursor      | no currently documented authoritative counter in the terminal result                                        | CLI wrapper only      | one local capture root                          | not counted   | `viberacing run cursor -- …` invokes `cursor-agent --print --output-format stream-json`, but persists nothing when counters are absent. Current official result schema has duration/session/request fields, not token usage. Cursor Desktop is excluded. |
| Antigravity | native terminal `result.usage`; exact input/output/cache counters                                           | CLI only              | one capture per configured root                 | `source_sum`  | `viberacing run antigravity -- …` invokes `agy --print --output-format stream-json`. Usage support was introduced in 1.1.8 and rechecked against current 1.1.12. Antigravity Desktop is excluded.                                                        |
| Gemini CLI  | `$GEMINI_CLI_HOME/.gemini/tmp/**/chats/session-*.jsonl` message `tokens`; authoritative total               | CLI                   | multiple project/profile roots                  | `source_sum`  | additive `SessionEnd` hook. Prompt count includes cached input, so cached is subtracted for component display; authoritative total wins. Verified against Gemini CLI 0.55.1 recording schema.                                                            |

If an authoritative total differs from the visible component formula, only the authoritative total
is uploaded; contradictory components are omitted. Malformed records are skipped, unreadable or
bounded collections become `partial`, and an unavailable source is reported by `doctor` rather than
submitted as zero.

## Capture mode

```bash
viberacing run cursor -- <native cursor arguments>
viberacing run antigravity -- <native agy arguments>
```

The wrapper launches the real executable, adds print/headless and official `stream-json` flags
without duplicating user flags, forwards stdout, stderr, SIGINT, and SIGTERM, preserves the exit
code, and stores only event ID, UTC date, and authoritative usage counters. It never stores the
native stream, prompt, response, tool calls, path, model, or credential fields. Captures are
incremental, records older than 35 days are removed after successful sync, and oversized files are
atomically compacted. Cursor currently emits no documented authoritative counter and therefore
produces no Vibe Racing capture. Neither desktop product has a supported exact local usage export.

## Sync behavior

Codex, Claude, Kimi, Qwen, and Gemini have current official lifecycle hooks. Those hooks only
discard stdin, mark dirty, and start/reuse one detached timer; they do not scan histories, start an
App Server, read SQLite, or use the network. OpenCode is manual-sync only. Antigravity requires its
wrapper. Cursor's wrapper is available but is counter-gated as described above.

Automatic attempts are debounced for 15 seconds, limited to one about every 120 seconds, and cannot
be postponed past 120 seconds from the first dirty event. The scheduler exits after its batch and
there is no daemon, watcher, or polling loop. Manual sync and initial connect are immediate. A first
sync reads a bounded 31-day UTC window; later file-backed syncs are incremental and an unchanged
snapshot sends no HTTP request.

## Upstream references

The implementation and synthetic fixtures were checked against primary sources:
[Codex App Server documentation](https://developers.openai.com/codex/app-server),
[Claude Code hooks](https://code.claude.com/docs/en/hooks),
[OpenCode source](https://github.com/anomalyco/opencode),
[Kimi Code sessions](https://www.kimi.com/code/docs/en/kimi-code-cli/guides/sessions.html),
[Qwen Code telemetry](https://github.com/QwenLM/qwen-code/blob/main/docs/developers/development/telemetry.md),
[Gemini CLI sessions](https://geminicli.com/docs/cli/session-management/),
[Cursor CLI structured output](https://docs.cursor.com/en/cli/reference/output-format), and the
[Antigravity CLI changelog](https://antigravity.google/changelog). Cursor's limitation follows from
the fields present—and the usage fields absent—in its published terminal result. The exact Codex
usage response was additionally validated against JSON Schema generated by the locally installed
`codex app-server`.
