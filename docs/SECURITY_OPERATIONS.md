# Abuse protection and recovery

The application remains one web service, PostgreSQL, and the existing connector. Rankings are
self-reported. A review signal is not evidence of cheating or verification of spend. No edge
setting, production variable, domain, deployment, or paid service is changed by this pull request.

## Runtime limits

Run the production build with `node apps/web/scripts/server.mjs` (or the image's default command).
The launcher is part of the same web process. It is necessary to reject resource overload with an
HTTP 503 before Next.js streams HTML, and to set header/body/connection deadlines explicitly.
`next dev` is a development tool and is not the production resource boundary.

| Layer                  | Bound / behavior                                                                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP                   | 32 active requests, including at most 4 public dynamic requests per instance; no HTTP wait queue                                                                          |
| Sockets                | 128 connections per instance, 16 KiB headers, 5 s headers, 10 s whole request reception, 15 s socket inactivity, 5 s keepalive, 100 requests/socket                       |
| Body readers           | Existing route byte limits plus 5 s total streaming deadline; timeout returns 408 where routed through the shared error helper                                            |
| Database work          | 10 active operations plus at most 32 waiters per process; at most 1 s waiting; pool size 10, connection timeout 1 s, lock timeout 1 s, SQL timeout 8 s                    |
| Admission              | Shared PostgreSQL transaction; every rejected admission rolls back all admission increments                                                                               |
| Public reads           | Separate 2,000/minute admitted route quota; 120/minute per trusted IPv4 or IPv6 /64; missing/invalid trusted address 20/minute                                            |
| Existing API admission | Existing route/client limits and 10,000/minute aggregate budget retained; public reads do not charge it                                                                   |
| Negative backoff       | At most 4,096 hashed/fixed keys per process, at most 1 s TTL and no extension on repeats; reset empties it; a full map stops adding keys and falls back to PostgreSQL     |
| Limiter storage        | Migration 016 caps new allocations at 200,000 rows transactionally, independent of cleanup; existing over-cap installations must drain expired rows before new allocation |
| Cleanup                | At most seven batches of 10,000 expired buckets, at most once/minute/instance; signal/audit cleanup adds at most 1,000 rows each                                          |

The migration runner locks bucket mutations before initializing the counter in published
migration 016. Migration 018 reconciles previously applied counters under the same lock; readiness
requires 018. Published migration SQL and checksums are unchanged.

Per-instance concurrency multiplies with replicas; database admission and storage bounds are shared.
These limits are not an RPS capacity promise. A distributed attack or a physically exhausted
database can still make service unavailable. PostgreSQL backpressure and HTTP overload return 503
with `Retry-After: 1`; quota rejection returns 429. NAT users share a client quota. No unverified
bearer value, URL, or client-selected label becomes a new limiter dimension.

At startup the server inventories regular files in `public`. Those exact paths (including fonts and
packaged connector archives), plus Next static assets, use the general request/connection limits
without occupying a public-render slot or entering the HTML response buffer. Unknown paths under
`/fonts` or `/downloads` still count as dynamic work; a prefix is not an exemption.

Public dynamic responses are buffered up to 2 MiB (32 MiB for the existing 50,000-URL sitemap
contract), with at most four such responses per instance. Buffer storage can temporarily be copied
once when writing the response. A downstream SQL timeout discards partial output and returns HTTP
503; ordinary API responses continue streaming normally.

Public SQL is live. React request-local memoization shares metadata/render reads with primitive
period/page keys; no public data is cached across HTTP requests. New requests after a committed
visibility change read current PostgreSQL state. An already-running statement may finish its earlier
snapshot. There is no shared cache of cookies, sessions, Browser Sync grants, dashboard state or
HTML. Do not enable blanket CDN caching for `/`, `/dashboard`, `/connect`, OAuth or API.

## Review signals and operator moderation

After an accepted usage transaction has completed existing account deduplication and daily summary
rebuilds, the server evaluates the user's summed daily totals across all agents. Two deterministic
rules flag a day above `VIBERACING_SIGNAL_DAILY_TOKENS` (default `10000000000`) or above
`VIBERACING_SIGNAL_JUMP_RATIO` (default `20`) times the previous UTC day, provided that previous day
is at least 1% of the daily threshold. Thresholds are canonical positive decimal integers. Neither
rule changes token totals, ingestion limits, or account status. Import/delivery time and packet size
are irrelevant; a complete downward correction recalculates signals. Missing previous dates do not
create a jump signal.

One row per user holds at most 32 date/rule pairs, with no uploaded content or provider details.
Identical repeated observations do not append events. Signals expire after 30 days; opportunistic
cleanup under incoming traffic and explicit `prune` remove expired rows in bounded batches. Idle
installations may retain expired physical rows until the next cleanup. Private audit history retains
at most 100 actions per user and expires after 365 days. User deletion cascades both tables.

Use an operator shell with direct database access, never a browser session or connector token:

```sh
node --env-file=/secure/operator.env apps/web/scripts/moderate.mjs list
node --env-file=/secure/operator.env apps/web/scripts/moderate.mjs list AFTER_USER_ID
node --env-file=/secure/operator.env apps/web/scripts/moderate.mjs hidden
node --env-file=/secure/operator.env apps/web/scripts/moderate.mjs hidden AFTER_USER_ID
node --env-file=/secure/operator.env apps/web/scripts/moderate.mjs hide USER_ID
node --env-file=/secure/operator.env apps/web/scripts/moderate.mjs restore USER_ID
node --env-file=/secure/operator.env apps/web/scripts/moderate.mjs prune
```

`USER_ID` is the immutable internal numeric ID. CLI output is private operator data; do not paste it
in ordinary application logs or a public issue. `list` returns up to 100 recent signals ordered by
numeric user ID. Pass the last row's `user_id` as `AFTER_USER_ID` to continue until an empty JSON
array; restart from the first page for a fresh scan if signals change during review. `hidden` uses
the same pagination and includes hidden users regardless of signal age or presence. Both commands
retain the JSON array format and never change moderation state. Hide/restore lock the user and are
idempotent; only actual changes append a timestamped audit action. Hiding filters users before dense
ranking, hides their profile/metadata/sitemap entry, and preserves their private dashboard, sources,
usage, and account deletion. Restoring makes retained data public again under the ordinary
visibility rule. There is no administrative HTTP API and no connector administrative power.

## Production inspection and changes

Record evidence separately as **confirmed**, **requires application**, or **not checked**. A
document or green local test is not proof of a production setting. See the separate validation
report for the state observed for this candidate.

Before any separately authorized rollout, apply migrations, update **every** serving replica, and
verify their candidate version before enabling operator moderation. Old application replicas do not
honor the new hidden flag; do not use hide/restore during a mixed-version rollout. Rollback to an
older application requires keeping public traffic closed or restoring moderation-compatible code.

Use Railway's existing project controls first:

1. Inspect the active deployment SHA, all public/custom domains, replica count and resource limits.
   Verify `/ready`, then one ordinary HTML response for nonce CSP, private cache policy, HSTS,
   frame, referrer and content-type headers. Do not conduct load tests on production.
2. Verify `VIBERACING_TRUST_PROXY=railway` and the edge-overwritten `X-Real-IP` contract. For
   another proxy, demonstrate that it strips incoming forwarding values and writes the observed
   network peer. Arbitrary `X-Forwarded-For` chains are not trusted. Repeat the isolated
   spoof/missing/invalid address/NAT tests whenever the proxy chain changes.
3. Confirm PostgreSQL uses Railway private networking and inspect whether any TCP proxy/public
   database endpoint is enabled. Application `Host` validation does not close an origin.
4. Inspect Railway edge security/attack controls and platform metrics before buying another WAF. Do
   not permanently enable **Under Attack**: Railway documents a browser challenge that blocks
   non-browser clients, including connectors. Do not exempt all `/api/*`, or exempt a request merely
   because it contains `Authorization`.
5. If a separate WAF is eventually needed, first establish an origin reachability restriction that
   prevents bypass through the Railway domain, an old custom domain, or a direct origin route. If
   the provider cannot enforce that restriction, document the remaining bypass instead of claiming
   that a Host-header rule solved it. Coordinate all domain changes with OAuth callbacks and
   existing paired connectors.

During an incident, inspect aggregate refusal/overload ratios, database CPU/connections and
readiness. Use time-bounded native edge controls only with approval, record the prior setting, and
confirm both browser sign-in and a legitimate connector remain usable. If an emergency browser
challenge is chosen, explicitly communicate the temporary connector outage; remove the challenge
once pressure subsides and verify normal sync. Roll back to the recorded edge setting and observe at
least two monitoring windows. Do not disable authentication, same-origin checks or application
quotas to restore traffic.

Sources:
[Railway production controls](https://docs.railway.com/guides/lock-down-production-project),
[OWASP DoS guidance](https://cheatsheetseries.owasp.org/cheatsheets/Denial_of_Service_Cheat_Sheet.html),
[Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting).

## Monitoring rules to configure

`protection_summary` emits bounded counters for admission reasons, early rejection, DB operations,
DB duration/waiting, public SQL reads/duration, HTTP 429/5xx and suppressed logs, plus limiter keys
and RSS. `http_resource_summary` reports launcher requests, overloads and current active/public
work. Summaries are emitted at most once/minute when traffic arrives. Absence during idle time is
expected. Request/admission logs reserve separate per-process minute budgets: 100 ordinary records
and 20 error diagnostics. Disabled log levels consume neither budget. Ordinary successes, health
checks and expected refusals cannot spend the error reserve; excess errors remain bounded and are
represented by counters. Responses retain request IDs even when their detailed log is suppressed.
Labels contain no client or user identities, URLs, token totals, request bodies, credentials or
model data.

The following are proposed operating thresholds, not measured capacity claims. Delivery channel: the
project owner's existing operational email/incident channel, to be selected and confirmed in
Railway. No notification integration is enabled by this PR.

| Rule             | Window / trigger                                                                                       | Verification                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Availability     | 3 consecutive failed 30-second `/ready` checks                                                         | Stop a disposable staging instance; require an actual delivered test notification |
| Server failures  | 5xx > 2% and at least 20 requests over 5 min                                                           | Synthetic staging failure and recovery; check notification and clear event        |
| DB pressure      | connections > 80% of configured maximum or CPU > 80% for 5 min; app DB waiting/503 sustained for 2 min | Bounded staging concurrency run with platform graphs and aggregate logs           |
| Quota/overload   | 429+503 > 20% and at least 100 requests over 5 min, or > 5x established normal baseline                | Isolated admission scenario; ensure request logs stay capped                      |
| Storage / backup | disk > 80%; last successful backup older than 26 h for a daily schedule                                | Provider test alert; inspect schedule, retention and last success                 |

For every rule record three separate facts: definition exists, provider rule configured, test
notification received. Check logs/metrics do not contain privacy canaries before enabling delivery.

## Backup and restore

A suggested target is a daily backup, seven daily plus four weekly restore points, and an additional
snapshot before migration. These are requested operating targets, not claims about the current
Railway plan or enabled schedule. Inspect actual provider capabilities, schedule, retention, last
successful backup and a usable restore action. Obtain separate approval before changing them.

Restore procedure:

1. Keep public traffic closed. Restore into an isolated database/service with no outbound sync or
   background jobs. Never download a production dump into this repository, CI artifact, or local
   synthetic fixture directory.
2. Verify migration checksums and apply only reviewed forward migrations; rerun the migration
   command to prove idempotence. Check foreign keys, row counts, and selected aggregate totals.
3. A backup can resurrect credentials revoked after its timestamp. Before opening traffic,
   invalidate sessions, pairing/poll/pending-device/device capabilities, Browser Sync grants/runs
   and account deletion receipts as applicable; rotate affected secrets if exposure is suspected.
   Require fresh sign-in and pairing. Reconcile account deletions, leaderboard opt-outs and
   moderation decisions that occurred after the restore point before publishing rankings.
4. Validate sign-in, fresh pairing, sync/correction, revocation, hidden/public profile behavior and
   readiness in isolation. Record achieved recovery point and duration. Only then request approval
   to switch traffic. Preserve the former database until rollback is no longer needed.

The local drill uses only generated users and aggregate rows in the dedicated loopback PostgreSQL;
its counts, schema checks, aggregate comparison and timings belong in the validation report.
