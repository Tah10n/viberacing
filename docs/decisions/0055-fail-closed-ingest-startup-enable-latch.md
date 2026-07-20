# ADR 0055: Fail-closed Ingest startup enable latch

- Status: Accepted (local startup latch implemented; deployed kill-switch operation pending)
- Date: 2026-07-18
- Decision owners: Ingest, Operations, Security, Privacy, and Deployment
- Supersedes: None
- Superseded by: None

## Context

The project plan requires independently controlled kill switches for high-risk public capabilities.
The local Ingest host already validates its bind/TLS mode, constructs the protected proof and
least-privileged database composition, and exposes only the reviewed sync route. It did not require
one explicit operator decision to enable that composition. Removing or corrupting an unrelated
listener, proof-key, or database value would fail startup, but that is not a stable, independently
reviewable enable/disable contract.

A complete operational kill switch also needs deployed route ownership, restart/rollout behavior,
health policy, runbooks, audit, and monitoring. None exists in the repository. The next safe local
slice is therefore a fail-closed startup latch: it must be evaluated before every other Ingest host
field and before any downstream protected configuration or runtime resource is created, while making
no claim that a running deployment can be disabled dynamically.

## Decision

The Ingest host requires the exact process-environment field `VIBERACING_INGEST_ENABLED=true`. The
value is case-sensitive and canonical. Missing, empty, `false`, mixed-case, numeric, or any other
value returns the bounded internal `ingest_disabled` configuration code under the existing generic
message.

The latch is the first environment field inspected by `resolveIngestHostConfig`. Unless it is the
exact enabling value, the host does not inspect `NODE_ENV`, host, port, TLS, drain, origin-proof, or
database fields. It creates no application, database pool, verifier, Fastify server, socket, or
listener. The production entry point retains its existing silent status-1 startup failure, so no
environment value, hostname, port, credential detail, key ID, caught exception, or stack is emitted.

A successful resolver returns one frozen exact configuration that includes literal `enabled: true`.
The lower startup composition rejects a mutable, open, missing, or false enable property before
invoking either factory. This prevents a direct dependency-injection caller from accidentally
bypassing the same explicit capability.

The tracked `.env.example` fixes the field to `false`. A developer or operator must deliberately
replace it with exact `true` in ignored or protected configuration before the existing local or
production listener contract can be evaluated. The example checker rejects drift to an enabled
tracked value.

This is a startup latch, not a request-time flag. Once a process has successfully bound, changing
the environment does not affect that process. Disabling a deployed service still requires a reviewed
restart/rollout, route denial or scaling action, health behavior, operator authorization, and
confirmation that no old enabled instance remains. Those deployment controls and the separate
enrollment, pairing, source-creation, proposal, public-ranking, and Jobs switches remain pending.

## Security and privacy consequences

The explicit default-off capability reduces accidental Ingest exposure and makes one incident
control independently testable without weakening origin proof, device signature, replay,
authorization, admission, or database constraints. Evaluating it before protected configuration also
limits secret and connection handling when the capability is intentionally off.

The latch is non-personal Operational startup configuration. The host compares one string and
retains only literal `true` in its frozen local configuration after successful startup. It does not
serialize, log, export, persist, or transmit either the input value or the validated literal. It
adds no request field, user data, database row, metric, trace, audit event, network destination, or
retention class.

This does not protect an already-running process, authenticate an operator, prove Railway or
Cloudflare route denial, stop direct origin traffic by itself, or supply monitoring evidence. An
attacker who can modify the complete deployment environment or process can also change other startup
authority; deployment access control and audit remain mandatory.

Affected invariants are VR-PUBLIC-001, VR-INGEST-001, VR-INGEST-002, VR-ORIGIN-001, VR-DATA-001, and
VR-ABUSE-001. Primary attacker stories are VR-ABUSE-ORIGIN-BYPASS, VR-ABUSE-DATABASE-ROLE,
VR-ABUSE-RESOURCE-EXHAUSTION, and VR-ABUSE-DEPENDENCY-PR.

## Alternatives considered

- **Treat any non-empty or truthy value as enabled:** rejected because permissive boolean parsing
  makes typos and configuration-library coercion fail open.
- **Default to enabled for backward compatibility:** rejected because a new environment should not
  acquire an ingest listener merely by receiving the other configuration fields.
- **Check the flag after application construction:** rejected because disabled startup would still
  read protected key/database values and could allocate a pool before refusing the listener.
- **Check the flag on every request:** rejected because mutable runtime configuration, concurrency,
  failure policy, and per-request branching need a separately reviewed dynamic-control design.
- **Bind a second minimal disabled or health-only server:** rejected because it would add another
  listener/route/response contract and deployment health authority outside ADR 0020.
- **Use absence of a proof key, password, or port as the switch:** rejected because unrelated
  configuration failure is ambiguous and cannot independently express or verify operator intent.

## Migration and rollback

There is no database, role, grant, public HTTP contract, dependency, package, stored-data, or
network migration. Existing local and synthetic integration environments must add the exact enable
value. Tracked example configuration remains disabled.

Rollback removes the explicit field and validated literal only after no deployment or local runner
relies on it. A deployed rollback must preserve an equivalent reviewed default-off gate; it must not
silently make valid listener/database/key configuration sufficient to enable Ingest.

## Verification

Repository evidence covers:

- exact `true` acceptance for development, test, and production listener modes;
- missing, empty, false, mixed-case, numeric, and alternate-string rejection;
- hostile/accessor/non-string environment containment under generic errors;
- proof that disabled resolution inspects no second environment descriptor;
- proof that configured host startup rejects before protected application construction;
- exact frozen `enabled: true` configuration and rejection of missing, false, mutable, or extra
  startup configuration;
- disabled-by-default public example and configuration-checker mutation coverage;
- a built entry point exiting silently with status 1 under explicit disabled state; and
- the existing enabled synthetic loopback/PostgreSQL path, including its controlled four-slot
  no-queue contention result, listener, shutdown, lint, type, coverage, build, documentation,
  architecture, and public-data gates.

The tests do not prove a deployed restart, route denial, old-instance drain, health policy, operator
authentication, audit trail, monitoring alert, Cloudflare/Railway control, live secret or database
credential, production capacity, or any other capability switch.

## References

- [Bounded Railway Ingest host](0033-bounded-railway-ingest-host.md)
- [Bounded Community sync HTTP boundary](0020-bounded-community-sync-fastify-http-boundary.md)
- [Community sync application composition](0019-bounded-community-sync-application-composition.md)
- [Protected origin key configuration](0017-protected-ingest-origin-key-configuration.md)
- [Ingest host workspace](../../apps/ingest-host/README.md)
- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [System context](../architecture/SYSTEM_CONTEXT.md)
- [Data flow](../architecture/DATA_FLOW.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
