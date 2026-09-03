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
   VIBERACING_CONNECTOR_DISTRIBUTION=archive
   VIBERACING_MIN_CONNECTOR_VERSION=0.2.0
   VIBERACING_MAX_DAILY_TOKENS=9999999999999999
   VIBERACING_TRUST_PROXY=railway
   VIBERACING_LOG_LEVEL=info
   ```

   This example keeps the self-hosted default `archive` distribution. The official Vibe Racing
   Railway service uses `VIBERACING_CONNECTOR_DISTRIBUTION=npm`; do not change that value during an
   ordinary connector release.

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

## Connector distribution and publication

`VIBERACING_CONNECTOR_DISTRIBUTION` accepts only `archive` or `npm` and defaults to `archive` when
absent. Self-hosted deployments should retain `archive`: the web build and production image include
stable and versioned same-origin tarballs, and dashboard connect, repair, and uninstall commands do
not contact `registry.npmjs.org`.

The official Vibe Racing Railway service completed the npm rollout on 2026-08-25 and uses:

```text
VIBERACING_CONNECTOR_DISTRIBUTION=npm
```

Ordinary connector releases require no Railway change. There are no npm package-name or package-
version environment variables. The official commands remain:

```bash
npx --yes @viberacing/connector@latest connect --origin https://viberacing.up.railway.app
npx --yes @viberacing/connector@latest doctor --repair
npx --yes @viberacing/connector@latest uninstall
```

The stable release workflow publishes the reviewed package version to npm `latest`; it never bumps a
version, publishes a prerelease, or publishes from a pull request. The installed connector refreshes
only when the user explicitly runs `doctor --repair`; there is no background updater or server-side
npm polling.

Production CI compares every connector file that can enter the npm or same-origin archive with the
pull-request base. If those bytes change, `packages/connector/package.json` must contain a strictly
newer stable version. A web build therefore cannot silently create a changed archive under an
already immutable npm version. Staging 0.4.3 in the server-first pull request does not publish it:
the official service remains on npm `latest`, and publication still requires the later reviewed tag
and GitHub Release after the compatible server deployment is healthy.

Protocol v5 is staged with connector 0.6.0 for bounded current-UTC-year history. The server remains
compatible with v2, v3, and v4 rolling snapshots. Preserve server-first ordering: deploy migration
`010_current_year_history.sql` and verify a server that accepts both the old rolling protocols and
v5 before publishing the compatible connector. Only then raise `VIBERACING_MIN_CONNECTOR_VERSION` if
support for an older protocol is intentionally removed or a reviewed installed capability is
deliberately made the supported baseline. Merging the feature pull request itself does not authorize
deployment, npm publication, a tag, a GitHub Release, or a Railway variable change.

Migration 010 is the additive half of an expand-contract rollout. It creates and backfills
`daily_agent_usage`, retains `weekly_agent_usage`, and installs a temporary database bridge so the
previous application could keep reading and writing weekly summaries while Railway ran pre-deploy
before the new healthcheck succeeded. Deployment A then removed every application dependency on the
weekly representation and was verified healthy. Deployment B applies migration 011, which removes
both compatibility triggers, their functions, and `weekly_agent_usage`. The application now reads
and writes only `daily_agent_usage`; `/ready` requires migration 011. The CI weekly-bridge contract
continues to reject destructive compatibility migrations whenever production application references
remain. Connector distribution rollback is independent of this completed application-schema
sequence.

Connector 0.5.0 has an additional OpenCode ordering constraint because production already contains
accepted aggregate snapshots. First publish and run connector 0.4.4, which keeps the old wire
semantics while confirming a bounded content-free hash set for the exact accepted SQLite rows. Only
then publish 0.5.0. A direct 0.4.3 OpenCode upgrade fails closed; it must never infer accepted rows
from server time or alias every row visible at upgrade time.

`VIBERACING_MIN_CONNECTOR_VERSION` is a compatibility floor, not the latest package version. Raise
it only after a server-first rollout and publication of a compatible npm package. Optional patch
updates normally do not change it. Connector 0.4.3 is an explicit exception: after npm `latest` is
verified as 0.4.3, the official Railway service sets the floor to 0.4.3 so the installed all-agent
browser handler becomes the supported baseline. Self-hosted examples may retain 0.2.0.

Rollback needs no database migration: set the single distribution variable back to `archive` and
redeploy. Existing installations, server data, and device tokens remain valid. Do not delete the npm
package or reuse a published name/version. See [Releasing](RELEASING.md) for the completed bootstrap
record, Trusted Publisher controls, stable release, and verification procedures.
