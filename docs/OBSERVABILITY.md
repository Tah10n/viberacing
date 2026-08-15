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

`warn` records cover rejected requests and handled failures. `error` records cover 5xx responses,
uncaught route/render failures, PostgreSQL pool failures, and migration failures. Successful
health/readiness probes are `debug` to avoid burying application events in Railway health traffic;
failed readiness probes remain `error`.

Set `VIBERACING_LOG_LEVEL` to one of:

- `info` (production default): completed application requests plus warnings and errors;
- `debug`: also request starts and successful health/readiness probes, useful during an incident;
- `warn` or `error`: reduced production volume;
- `silent`: disable application logs; do not use this for production.

Filter Railway logs by `level`, `event`, `route`, `status`, `outcome`, `errorCode`, or `requestId`.
Use a returned `X-Request-Id` to follow one failed request. A request start without a matching
completion at `debug` level points to a terminated or stalled request.

## Privacy boundary

Logs deliberately never include request or response bodies, URL query strings, IP addresses,
user-agent strings, cookies, authorization headers, session/pairing/device secrets, user handles,
source identifiers, token totals, prompts, responses, code, repository names, local paths, provider
credentials, model names, or costs. Error messages and stack traces are also omitted because they
can contain those values. Operational diagnosis uses bounded outcome codes, error classes/codes,
route templates, timing, and request correlation instead.

The pre-deploy migration command uses the same JSON format under the `viberacing-migrate` service
name and reports connection, start, applied migration, completion, and failure events.
