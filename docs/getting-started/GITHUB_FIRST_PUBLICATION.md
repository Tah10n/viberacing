# First GitHub publication

This runbook prepares the repository for its first public GitHub source upload without calling that
upload a release, deployment, public beta, or invitation to contribute.

The current project uses **public source-only mode**:

- the empty GitHub repository is public before any source is pushed;
- GitHub private vulnerability reporting is enabled and verified first;
- Issues and Discussions are disabled;
- Pull Requests are limited to collaborators;
- external participation and the conduct-reporting channel remain closed;
- only then is the reviewed `main` history pushed.

This removes the need for an invented conduct endpoint while keeping the source public immediately.
Open participation is a separate later transition.

## Evidence boundary

Local checks can prove tracked files, reachable history, documentation, contracts, and workflow
declarations. They cannot prove:

- who controls a GitHub account or organization;
- whether a maintainer has write access and strong multi-factor authentication;
- whether hosted interaction, security, notification, or branch settings are active;
- whether GitHub Actions used the intended hosted configuration;
- whether source remained unseen after it became public.

Record a hosted control as verified only after an authorized maintainer configures it and reads it
back. Never copy a workstation username, private email, token, or local path into tracked files.

## 1. Complete the local preflight

From the reviewed repository:

```text
git status --short
git diff --check
pnpm run verify:release
pnpm run check:history
pnpm run check:public
```

Review every reachable author, committer, and DCO identity. The owner must confirm that each
bootstrap identity intended for publication is GitHub-verified or uses a GitHub-provided `noreply`
address. Do not rewrite already published protected history for cosmetic attribution changes.

Confirm that `main` is the exact reviewed commit intended for the first push.

## 2. Create one empty public repository

Create an empty **public** repository under the intended personal account or organization. Do not
initialize it with a README, license, `.gitignore`, workflow, or initial commit; those files and the
complete history already exist locally.

Copy the canonical HTTPS or SSH URL, but do not push yet:

```text
git remote add origin https://github.com/<owner>/<repository>.git
git remote -v
```

The placeholders are operator inputs, not values to commit. A public empty repository reveals no
project source, but its owner, name, and settings are public.

GitHub documents the source, fork, activity, and Actions-log consequences of public visibility in
[Setting repository visibility](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility).

## 3. Confirm ownership and add CODEOWNERS

Before adding a public identity to tracked policy:

1. The account owner confirms the exact public GitHub profile.
2. The maintainer confirms write access, strong multi-factor authentication, and the intended role.
3. The maintainer confirms the public Git author, committer, and DCO identity in bootstrap history.
4. Update [MAINTAINERS.md](../../MAINTAINERS.md) with the profile, role, responsibility, effective
   date, and any required public conflict disclosure.
5. Mark the public maintainer registry configured only after those checks.

Create `.github/CODEOWNERS` with the same direct public user handle:

```text
* @<github-user>
/.github/ @<github-user>
/CODE_OF_CONDUCT.md @<github-user>
/SECURITY.md @<github-user>
```

The checker rejects emails, missing owners, duplicate global rules, unreviewed wildcard syntax, and
protected-policy rules that do not directly include a listed maintainer.

## 4. Configure the empty public repository

Complete these settings before the source push.

### Private vulnerability reporting

An owner or administrator enables GitHub Private Vulnerability Reporting under Advanced Security.
Read back the exact enabled state through the authenticated API and confirm from a signed-out public
session that **Report a vulnerability** is visible. If a separate authorized test-reporter account
is available, submit one synthetic report, verify the responder notification, and close the test
without publishing it. A repository owner may be rejected by GitHub's outside-reporter endpoint;
that rejection must not create an advisory or be represented as delivery evidence. In that case,
record external-account submission and notification delivery as unproven rather than inventing a
second identity.

Only after the API state and signed-out public action are both verified change
[SECURITY.md](../../SECURITY.md) to:

```text
Private vulnerability reporting status: enabled and verified.
```

GitHub documents the current setting and notification behavior in
[Configuring private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository).

### Source-only interaction restrictions

Configure and read back:

- Issues: disabled;
- Discussions: disabled;
- Pull Requests: collaborators only;
- Wiki and Projects: disabled unless the project has a reviewed use for them.

GitHub explicitly supports disabling Issues when a repository does not accept reports and
restricting Pull Requests to collaborators when outside contributions are closed:
[Disabling issues](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/disabling-issues)
and
[Disabling pull requests](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/disabling-pull-requests).

After all three primary interaction settings are read back, change
[CODE_OF_CONDUCT.md](../../CODE_OF_CONDUCT.md) to:

```text
External participation status: closed.
GitHub public interaction status: restricted and verified.
Conduct reporting channel: not configured.
```

Do not use a public issue, private vulnerability report, personal inbox, or placeholder URL as a
conduct channel. Source-only mode needs none because public participation surfaces remain closed.

### Web-created commit sign-off

