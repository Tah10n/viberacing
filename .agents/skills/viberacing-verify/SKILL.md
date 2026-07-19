---
name: viberacing-verify
description:
  Verify the Vibe Racing repository or a scoped local change using the checked-in deterministic
  commands, staged public-data gates, and explicit evidence boundaries. Use when the user asks to
  verify, validate, test, audit readiness, or prepare a Vibe Racing change for review; do not use it
  to install dependencies, run live or network checks, stage, commit, push, publish, deploy, or
  claim production evidence. Those actions require a separate authorized workflow.
---

# Verify Vibe Racing changes

Keep verification read-only. Use repository-owned commands, preserve unrelated work, and report only
the behavior that the completed gates actually prove.

Read-only applies to source files, the Git index, and history. Repository-owned checks may create
their normal ignored build/test artifacts; do not stage them or treat them as broader evidence.

## Establish the scope

Work only from the Vibe Racing repository root containing `AGENTS.md`, `package.json`, and
`docs/PROJECT_PLAN.md`. Read the root `AGENTS.md` and every nested `AGENTS.md` that governs an
affected path before choosing focused gates.

Inspect the real scope first:

```text
git status --short
git diff --check
```

Include untracked files when reviewing a working tree. Inspect each untracked path directly with
read-only file inspection; `git diff` does not show its content. Use the exact user-named commit,
branch, or staged scope when one is supplied; otherwise inspect both the working-tree diff and the
staged diff. Use only read-only Git inspection commands such as `git diff`, `git diff --cached`, and
`git show` for that scope. Do not stage, edit, discard, reset, commit, or install anything merely to
make verification easier.

## Run deterministic verification

Use the focused commands documented in the governing `AGENTS.md` while iterating. A focused gate is
not a substitute for the canonical repository gate when the user asks for complete verification:

```text
pnpm run verify
```

Use repository-pinned Node, pnpm, and Rust versions. If the active tool violates the declared
engine, do not upgrade or install it; use an already provisioned pinned runtime when available or
report the mismatch as a blocker. Never bypass a hook or checker, weaken an allowlist, regenerate a
lockfile or license inventory without review, or change fixtures only to obtain a pass.

Treat Docker-backed database/Ingest/Jobs integrations and browser capture as separate local
synthetic evidence. Run a named opt-in gate only when the user explicitly requests it or the active
implementation task requires that exact acceptance gate. Do not run the online external-link check,
live OAuth, real-account connector, production database, external edge/TLS, publication, release,
push, or deployment from this skill. Those operations require a separate explicitly authorized
workflow.

## Verify a staged change

When the user asks for pre-commit or staged verification, inspect the complete staged diff and also
disclose any unstaged or untracked difference. Do not stage files on the user's behalf. Run exactly:

```text
git diff --cached --check
pnpm run check:public:staged
```

The staged public-data gate reads Git index blobs. It does not prove that an unstaged working copy
is safe or equivalent, so report the scope precisely.

## Verify committed history

After a commit already exists, or when the user explicitly asks for history/DCO evidence, run:

```text
pnpm run check:history
```

Do not rewrite history, amend commits, or infer an author identity. History repair requires separate
user authorization and an explicitly approved matching Author, Committer, and Signed-off-by
identity.

## Report the evidence

Lead with pass, fail, or blocked. Name each command that ran, its exit result, and the important
checked counts or failing path. Separate deterministic root verification, opt-in synthetic
integration, local browser-lab evidence, and live/deployment evidence.

Never copy secrets, environment values, private logs, or local absolute paths into tracked files or
public artifacts. Sanitize the handoff without hiding the relevant failure class.

Diagnose a failure from its exact output, but do not edit the project unless the user also asked for
a fix. Never turn a local or synthetic pass into a claim about production credentials, external TLS,
real users, capacity, scheduling, deployment, publication readiness, or public beta readiness.
