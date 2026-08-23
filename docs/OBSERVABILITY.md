# Production observability

The web service writes one-line structured JSON records to stdout/stderr. Railway captures these
streams without another logging service. Production defaults to `VIBERACING_LOG_LEVEL=info`.

Each completed API request contains:

- `timestamp`, `level`, `service`, and `event`;
- a generated `requestId`, also returned as the `X-Request-Id` response header;
- the HTTP method and static route template, never the raw URL or query string;
- response status, safe outcome code, declared request size, and duration in milliseconds;
- safe error type plus PostgreSQL/Next.js error code or digest when available.
- aggregate pairing/sync diagnostics such as received, accepted, stale, and returned item counts.

The authenticated connector diagnostics endpoint emits one `connector_diagnostic` record per
accepted state transition. The fields are intentionally fixed: `agentId`, `diagnosticCode`,
`diagnosticState`, `diagnosticPhase`, and `connectorVersion`. `opened` transitions are `warn` and
`resolved` transitions are `info`. The enclosing completed-request record contains only aggregate
`diagnosticEventsReceived`, `diagnosticsOpened`, and `diagnosticsResolved` counts.

Delivery is intentionally at-least-once. The connector removes a transition from its local outbox
only after it receives the successful response, so a response lost after the server writes the log
can produce the same structured transition again. Local transition deduplication and the bounded
outbox prevent repeated unchanged state from generating new events; they do not provide server-side
exactly-once logging.

Example:

```json
{
  "timestamp": "2026-08-23T12:00:00.000Z",
  "level": "warn",
  "service": "viberacing-web",
  "event": "connector_diagnostic",
  "agentId": "codex",
  "diagnosticCode": "codex_lineage_ambiguous",
  "diagnosticState": "opened",
  "diagnosticPhase": "collect",
  "connectorVersion": "0.3.11"
}
```

Example:

```json
{
  "timestamp": "2026-08-15T15:30:00.000Z",
  "level": "error",
  "service": "viberacing-web",
  "event": "http_request_completed",
  "requestId": "f6277001-6c77-4432-a25d-3f4d562ea710",
  "method": "POST",
  "route": "/api/usage",
  "requestBytes": 842,
  "status": 500,
  "durationMs": 18.42,
  "outcome": "server_error",
  "errorType": "DatabaseError",
  "errorCode": "08006"
}
```

Routine unauthenticated `401`/`403`/`404` responses and OAuth state mismatches are `debug`. Rate
limits, confirmed token/pairing mismatches, and handled operational failures are `warn`. `error`
records cover 5xx responses, uncaught route/render failures, PostgreSQL pool failures, and migration
failures. Successful health/readiness probes are `debug` to avoid burying application events in
Railway health traffic; failed readiness probes remain `error`.

Browser Sync has a `browser_sync_grant_user` quota plus isolated `browser_sync_status_run` and
higher aggregate `browser_sync_status_user` polling quotas. Claim admission is bounded before
authentication, then the installation row serializes the active-run and 60-second cooldown guard. A
second valid claim while the guard is active returns `429 sync_rate_limited` with `Retry-After: 60`;
request logs expose only the bounded `rate_limited` outcome. The corresponding content-free terminal
`failed/busy` run lets dashboard polling settle without emitting repeated not-found requests and is
excluded from the cooldown calculation. Status `429` responses also carry `Retry-After`, which the
browser treats as bounded backoff rather than a failed poll.

Runtime configuration is validated before `server_started` is emitted. Invalid configuration logs
`server_configuration_invalid` with a bounded `CONFIG_*` error code, flushes the record
synchronously, and terminates startup. Next.js and dependency console output is normalized into
`framework_console_*` records so their original messages and stack traces cannot bypass the privacy
boundary. Recognized operational failures also include a bounded `diagnosticCode`, such as
`CONNECTION_REFUSED`, `FETCH_FAILED`, or `NEXT_SERVER_ACTION_INVALID`; unknown messages remain
content-free.

Set `VIBERACING_LOG_LEVEL` to one of:

- `info` (production default): completed application requests plus warnings and errors;
- `debug`: also request starts and successful health/readiness probes, useful during an incident;
- `warn` or `error`: reduced production volume;
- `silent`: disable application logs; do not use this for production.

Filter Railway logs by `level`, `event`, `route`, `status`, `outcome`, `errorCode`, `requestId`,
`agentId`, `diagnosticCode`, `diagnosticState`, or `diagnosticPhase`. Use a returned `X-Request-Id`
to follow one failed request. A request start without a matching completion at `debug` level points
to a terminated or stalled request.

## Privacy boundary

Logs deliberately never include request or response bodies, URL query strings, IP addresses,
user-agent strings, cookies, authorization headers, session/pairing/device secrets, user handles,
source identifiers, token totals, prompts, responses, code, repository names, local paths, provider
credentials, model names, or costs. Error messages and stack traces are also omitted because they
can contain those values. Connector diagnostics likewise omit source, installation, user, GitHub,
provider, rollout, thread, and session identifiers. Operational diagnosis uses bounded outcome and
diagnostic codes, error classes/codes, route templates, timing, and request correlation instead.

The pre-deploy migration command uses the same JSON format under the `viberacing-migrate` service
name and reports configuration/discovery failures, connection, start, applied migration, completion,
and execution failures.
