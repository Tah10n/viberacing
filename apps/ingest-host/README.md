# Vibe Racing Ingest host

This private workspace is the separate runtime shell around the reviewed `@viberacing/ingest`
application and Fastify server factory. It owns only closed listener configuration, one bind call,
and the process signal lifecycle. Keeping it outside `apps/ingest` preserves that workspace's rule
that cryptographic, contract, database, and HTTP behavior do not acquire deployment authority.

Every mode is disabled unless `VIBERACING_INGEST_ENABLED` is exactly `true`. The host evaluates that
latch before `NODE_ENV`, listener, origin-proof, or database configuration and before constructing
an application, pool, server, or socket. Missing, `false`, or any alternate spelling exits with the
same silent status-1 startup failure. Tracked `.env.example` deliberately fixes it to `false`.

## Listener contract

The selected Railway architecture terminates public TLS before the Node.js process and injects the
application `PORT`. The host therefore has exactly two modes:

| Mode    | `NODE_ENV`           | Host                 | Port                              | TLS declaration      |
| ------- | -------------------- | -------------------- | --------------------------------- | -------------------- |
| Local   | `development`/`test` | `127.0.0.1` or `::1` | `VIBERACING_INGEST_LISTENER_PORT` | `loopback-cleartext` |
| Railway | `production`         | exactly `0.0.0.0`    | Railway-provided `PORT`           | `railway-edge`       |

After the exact enable latch, production also requires `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` from 40
through 300. The first SIGINT or SIGTERM stops admission and closes the Fastify/application/database
composition. The host allows 36 seconds for settlement, below the minimum platform drain window. A
second signal, deadline, or close failure forces an unsuccessful exit. The production start command
must invoke Node directly so a package-manager parent cannot intercept SIGTERM.

`railway-edge` records the selected external TLS contract; it does not make forwarded headers
trusted and does not prove a deployed certificate, Cloudflare-to-Railway route, secret injection, or
direct-origin denial. The underlying HTTP boundary still has `trustProxy: false`, ignores inbound
request IDs, and requires the exact body-bound origin proof before parser or database work.

## Protected configuration

Only after the enable and listener gates pass, the same process environment must also satisfy the
existing Ingest boundaries:

- the six `VIBERACING_INGEST_DATABASE_*` settings for the dedicated least-privileged login; and
- `VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_ID` plus its canonical 32-byte base64url key, with at most
  one complete distinct secondary rotation pair.

This workspace does not enumerate, copy, serialize, or log those values. The tracked environment
file contains only non-working synthetic placeholders. There is no file-based secret fallback,
connection string, certificate bypass, default key, or general configuration dump.

## Build and start

From the repository root:

```text
corepack pnpm run build:contracts
corepack pnpm run build:ingest
corepack pnpm run build:ingest-host
node apps/ingest-host/dist/main.js
```

The contract runtime and Ingest workspace must be built first because the host runs emitted ESM, not
TypeScript source. Invalid or unreadable startup configuration exits with status 1 and no reflective
output. The built-entrypoint gate exercises that behavior under a deliberately invalid environment.

The current 130 host tests prove exact default-off enable admission before every other environment
field or factory, local/production mode parsing, hostile environment and factory containment, real
loopback binding through the reviewed Fastify factory, cleanup on every startup failure, idempotent
close, shutdown-before-start, both signals, second-signal/deadline forcing, and the real synthetic
configured application/pool composition at 100% statement, branch, function, and line coverage. They
do not prove a deployed restart or old-instance drain, Railway deployment, public TLS, working
database login, real origin key, edge signer, direct-origin denial, health policy, monitoring, load,
capacity, or real-user synchronization.

The separate opt-in `pnpm run test:ingest:postgres-integration` gate builds emitted contracts,
Ingest, and host code; starts one disposable PostgreSQL container with an ephemeral loopback-only
port; creates a synthetic login with only `viberacing_ingest`; and sends independently signed
requests through this host. It proves accepted and duplicate acknowledgements, persistent origin
replay and revoked-device denial, closed response headers, unique request IDs, and exact database
stored state. It also holds four valid requests at the first replay-store call, requires a fifth
generic 503 without a fifth replay call, and proves the four accepted responses after release. After
closing the imported host, it starts `dist/main.js` as a separate silent process, observes the
loopback listener with a connection-only probe, proves another exact accepted request, and forcibly
ends only that test child before removing the container, network, and storage. It does not prove
OS-signal delivery, graceful emitted-child settlement, deployment drain, Railway, external TLS,
secret delivery, distributed control, a production credential, edge routing, representative load,
real-user input, or capacity.
