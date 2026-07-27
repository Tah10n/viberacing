# Ingest host workspace guidance

Read the root `AGENTS.md`, `apps/ingest/AGENTS.md`, ADRs 0015 through 0020, 0033, and 0055, the
threat model, abuse cases, privacy data map, and this workspace's `README.md` before changing the
host.

## Non-negotiable boundaries

- This workspace owns only listener configuration, startup composition, and process shutdown. It
  must consume `@viberacing/ingest`; it must not import Fastify, PostgreSQL, raw HTTP/TLS/socket
  modules, filesystem secrets, subprocesses, or another service workspace.
- Only `listener-config.ts` may read process environment configuration. Development and test may use
  cleartext only on exact loopback. Production must bind exactly `0.0.0.0:$PORT`, declare
  `railway-edge` TLS termination, and provide a 40-to-300-second Railway drain window.
- Require exact `VIBERACING_INGEST_ENABLED=true` before reading any other host field or constructing
  the protected application/server. Missing, false, malformed, or tracked example state must remain
  disabled; do not add a default-on, truthy parser, request-time flag, or alternate enable source.
- `railway-edge` is an explicit deployment contract, not proof that TLS, Cloudflare routing, or
  direct-origin denial exists. Never trust forwarded headers, platform request IDs, or ambient
  platform identity as authentication.
- Start production with Node directly so SIGTERM reaches this process. The first SIGINT/SIGTERM
  closes the reviewed server under the fixed deadline; a second signal, deadline, or close failure
  exits unsuccessfully. Do not add an unbounded shutdown wait.
- Do not add access logs, request logs, metrics, traces, analytics, a health route, secret-manager
  client, real credential, or deployment manifest in this workspace without its separate privacy,
  threat, and operations decision.
- Startup and configuration failures stay silent and non-reflective. Never emit environment values,
  hostnames, ports, database details, proof keys, bodies, headers, or caught exceptions.
- The enable latch is local startup evidence only. Do not claim dynamic disable, deployed route
  denial, old-instance drain, operator audit, monitoring, or another capability's kill switch.

## Required checks

During iteration run `pnpm run lint:ingest-host`, `pnpm run typecheck:ingest-host`, and
`pnpm run test:ingest-host`. Build and check the entry point when startup or emitted code changes.
Run the PostgreSQL and signal integrations only when their database or process-lifecycle boundary
changes. Use root `pnpm run verify` for handoff and `pnpm run verify:release` only at the release or
broad cross-cutting boundary. Before committing, inspect the exact staged diff and run
`pnpm run check:public:staged` plus `git diff --cached --check`.
