# Deployment

## Railway

1. Create a Railway project, add PostgreSQL, and deploy the repository root as one service.
2. Assign an HTTPS domain and create a dedicated production GitHub OAuth app. Set its homepage to
   the origin and callback to `https://your-domain.example/api/auth/github/callback`. Device Flow is
   not used.
3. Set:

   ```text
   DATABASE_URL=<Railway PostgreSQL URL>
   VIBERACING_PUBLIC_ORIGIN=https://your-domain.example
   GITHUB_CLIENT_ID=<production OAuth client ID>
   GITHUB_CLIENT_SECRET=<production OAuth client secret>
   VIBERACING_DATABASE_SSL=false
   VIBERACING_MIN_CONNECTOR_VERSION=0.2.0
   VIBERACING_MAX_DAILY_TOKENS=9999999999999999
   VIBERACING_TRUST_PROXY=railway
   VIBERACING_LOG_LEVEL=info
   ```

   `VIBERACING_DATABASE_SSL` is the only database TLS switch. Do not add `ssl`, `sslmode`,
   `sslcert`, `sslkey`, `sslrootcert`, `sslnegotiation`, or `uselibpqcompat` parameters to
   `DATABASE_URL`; startup and migrations reject them to prevent conflicting TLS behavior.

   Set database SSL to `true` only for an endpoint with a trusted TLS certificate. Do not set the
   local-only insecure-origin exception in production.

   Origins must not contain URL credentials. A non-empty username or password in
   `VIBERACING_PUBLIC_ORIGIN` (or the local-only `VIBERACING_TEST_GITHUB_ORIGIN`) is rejected with a
   safe configuration code; the credential is never copied into the error or logs.

   `VIBERACING_TRUST_PROXY=railway` is specific to Railway's edge, which overwrites `X-Real-IP`. A
   public self-hosted deployment must instead set `VIBERACING_TRUST_PROXY=trusted-x-real-ip` and run
   behind a reverse proxy that removes any client-supplied `X-Real-IP` and sets exactly one value
   from the network peer it observed. Never enable either mode behind an untrusted or pass-through
   proxy. `none` ignores forwarding headers and is accepted only for loopback/local preview and
   tests; startup rejects it for a public production origin. Arbitrary `X-Forwarded-For` chains are
   not supported.

   The application admission limiter bounds per-client PostgreSQL rows behind a global route cap and
   canonicalizes IPv6 clients to `/64`. It is not a distributed-attack service: keep Railway edge
   controls or another trusted reverse-proxy WAF as an additional production layer.

   Keep `VIBERACING_MAX_DAILY_TOKENS` quoted in YAML-based deployment definitions. Exponential
   notation, surrounding whitespace, leading zeroes, and fractional values are rejected so token
   integers stay canonical decimal strings.

4. Deploy. `railway.json` builds the pinned root image, runs the idempotent migration before
   traffic, and gates rollout on `/ready`.
5. Verify `/health`, `/ready`, GitHub sign-in, multi-source pairing, sync/correction, reconnect
   token rotation, source/installation disconnect, public ranking, and deletion.

The connector needs no daemon, system service, watcher, queue, polling loop, or cron. Supported
provider hooks mark one source in local dirty state and start one short-lived timer process.
Automatic upload attempts are debounced and limited to about one batch per two minutes; they drain
pending aggregates and collect only dirty sources. Manual sync and first connect collect all active
sources immediately. Deployments should not describe the ranking as real-time.

Production startup validates all required variables. The service refuses non-HTTPS remote origins, a
public origin without Railway or a trusted `X-Real-IP`-overwriting reverse proxy, a missing latest
required migration/table, or missing PostgreSQL connectivity; additional later migration ledger rows
are valid. See the [production checklist](PRODUCTION_CHECKLIST.md) for backups, repository controls,
and npm setup. See [production observability](OBSERVABILITY.md) for structured Railway log fields,
incident filtering, levels, and the enforced privacy boundary.

## Connector publication

Release protocol v4 server-first. Deploy and verify a web version that accepts connector protocols
v2, v3, and v4 before publishing connector 0.4.0. Do not raise `VIBERACING_MIN_CONNECTOR_VERSION`
until 0.4.0 is actually available, so deployed v2/v3 connectors continue to sync throughout the
rollout.

After configuring npm trusted publishing and running the same package-content gate used by CI:

```bash
corepack pnpm connector:package:check
```

Publish from the verified package root:

```bash
corepack pnpm --filter @viberacing/connector publish --access public --provenance
```

Users connect with:

```bash
npx @viberacing/connector connect --origin https://your-domain.example
```
