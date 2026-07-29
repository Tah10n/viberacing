# ADR 0063: Default-off local Jobs scheduler

- Status: Superseded
- Date: 2026-07-19
- Decision owners: Jobs, Security, Privacy, Operations, and Database
- Supersedes: Scheduler-pending portion of ADR 0014
- Superseded by: ADR 0076

## Context

This decision introduced the first default-off in-process scheduler for the former pre-release
Community/source model. It established useful security properties: exact true-only enablement before
protected configuration, a closed catalog, one runner, sequential execution, no overlapping cycles,
generic failure signals, and bounded first-signal shutdown.

The repository had not shipped or accepted real-user data. ADR 0076 therefore selected a clean-slate
AgentAccount/provider-reported-token model, removed the old migration and scoring catalog, and made
the former eighteen-function schedule obsolete.

## Superseding decision

ADR 0076 retains the scheduler boundary but replaces its authority with the clean-bootstrap Jobs
catalog:

- PostgreSQL, not the scheduler, selects current, dirty, and due seasons;
- the scheduler supplies no date or caller-selected batch;
- the fixed hourly catalog contains thirteen capabilities;
- minute slots refresh one due dirty leaderboard;
- five-minute slots refresh and then attempt one due finalization;
- hourly slots execute the full dependency-ordered retention, purge, and reset catalog;
- dirty refresh uses coalesced outbox state, a private row mutex, bounded retry, atomic publication,
  and last-good snapshot retention; and
- profile deletion lockdown revokes Web and connector authority before the bounded purge.

The current implementation and evidence are described by
[ADR 0076](0076-clean-agent-account-provider-reported-token-ranking.md),
[Vibe Racing Jobs](../../apps/jobs/README.md), and
[the Jobs scheduler](../../apps/jobs-scheduler/README.md).

## Historical security consequences retained

The scheduler remains a broad temporal authority but gains no database capability beyond the Jobs
role. It is default-off, accepts no process arguments, stores slot state only in memory, runs
through one-client Jobs confinement, and emits no job name, result, date, identifier, SQL,
configuration, or exception. Multiple deployed replicas would still have independent slots;
PostgreSQL idempotency preserves correctness, but deployment cadence, capacity, replica count,
alerting, and recovery remain separate operational evidence.

## Migration

There is no compatibility migration because all affected state was unreleased and synthetic. Local
databases built from the superseded catalog are discarded and rebuilt from the six-file clean
bootstrap. No production deployment or real-user data migration is claimed.

## References

- [Clean AgentAccount provider-reported token ranking](0076-clean-agent-account-provider-reported-token-ranking.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
