# Privacy

During pairing, the connector sends the detected agent identifiers and random pairing credentials.
When reconnecting to the same origin, it also sends its previous Vibe Racing device token so the
server can replace that computer's connection without duplicating history. It does not send the
computer hostname.

During usage sync, the connector uploads only:

- supported agent identifier (`codex` or `claude_code`);
- UTC date;
- cumulative token count for that agent and date.

It never uploads prompts, responses, code, transcript text, repository names, local paths, provider
credentials, model names, or costs.

GitHub OAuth requests the `read:user` scope. The server reads and stores only the GitHub ID and
handle; the access token is used for that request and is not stored. The server also stores hashed
session and connector credentials, connection status, detected agent identifiers, sync timestamps,
and daily aggregate totals.

The leaderboard and public profile show the GitHub handle, weekly rank, weekly token total, and
weekly total for each connected agent. Daily totals, GitHub ID, session and connector credentials,
connection status, and sync metadata are not exposed on public pages.

Usage comes from files controlled by the user's machine and is therefore self-reported. The
leaderboard compares reported token volume, not price, work quality, productivity, or effort.

Users can disconnect one computer without deleting prior totals. The **Leave leaderboard** action
deletes all usage totals and revokes every computer connection immediately; the GitHub identity and
current browser sign-in remain so the user can join again later.

Codex reports account-wide daily buckets, so duplicate reports from several computers are collapsed
to the largest value. Claude Code history is machine-local, so totals from separate computers are
added.

Local development credentials live in the ignored `apps/web/.env.local`. Agent state, temporary
screenshots, database files, dumps, and usage exports are also ignored. `pnpm verify` runs a privacy
guard that fails when these paths or recognizable credentials could be committed. The Docker build
uses an allowlist and cannot copy local environment files into the image.
