# Ranking semantics

The leaderboard measures exact token volume reported by paired local connectors during the current
Monday–Sunday UTC week. It does not measure cost, requests, productivity, output quality, or work
value. A user-controlled machine can alter its local data, so results are self-reported rather than
cryptographically verified.

For each source and UTC date, `totalTokens` is an authoritative provider total when available;
otherwise it is the non-overlapping sum of input, output, cache read, cache creation/write, and
separately reported reasoning. Adapters remove provider-specific overlap such as cached input
already included in prompt input and reasoning already included in output. All integers remain
canonical decimal strings in the protocol and `numeric(30,0)` in PostgreSQL.

Codex is the one scoped exception for component display: its authoritative daily total is
account-wide, while its provider-recorded component events are locally retained. While account
buckets lag, the ranking uses every exact locally observed non-overlapping daily sum after the
newest authoritative bucket as a partial value, including days retained across a UTC rollover. Later
complete account data replaces each value and may correct it up or down. Available local components
are displayed as a separate exact tuple with their own sum and an explicit scope note; they are
never scaled or estimated to fit the account total. Other agents' five components must sum exactly
to `totalTokens`.

For an `account_max` account, complete observations establish the authoritative daily baseline as
their maximum across linked sources. A partial observation accepted after the newest complete
observation may advance the displayed value until another complete observation excludes older
provisional rows. If no complete observation exists, the daily maximum across provisional sources is
used. This prevents an account-wide Codex bucket reported from two computers from doubling without
letting an offline computer's older provisional value mask a later correction. For a `source_sum`
account, daily usage is the sum across machine-local histories. Daily account totals then sum across
multiple accounts of the same agent; agent totals sum into the user's weekly total. An `account_max`
component breakdown selects the largest complete local component sum for each day and is hidden for
that day if equally large tuples disagree. A `source_sum` breakdown still requires complete
components whose sum matches each authoritative source total.

Local sources have random stable identities independent of discovery order. Pairing can assign two
profiles of the same agent to different accounts, which makes their account totals additive, or to
one account, which applies that account's `account_max`/`source_sum` rule. Reassignment rebuilds the
affected user's agent summaries in the approval transaction, so the public total changes immediately
without waiting for another upload.

Ranks use SQL `dense_rank` by weekly total descending, so ties share a rank. Display order within a
tie is deterministic by case-folded handle and user ID. Public profiles and leaderboard pages read
the same weekly summary table.

## Corrections

Each source snapshot has a monotonic sequence and inclusive UTC range. A stale or repeated sequence
is a no-op. The server exposes its last accepted sequence so a connector that lost local state
continues at `server + 1`; one stale pending snapshot is repaired and retried once. A newer
`complete` snapshot replaces values and deletes dates missing from the range; a newer `partial`
snapshot preserves missing dates and cannot reduce a previously stored daily total. A snapshot with
any partial day is treated as partial for deletion even if its outer range flag says complete. This
protects an exact day when a bounded collector temporarily misses one file. A partial snapshot may
mark an individually authoritative date complete, allowing that date to correct an earlier
provisional value up or down without deleting other absent dates. Only weeks touched by an accepted
snapshot are rebuilt.

Automatic scheduling changes delivery timing, not ranking semantics. Source-owned hooks coalesce
events into at most about one batch every two minutes; only dirty sources are collected, while
pending aggregates can upload without a rescan. Manual sync and first connect collect all active
sources immediately. Automatic hooks make no usage request for an unchanged normalized snapshot.
Manual and browser-triggered Sync submit a content-equivalent snapshot with the next sequence, so a
successful check advances **Last sync** and the refreshed dashboard immediately confirms it.

Seven agents currently contribute authoritative token totals: Codex, Claude Code, OpenCode, Kimi
Code, Qwen Code, Antigravity, and Gemini CLI.

Operational correction requires no admin portal: restore/correct the authoritative local usage store
and run `viberacing sync`. To delete retained history, disconnect and explicitly delete the agent
account in the dashboard. Use **Leave leaderboard** for all ranking rows or **Delete Vibe Racing
account** for the complete user record.
