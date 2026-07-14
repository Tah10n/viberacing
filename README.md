# Vibe Racing

> Status: Phase 0 public foundation. No production service or released
> connector exists yet.

Vibe Racing is an open-source, pixel-art weekly leaderboard for people using
Codex. Participants connect a local, least-privileged connector, submit their
own token-activity buckets, and appear as racing cars on a public track.

## Trust model

Community results are self-reported by local devices. They are not verified by
OpenAI and must never be used for prizes, money, access control, or other
valuable benefits. A separate Verified league remains disabled until a
server-verifiable OpenAI data source exists.

The project does not collect prompts, conversations, repository contents,
Codex access tokens, API keys, or arbitrary user-uploaded files.

## Current documents

- [Public implementation plan](docs/PROJECT_PLAN.md)
- [Implementation status](docs/IMPLEMENTATION_STATUS.md)
- [Security invariants](docs/architecture/SECURITY_INVARIANTS.md)
- [Public repository data policy](docs/security/PUBLIC_REPOSITORY_POLICY.md)
- [Documentation index](docs/README.md)
- [Repository guidance for coding agents](AGENTS.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Russian overview](README.ru.md)

## Open-source baseline

The code is licensed under [Apache-2.0](LICENSE). Project-owned visual assets
will have explicit provenance and licensing before they are added. The
repository will use protected reviews, reproducible checks, signed and
attested connector releases, private vulnerability reporting, and documented
governance before its first public beta.

## Important warning

Do not place production credentials, personal account data, private logs,
internal anti-abuse thresholds, or local machine paths in this repository.
Treat every tracked file as public. Run `pnpm verify`, then scan and review the
exact staged snapshot before committing.
