# Vibe Racing

> Status: Phase 0 public foundation. No production service or released connector exists yet.

Vibe Racing is an open-source, pixel-art weekly leaderboard for people using Codex. Participants
connect a local, least-privileged connector, submit their own token-activity buckets, and appear as
racing cars on a public track.

## Trust model

Community results are self-reported by local devices. They are not verified by OpenAI and must never
be used for prizes, money, access control, or other valuable benefits. A separate Verified league
remains disabled until a server-verifiable OpenAI data source exists.

The project does not collect prompts, conversations, repository contents, Codex access tokens, API
keys, or arbitrary user-uploaded files.

## Current documents

- [Public implementation plan](docs/PROJECT_PLAN.md)
- [Implementation status](docs/IMPLEMENTATION_STATUS.md)
- [Security invariants](docs/architecture/SECURITY_INVARIANTS.md)
- [Local development](docs/getting-started/LOCAL_DEVELOPMENT.md)
- [Dependency policy](docs/security/DEPENDENCY_POLICY.md)
- [Pull-request CI trust model](docs/architecture/CI_TRUST_MODEL.md)
- [Public repository data policy](docs/security/PUBLIC_REPOSITORY_POLICY.md)
- [Documentation index](docs/README.md)
- [Repository guidance for coding agents](AGENTS.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Russian overview](README.ru.md)

## Open-source baseline

The code is licensed under [Apache-2.0](LICENSE). Project-owned visual assets will have explicit
provenance and licensing before they are added. The current tree has pinned toolchains, locked
dependencies, reproducible repository gates, read-only secretless pull-request CI, and a disposable
loopback-only PostgreSQL service. Protected reviews, remote security settings, documented
governance, and signed and attested connector releases remain gates before public beta.

## Verify the current foundation

```text
pnpm install --frozen-lockfile --ignore-scripts
pnpm run verify
```

See [local development](docs/getting-started/LOCAL_DEVELOPMENT.md) before starting PostgreSQL. No
application starts at this phase.

## Important warning

Do not place production credentials, personal account data, private logs, internal anti-abuse
thresholds, or local machine paths in this repository. Treat every tracked file as public. Run
`pnpm run verify`, then scan and review the exact staged snapshot before committing.
