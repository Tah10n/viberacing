# Agent support

Last researched against current upstream sources on 2026-08-13. “Exact” means provider-recorded
token counters; Vibe Racing never estimates tokens from text.

| Agent       | Source and formula                                                                                          | Surface               | Profiles                                        | Aggregation   | Trigger and limitations                                                                                                                                                                       |
| ----------- | ----------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex       | App Server `account/usage/read`; authoritative daily `tokens`                                               | CLI + Desktop account | one source per account mapping                  | `account_max` | Codex `SessionEnd`; totals are account-wide. App Server JSON-RPC errors are failures, not zero usage. Verified with installed Codex 0.147.0-alpha.6.5.                                        |
| Claude Code | `$CLAUDE_CONFIG_DIR/projects/**/*.jsonl` (default `~/.claude`); exact input/output/cache/reasoning counters | CLI                   | additional roots through `source add`           | `source_sum`  | additive `Stop` hook; stable message-ID dedupe and incremental state. Verified format for Claude Code 2.1.231.                                                                                |
| OpenCode    | `$XDG_DATA_HOME/opencode/*.db` or `$OPENCODE_DB`; current SQLite `message.data.tokens`                      | CLI                   | multiple SQLite roots                           | `source_sum`  | documented manual `sync`; no supported global completion hook is assumed. Node 24 built-in read-only SQLite. Verified against OpenCode 1.18.18 schema.                                        |
| Kimi Code   | `$KIMI_CODE_HOME/sessions/**/agents/*/wire.jsonl` (default `~/.kimi-code`), `usage.record`                  | CLI                   | multiple session roots                          | `source_sum`  | additive marked `SessionEnd` TOML hook. Verified against Kimi Code 0.36.0 wire manifest.                                                                                                      |
| Qwen Code   | runtime `usage/token-usage-YYYY-MM.jsonl`; authoritative `totalTokens`                                      | CLI                   | `QWEN_RUNTIME_DIR`, `QWEN_HOME`, or added roots | `source_sum`  | additive `SessionEnd` hook. UTC uses `timestamp`, not writer-local `localDate`. Cached tokens are removed from input before component reporting. Verified against Qwen Code 0.21.11.          |
| Cursor      | native CLI terminal result `usage`; input + output + cache read/write + reasoning when present              | CLI only              | one capture per configured root                 | `source_sum`  | `viberacing run cursor -- …` invokes `agent --output-format stream-json`. Cursor Desktop is excluded. Verified against current structured-output behavior.                                    |
| Antigravity | native CLI terminal result `usage`; input + output + cache read/write + reasoning when present              | CLI only              | one capture per configured root                 | `source_sum`  | `viberacing run antigravity -- …` invokes `agy --output-format stream-json`. Antigravity Desktop is excluded. Verified against CLI 1.1.12 structured output.                                  |
| Gemini CLI  | `$GEMINI_CLI_HOME/.gemini/tmp/**/chats/session-*.jsonl` message `tokens`; authoritative total               | CLI                   | multiple project/profile roots                  | `source_sum`  | additive `SessionEnd` hook. Prompt count includes cached input, so cached is subtracted for component display; authoritative total wins. Verified against Gemini CLI 0.55.1 recording schema. |

If an authoritative total differs from the visible component formula, only the authoritative total
is uploaded; contradictory components are omitted. Malformed records are skipped, unreadable or
bounded collections become `partial`, and an unavailable source is reported by `doctor` rather than
submitted as zero.

## Capture mode

```bash
viberacing run cursor -- <native cursor arguments>
viberacing run antigravity -- <native agy arguments>
```

The wrapper launches the real executable, requests official `stream-json`, forwards stdout and
signals, preserves the exit code, and stores only usage metadata. It is opt-in because neither
desktop product exposes a supported exact local usage export suitable for this connector.

## Upstream references

The implementation and synthetic fixtures were checked against primary sources:
[Codex App Server documentation](https://developers.openai.com/codex/app-server),
[Claude Code hooks](https://code.claude.com/docs/en/hooks),
[OpenCode source](https://github.com/anomalyco/opencode),
[Kimi Code sessions](https://www.kimi.com/code/docs/en/kimi-code-cli/guides/sessions.html),
[Qwen Code telemetry](https://github.com/QwenLM/qwen-code/blob/main/docs/developers/development/telemetry.md),
[Gemini CLI sessions](https://geminicli.com/docs/cli/session-management/),
[Cursor CLI structured output](https://docs.cursor.com/en/cli/reference/output-format), and the
[Antigravity CLI changelog](https://antigravity.google/changelog). The exact Codex usage response
was additionally validated against JSON Schema generated by the locally installed `codex app-server`
version above.
