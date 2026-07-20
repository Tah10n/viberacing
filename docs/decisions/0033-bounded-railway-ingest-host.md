# ADR 0033: Bounded Railway Ingest host

- Status: Accepted (local entry point implemented; deployment pending)
- Date: 2026-07-17
- Decision owners: Ingest, Operations, Security, Privacy, Contracts, and Dependencies
- Supersedes: None
- Superseded by: None

## Context

ADR 0020 creates a bounded Fastify server but deliberately owns no host, port, TLS, environment, or
process lifecycle. The repository therefore could not start the composed Ingest boundary as a plain
Node.js program. A future wrapper could bind a public development host, invent a default port,
self-terminate TLS contrary to the selected Railway topology, trust forwarding headers, start
through a package-manager parent that intercepts SIGTERM, leave its database pool open after listen
failure, or wait without a bound during shutdown.

The deployment shell must remain separate from `apps/ingest`, whose reviewed responsibility ends at
the HTTP server factory. It must also make only a local execution claim: the public repository does
not contain a Railway service, protected key, working database login, Cloudflare signer,
direct-origin rule, health policy, monitoring sink, or capacity result.

## Decision

Add a private `apps/ingest-host` workspace as the only local owner of listener configuration,
startup composition, and process shutdown. It depends only on the private `@viberacing/ingest`
workspace. Production code in the host may not import Fastify, PostgreSQL, raw HTTP/HTTPS/TLS/socket
modules, filesystem or subprocess APIs. Only `listener-config.ts` reads process environment values.

The listener has two closed modes:

| Runtime                          | Bind contract                                                    |
| -------------------------------- | ---------------------------------------------------------------- |
| `NODE_ENV=development` or `test` | exact loopback plus `VIBERACING_INGEST_LISTENER_PORT`; cleartext |
| `NODE_ENV=production`            | exact `0.0.0.0` plus Railway-injected `PORT`; external TLS       |

Local mode requires `VIBERACING_INGEST_TLS_TERMINATION=loopback-cleartext`. Production requires
`VIBERACING_INGEST_TLS_TERMINATION=railway-edge` and a canonical
`RAILWAY_DEPLOYMENT_DRAINING_SECONDS` from 40 through 300. Port zero is accepted only in explicit
test mode. Production rejects a second local-port field instead of choosing between ambiguous
values. There are no listener defaults, hostname aliases, connection strings, certificate files, or
self-signed fallbacks.

Railway's reviewed public-network contract terminates TLS at its edge and injects `PORT`; the Node
process therefore continues to serve the bounded HTTP factory behind that external termination. The
`railway-edge` value is an operator assertion and startup gate, not cryptographic proof of the
platform or request path. Forwarded headers, Railway request IDs, and platform environment identity
remain unauthenticated application input. ADR 0020 keeps proxy trust disabled, while ADRs 0015,
0017, and 0018 continue to require the exact body-bound, replay-consumed origin proof.

Startup resolves the closed listener configuration, creates exactly one configured ADR 0019
application, passes it to exactly one ADR 0020 server factory, and calls `listen` once with only the
validated host and port. Application creation, server construction, and listen failure each have a
separate generic code and close every successfully created lower boundary. The returned controller
has only an idempotent `close` method.

The process installs SIGINT and SIGTERM handlers before application startup. The first signal starts
a fixed 36-second deadline and waits for Fastify, active application calls, and the database pool to
close. This is longer than the 34-second connection policy and shorter than the minimum Railway
drain declaration. A second signal, timer expiry, or close rejection forces exit status 1; normal
settlement removes both handlers and exits successfully. Production is started with `node` directly
so a package-manager parent cannot intercept SIGTERM. Startup and shutdown failures emit no body,
environment value, hostname, port, database detail, key ID, exception, or stack.

Plain Node execution also requires runtime JavaScript package exports. The private contracts package
now emits ESM under `dist/`, generated relative imports include explicit `.js` suffixes, and its
package export separates TypeScript source types from the emitted runtime. The Ingest package does
the same. This changes no canonical schema, generated type, validator behavior, OpenAPI operation,
or contract source digest.

## Security and privacy consequences

Separating bind authority from request behavior preserves the intended service boundary while making
the exact composition executable. Closed environment modes prevent accidental non-loopback
development exposure and prevent production from silently running under a local cleartext claim.
Bounded startup cleanup, no-queue server close, signal-before-start handling, and a forced deadline
limit leaked pools and indefinite deployment drains. They do not provide distributed backpressure,
direct-origin denial, a live edge proof, or production capacity.

The host adds no user field, request field, cookie, database row, network destination, access log,
metric, trace, analytics event, cache, or export. Listener host, port, TLS declaration, and drain
window are non-personal deployment configuration read only for startup and not retained by the host.
The process accepts no inbound correlation value and emits no startup diagnostic sink. The existing
Security and Usage values remain transient inside the downstream reviewed boundaries and keep their
existing retention rules.

