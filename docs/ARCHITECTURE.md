# Architecture

Vibe Racing uses the smallest production shape that serves the product:

```text
Codex / Claude Code -> local connector -> Next.js -> PostgreSQL
                                          |
Browser -------- GitHub OAuth ------------+
```

`apps/web` owns OAuth, sessions, browser pairing, usage ingestion, profiles, and ranking.
`packages/connector` reads supported local agent usage and sends daily aggregates. PostgreSQL stores
users, sessions, computer connections, and daily usage.

Pairing returns a short browser code plus separate poll and device secrets. Secrets and session
tokens are SHA-256 hashed before storage. A user may have several independently revocable computer
connections. The server assigns neutral labels such as `Computer 1`; hostnames are not collected.
Usage updates are idempotent per connection, agent, and UTC date: retries can only keep or increase
the stored value. Account-wide Codex buckets use the largest daily value reported across computers;
machine-local Claude Code totals are summed. Reconnecting the same installation replaces its old
connection and preserves its history.

Disconnecting one computer revokes only its device token and keeps historical weekly totals. Leaving
the leaderboard revokes every device token and deletes all usage rows while preserving the GitHub
identity so the user can join again later.

Weekly ranking is calculated directly from daily rows. There is no cache, queue, worker, or separate
ingestion service.
