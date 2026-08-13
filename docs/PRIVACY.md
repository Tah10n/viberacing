# Privacy

Vibe Racing sends only the data needed to compute a self-reported ranking.

During pairing the connector sends protocol/connector versions, a random installation identity and
proof, opaque client source IDs, agent IDs, allowlisted collection methods, supported surface, and a
neutral suggested label. During sync it sends a server source ID, sequence, UTC range,
complete/partial status, UTC dates, aggregate total tokens, and optional aggregate input/output/
cache/reasoning counters.

It never sends prompts, responses, transcript content, code, tool arguments, repository names, local
paths, hostnames, provider emails/usernames, provider credentials, API keys, model names, costs, or
monetary/request metrics. Raw session stores can contain sensitive content, so adapters extract
usage locally and discard every other field. Cursor and Antigravity capture wrappers pass native
output through to the terminal but persist only a random event ID, UTC date, and token counters.

GitHub OAuth requests `read:user`. The access token is used once to obtain immutable GitHub ID and
current handle and is not stored. Browser, installation, poll, and device secrets are SHA-256 hashed
in PostgreSQL. Local Vibe Racing directories are owner-only; secrets/config files are `0600` and the
installed executable is `0700`.

Public pages expose GitHub handle, current UTC-week rank, total, and agent breakdown. They do not
expose daily data, account labels, source/installation details, or credentials. Local data is under
the user's control, so the leaderboard is explicitly self-reported and grants no authorization,
reward, or access.

Disconnecting an installation or source revokes future ingestion but retains its history. Deleting
an agent account deletes its sources and usage. **Leave leaderboard** deletes all usage and revokes
installations while retaining the GitHub identity and empty account labels. **Delete Vibe Racing
account** deletes the user and all dependent data and clears the browser session.

The repository privacy guard rejects known local stores, telemetry, captures, databases, dumps,
credentials, and fixtures containing content/path/tool fields. Fixtures are synthetic usage-only
records.