Affected invariants are VR-PUBLIC-001, VR-INGEST-001, VR-INGEST-002, VR-ORIGIN-001, VR-DATA-001, and
VR-ABUSE-001. Primary attacker stories are VR-ABUSE-ORIGIN-BYPASS, VR-ABUSE-DATABASE-ROLE,
VR-ABUSE-RESOURCE-EXHAUSTION, and VR-ABUSE-DEPENDENCY-PR.

## Alternatives considered

- **Put listener and process code in `apps/ingest`:** rejected because it would merge deployment
  authority into the cryptographic/database/HTTP boundary and violate its nested ownership rule.
- **Terminate TLS inside Node:** rejected because the selected Railway public-network path
  terminates TLS before the process. Local certificate/key parsing, reload, custody, and failure
  behavior would add a second TLS boundary without proving the deployed route.
- **Allow cleartext on `0.0.0.0` whenever `NODE_ENV` is not production:** rejected because a typo or
  preview environment could expose the local service. Cleartext is exact-loopback only.
- **Trust `X-Forwarded-Proto`, `X-Real-IP`, or a Railway request header:** rejected because those
  values do not authenticate Cloudflare or replace the exact origin proof.
- **Start through `pnpm` and rely on platform termination:** rejected because the package-manager
  process can receive SIGTERM instead of Node and skip bounded cleanup.
- **Add health, readiness, logs, or metrics now:** deferred because each creates a distinct public
  or retained operational surface and needs its own policy, privacy map, deployment, and negative
  evidence.

## Migration and rollback

This decision adds one private workspace, package build exports, root build/entrypoint gates, and
documentation. It adds no external dependency, database migration, role, grant, public contract,
route, stored value, real environment value, deployment manifest, certificate, or network allowlist.
The tracked environment schema uses intentionally non-working synthetic placeholders.

Rollback removes the host workspace and restores the two package exports only after no executable
consumer remains. The local Ingest application and HTTP factory then return to a non-listening
state. Once deployed, rollback must first deny the public sync path and drain active requests; it
must not replace the host with an ad hoc listener, development-wide bind, unbounded close, proxy
trust, dummy proof key, or package-manager start command.

## Verification

Current local evidence includes:

- exact development/test/production environment modes, IPv4/IPv6 loopback, Railway host/port/TLS
  declaration, canonical port/drain bounds, ambiguous-field rejection, and hostile descriptor/ proxy
  containment;
- application/server construction and listen failure cleanup, malformed factory result rejection,
  exact bind arguments, idempotent close, and non-reflective errors;
- a real ephemeral loopback listener created only through ADR 0020, plus a real synthetic protected
  application/pool composition that starts and closes without a database checkout;
- shutdown requested before startup, both signals, second-signal forcing, timer failure/expiry,
  close rejection, handler cleanup, and startup rejection;
- 130 tests at 100% statement, branch, function, and line coverage with strict lint, type checking,
  and production builds for contracts, Ingest, and the host; and
- a black-box emitted-JavaScript gate proving invalid startup exits with status 1 and produces no
  stdout, stderr, module-resolution stack, or reflected value; and
- one opt-in emitted-host integration that applies all reviewed migrations, creates a synthetic
  dedicated Ingest login and two devices in disposable PostgreSQL, sends independently signed
  loopback HTTP, proves accepted/duplicate/replay/revoke response plus exact persistence, and holds
  four admitted calls at the first replay query while rejecting a fifth without another query before
  closing the imported host; the same gate then starts the built entry point as a separate silent
  process, observes its listener without application work, proves another accepted write, and
  forcibly ends only that test child before teardown.
- one separate opt-in pinned-Linux integration that mounts only the exact link-free emitted
  production graph read-only, passes one independently signed synthetic request to a separate
  capability-free client through stdin, holds the request at origin replay, delivers a real
  `SIGTERM`, and proves exact acknowledgement/persistence settlement, silent code-0 exit,
  database-session release, runtime immutability, and cleanup.

No current test proves Railway or Cloudflare configuration, external TLS, a public hostname,
direct-origin denial, protected secret delivery, a deployment Ingest login/certificate, a health
check, continuous monitoring, deployed signal routing or orchestrator drain behavior, distributed
limits, load/capacity, connector egress, or real-user synchronization.

## References

- [Bounded Community sync HTTP boundary](0020-bounded-community-sync-fastify-http-boundary.md)
- [Community sync application composition](0019-bounded-community-sync-application-composition.md)
- [Protected origin key configuration](0017-protected-ingest-origin-key-configuration.md)
- [Ingest host workspace](../../apps/ingest-host/README.md)
- [Ingest boundaries](../../apps/ingest/README.md)
- [Contract runtime](../../packages/contracts/README.md)
- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [System context](../architecture/SYSTEM_CONTEXT.md)
- [Data flow](../architecture/DATA_FLOW.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
