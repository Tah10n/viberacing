# ADR 0044: Bounded repository verification skill

- Status: Accepted (local skill and drift checker implemented; hosted and live evidence unchanged)
- Date: 2026-07-18
- Decision owners: Maintainers, Security, Privacy, Documentation, and Developer Experience
- Supersedes: None
- Superseded by: None

## Context

The repository now has one stable deterministic `pnpm run verify` gate, scoped commands documented
under the relevant agent instructions, exact staged public-data checks, and a separate history/DCO
gate. An agent still has to rediscover which evidence is complete, which Docker or browser gates are
opt-in, and which live, network, publication, or deployment operations require separate authority.
That ambiguity can produce a false readiness claim or turn a verification request into an
unauthorized mutation.

The project plan reserves `.agents/skills/viberacing-verify` for repeatable verification only after
the real commands are stable. The current commands and evidence boundaries are stable enough for a
small repository-owned skill, but it must remain read-only and cannot become a generic shell,
installer, fixer, publisher, or deployment workflow.

## Decision

The repository owns one self-contained `viberacing-verify` skill with only `SKILL.md` and exact
OpenAI interface metadata. It triggers for Vibe Racing verification, validation, readiness audit,
and pre-review requests.

The skill requires an agent to:

- read the root and applicable nested agent instructions;
- inspect the user-selected Git scope, including untracked and staged/unstaged differences, with
  read-only commands;
- use focused gates only as iteration evidence and `pnpm run verify` for a complete deterministic
  repository result;
- run the exact staged whitespace/public-blob gates only for an already staged scope;
- run the history/DCO gate only after a commit exists or when the user explicitly requests it;
- keep Docker, browser capture, network, live, publication, release, push, and deployment evidence
  separate and authority-gated; and
- report exact pass/fail/blocked evidence without turning local or synthetic results into production
  claims.

The skill cannot stage, edit, discard, reset, commit, rewrite history, infer identity, install or
upgrade tools, weaken checkers, publish, push, deploy, or run live/network workflows merely because
verification was requested. A separate user instruction may authorize another workflow, but does not
widen this skill's verification authority.

The repository checker validates both local skills as closed directories. For the verification skill
it derives the required root script names and pinned pnpm policy from `package.json`, requires the
exact front matter/interface metadata and four executable command examples, and checks the
read-only, staged-scope, opt-in, public-output, history, and evidence-claim prohibitions. Mutation
tests prove 25 unsafe or drifted variants fail closed.

## Security and privacy consequences

The skill adds no Vibe Racing dependency, executable, network destination, credential, persistent
field, application log, cache, analytics sink, or export. It operates inside the user's existing
authorized agent environment and reads only repository state and command results in that scope. Its
handoff is a sanitized evidence summary in the current agent interaction; it creates no repository
persistence and forbids copying secrets, environment values, private logs, or local absolute paths
into tracked files or public artifacts.

Residual risk remains: an agent may misunderstand prose outside the checked fragments, a local
toolchain may be missing or hostile, repository tests cannot prove hosted CI or production behavior,
and explicit authority may still be required for Docker, browser, live, release, or Git mutation
workflows. The checker reduces drift but is not a sandbox or a deployment control.

Affected invariants are VR-PUBLIC-001, VR-DATA-001, and VR-SUPPLY-001. Primary attacker stories are
VR-ABUSE-CI-SECRET, VR-ABUSE-DEPENDENCY, and VR-ABUSE-DATABASE-ROLE.

## Alternatives considered

- **Keep verification only in `AGENTS.md`:** rejected because the stable multi-scope workflow and
  evidence distinctions must be rediscovered for every verification request.
- **Add a generic verification shell script:** rejected because the canonical root script already
  exists and a second dispatcher would duplicate command and authority policy.
- **Automatically stage or fix failures:** rejected because verification is read-only and must not
  mutate the user's scope without a separate request.
- **Run every Docker, browser, and online gate by default:** rejected because those gates have
  distinct prerequisites, authority, cost, and evidence semantics.
- **Treat a focused pass as complete:** rejected because focused commands intentionally omit other
  repository trust boundaries.
- **Package a distributable plugin now:** rejected because this is repository-local guidance, not a
  released end-user connector or hosted verification product.

## Migration and rollback

There is no stored-data, protocol, dependency, credential, or deployment migration. Rollback removes
the new skill, its checker branch and mutations, and the documentation claims. If the canonical
commands or evidence boundaries change, update the root policy and the skill/checker together in a
reviewed forward commit; never relax the checker only to preserve stale prose.

## Verification

Acceptance evidence for this decision includes:

- the skill-creator structural generator and generated OpenAI interface metadata;
- repository YAML/front matter, exact-directory, progressive-disclosure, command-allowlist,
  package-script/runtime-pin, and required-prohibition checks;
- 25 mutation cases covering both the proposal and verification skills, including command, network,
  staging, history, edit, runtime, metadata, public-output, and claim drift;
- formatting, documentation, architecture, spelling, public-data, and root deterministic gates; and
- a manual/forward review that the skill remains read-only and reports evidence boundaries
  accurately.

The upstream `quick_validate.py` invocation is additionally attempted when its existing Python
runtime already includes PyYAML; dependency installation is not part of this decision. No local
validator proves hosted CI, Docker integrations, browser release evidence, production behavior,
publication, deployment, or public beta readiness.

## References

- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
- [Repository guidance](../../AGENTS.md)
- [Bounded agent car-proposal orchestration](0039-bounded-agent-car-proposal-orchestration.md)