Enable **Require contributors to sign off on web-based commits** and read the setting back. GitHub
creates a distinct commit for a normal pull-request merge, so the hosted sign-off policy is required
even when every reviewed head commit already has a local DCO trailer. GitHub documents the setting
in
[Managing the commit signoff policy](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/managing-the-commit-signoff-policy-for-your-repository).

## 5. Run the exact pre-push gate

With the canonical `origin`, confirmed maintainer, CODEOWNERS, verified interaction settings, and
private vulnerability reporting recorded:

```text
pnpm run check:publication
pnpm run verify:release
pnpm run check:history
pnpm run check:public
git diff --check
```

`check:publication` must report `source-only`; any blocker stops the source push.

Before committing ownership or hosted-status changes:

```text
git diff --cached --check
pnpm run check:public:staged
git diff --cached
```

Commit through the normal DCO path and rerun `pnpm run check:history`.

## 6. Push the reviewed source once

The first push creates the default branch and is the one explicit bootstrap exception to later
pull-request-only branch policy:

```text
git push -u origin main
git ls-remote origin refs/heads/main
```

Read back that local `HEAD`, `origin/main`, and the remote `main` SHA are identical. Do not push a
feature branch as the default branch and do not force-push.

## 7. Protect `main` and inspect hosted CI

Immediately after `main` exists, create an active branch ruleset:

- require a pull request before merging;
- require the most recent reviewed push and dismiss stale approvals where available;
- require strict status checks;
- block force pushes and branch deletion;
- require conversation resolution;
- do not add an undocumented bypass;
- keep approval independence proportional to the number of maintainers.

After the first hosted CI run exposes the exact check names, require:

- `Node and repository gates`;
- `Rust workspace gate`;
- `PostgreSQL capability and invariant gate`.

The Windows portable job and exhaustive Docker-backed paths run on `main` or manual dispatch, not as
ordinary pull-request requirements. GitHub documents the relevant controls in
[Available rules for rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets).

Review the first `main` Actions run:

- every expected job completed;
- workflow permissions remained read-only outside protected release jobs;
- logs and artifacts contain no private data;
- Dependabot alerts, secret scanning, and push protection are enabled where available;
- collaborators and GitHub Apps have least privilege;
- PVR and interaction restrictions still match the recorded state.

GitHub's broader recommendations are in
[Best practices for repositories](https://docs.github.com/en/repositories/creating-and-managing-repositories/best-practices-for-repositories).

## 8. Final hosted verification

Run:

```text
git status --short
git fetch origin main
git rev-list --left-right --count origin/main...HEAD
pnpm run check:publication
pnpm run check:history
```

The worktree must be clean, divergence must be `0 0`, the publication gate must pass in source-only
mode, the protected default branch must point to the reviewed commit, and hosted settings must match
their tracked claims.

Public source publication proves none of the following: deployed Web/Ingest/Jobs/Edge services,
production credentials or TLS, a released connector, real-user ingestion, operational monitoring,
capacity, support, or open participation.

## Forward-only DCO repair

Do not use remediation for an unpublished branch: amend or rebase that branch before merge. If an
already published protected commit fails the exact author-matching DCO check, first confirm the
target's immutable full commit ID and exact public author identity. Then follow
[ADR 0077](../decisions/0077-forward-only-individual-dco-remediation.md):

1. branch from the current protected tip without rewriting or force-pushing it;
2. create one empty strict-descendant remediation commit under the exact same author identity;
3. include the exact ADR declaration naming the full 40-hex target ID and directly sign the
   remediation commit itself;
4. run the checker mutation suite and complete reachable-history scan;
5. submit the branch through the normal protected pull-request path; and
6. require and read back automatic web sign-off before creating the new merge commit.

Use a normal merge that preserves the empty remediation commit. Do not rebase-merge it, hard-code a
target exception, ignore merge commits, allow a third party to certify the target, or represent
pull-request checks as successful hosted `main` recovery. Inspect the resulting merge identity and
wait for the exhaustive `main` workflow.

## Opening participation later

Before enabling public Issues, Discussions, or unrestricted Pull Requests:

1. Provision a project-controlled private HTTPS conduct form.
2. Document authorized readers and retention.
3. Test delivery without real incident data.
4. Change the interaction status to `enabled for open participation.`
5. Change external participation to `open.` and record the exact conduct URL.
6. Rerun `check:community`, `check:publication`, `verify:release`, and staged/history checks.
7. Enable only the reviewed GitHub interaction surfaces.

Security and conduct reporting remain separate.

## Stop conditions

Do not push the source when any of these is true:

- `check:publication` fails or reports the wrong mode;
- the public maintainer or direct CODEOWNER is unconfirmed;
- the public Git/DCO identity is unapproved;
- PVR or source-only interaction restrictions are untested;
- `main` is not the reviewed source;
- public-file or history review found private data;
- a policy file claims a hosted control that cannot be demonstrated.

Do not announce a release, deployment, beta, support channel, or open participation merely because
the source is public. Those are separate authorized actions and evidence gates.
