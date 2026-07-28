# First GitHub publication

This runbook prepares the repository for its first public GitHub appearance without confusing an
initial source upload with a release, deployment, or public-beta launch.

The safe sequence is **local audit → private repository → hosted controls → controlled visibility
cutover → private vulnerability reporting → public announcement**. Keep the source private while
every control available on a private repository is completed. GitHub Private Vulnerability Reporting
is the one documented post-visibility gate because GitHub exposes it to owners and administrators of
public repositories.

## Evidence boundary

Local checks can prove that tracked files, reachable history, documentation, contracts, and
workflows match repository policy. They cannot prove:

- who controls a GitHub account or organization;
- whether a maintainer has write access and multi-factor authentication;
- whether branch rules, notifications, or private reporting are enabled;
- whether a hosted Actions run used the intended settings;
- whether a repository is safe merely because it is private.

Record a hosted control as complete only after an authorized maintainer configures and tests it.
Never copy a workstation username, private email, token, or local path into tracked files to satisfy
a checker.

## 1. Complete the local preflight

From a clean clone or the reviewed local repository:

```text
git status --short
git diff --check
pnpm run verify:release
pnpm run check:history
pnpm run check:public
```

Review all reachable author, committer, and DCO identities. The repository owner must explicitly
confirm that every bootstrap identity intended for publication is GitHub-verified or uses a
GitHub-provided `noreply` address. Do not rewrite published protected history for cosmetic
attribution changes.

Confirm that `main` contains the exact reviewed commit intended for the first push. Do not make a
feature branch the accidental default branch.

## 2. Create a private GitHub repository

Create an empty **private** repository under the intended personal account or organization. Do not
initialize it with another README, license, or `.gitignore`; those files already exist here.

Add only the canonical HTTPS or SSH GitHub URL:

```text
git remote add origin https://github.com/<owner>/<repository>.git
git remote -v
git push -u origin main
```

The owner and repository placeholders are operator inputs, not values to commit. Review the remote
before the push. A successful push is only a private source upload.

GitHub documents repository visibility and the consequences of making a private repository public in
[Setting repository visibility](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility).

## 3. Confirm public ownership

Before adding a public identity to tracked policy:

1. The account owner confirms the exact public GitHub profile.
2. The maintainer confirms write access, strong multi-factor authentication, and the intended public
   role.
3. The maintainer confirms the public Git author/committer/DCO identity used by bootstrap history.
4. Update [MAINTAINERS.md](../../MAINTAINERS.md) with the profile, role, responsibility, effective
   date, and any required public conflict disclosure.
5. Change `Public maintainer registry: not configured.` to `Public maintainer registry: configured.`
   only after those checks.

Do not publish personal email, private chat, recovery, or signing-key information.

## 4. Add CODEOWNERS

Create `.github/CODEOWNERS` only after the confirmed maintainer has write access. Use the same
direct public user handle in the maintainer registry and every required rule:

```text
* @<github-user>
/.github/ @<github-user>
/CODE_OF_CONDUCT.md @<github-user>
/SECURITY.md @<github-user>
```

Additional literal-path rules or organization teams require review. The repository checker rejects
emails, missing owners, duplicate global rules, unreviewed wildcard syntax, and protected-policy
rules that do not directly include a listed maintainer.

## 5. Protect `main`

Run the workflow once in the private repository so GitHub knows the exact check names. Then create
an active branch ruleset for the default branch:

- require a pull request before merging;
- require the most recent reviewed push and dismiss stale approvals when appropriate;
- require strict status checks from GitHub Actions;
- block force pushes and branch deletion;
- do not grant an undocumented bypass;
- keep required review independence proportional to the number of maintainers.

Require at least these pull-request checks from the checked workflow:

- `Node and repository gates`;
- `Rust workspace gate`;
- `PostgreSQL capability and invariant gate`.

The Windows portable job and the exhaustive Docker-backed matrix intentionally run only on `main` or
manual dispatch. Review their first hosted results before public visibility.

GitHub documents required checks, pull-request rules, and force-push/deletion controls in
[Available rules for rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets).

## 6. Configure private reporting

### Security vulnerabilities

During the controlled visibility cutover, an owner or administrator immediately enables GitHub
Private Vulnerability Reporting under the repository's Advanced Security settings. Confirm that the
repository exposes **Report a vulnerability**, submit one authorized synthetic test, verify
responder notification, and close the test without publishing it. Do not announce the repository or
invite external participation during this interval.

Only then change the first line of [SECURITY.md](../../SECURITY.md) to:

```text
Private vulnerability reporting status: enabled and verified.
```

GitHub's current procedure is documented in
[Configuring private vulnerability reporting](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository).

### Conduct reports

Provision a project-controlled private HTTPS form or equivalent endpoint before external
participation opens. It must:

- require no credential or secret in the published URL;
- contain no query string or fragment;
- not be a public GitHub issue page;
- disclose who can read reports and the retention policy;
- be tested by an authorized maintainer.

After verification, replace the conduct channel status with the exact HTTPS URL and change
`External participation status: closed.` to `External participation status: open.` in
[CODE_OF_CONDUCT.md](../../CODE_OF_CONDUCT.md).

Security and conduct channels are separate. Do not route vulnerability details through a general
conduct form.

## 7. Review hosted security

Before changing visibility:

- inspect the first `main` Actions run, including logs and uploaded artifacts;
- verify workflow permissions remain read-only outside protected release jobs;
- enable Dependabot alerts, secret scanning, and push protection where the account plan permits;
- confirm collaborators and GitHub Apps have least privilege;
- verify the default branch and active rulesets;
- check the repository's Community Standards profile;
- review all Actions history that will become public.

GitHub recommends README/community files, protected branches with required checks, Dependabot,
secret scanning, push protection, code scanning, and private vulnerability reporting in
[Best practices for repositories](https://docs.github.com/en/repositories/creating-and-managing-repositories/best-practices-for-repositories).

## 8. Controlled visibility cutover and final gate

Before changing visibility, update tracked ownership, CODEOWNERS, conduct-channel, and participation
policy only to describe controls that already exist. Run:

```text
pnpm run verify:release
pnpm run check:history
git diff --check
pnpm run check:publication
```

At this point `check:publication` must report **only** that private vulnerability reporting is not
enabled and verified. Any additional blocker stops the cutover.

Before the pre-cutover policy commit:

```text
git diff --cached --check
pnpm run check:public:staged
git diff --cached
```

Merge that reviewed commit through protected `main` and confirm the hosted checks. Review GitHub's
visibility-change warnings, then make one controlled change to public visibility. Source and Actions
history become public immediately and anyone can fork the repository; returning to private
visibility cannot undo that disclosure.

Without announcing the project:

1. Enable private vulnerability reporting immediately.
2. Verify the reporting action and responder notification with the authorized synthetic test.
3. Update `SECURITY.md` to the verified status in a reviewed policy change.
4. Run `pnpm run check:publication`, `pnpm run verify:release`, and `pnpm run check:history`.
5. Merge through protected `main` and confirm the hosted checks.
6. Announce the repository or accept outside participation only after every command is green.

If reporting cannot be enabled or verified, stop, return the repository to private visibility when
that reduces further exposure, and investigate before trying again. Record that the source may
already have been observed or forked; do not describe the rollback as reversing publication.

## Stop conditions

Do not start the visibility cutover when any of these is true:

- `pnpm run check:publication` reports anything except the expected unverified private-reporting
  status;
- a public maintainer or direct CODEOWNER is unconfirmed;
- the private conduct channel is untested;
- `main` is not the reviewed source;
- required hosted checks are absent, failing, or bypassed;
- public-file/history review found private data or an unapproved identity;
- a policy file claims a hosted control that cannot be demonstrated.

Do not announce the public repository or accept outside participation until private vulnerability
reporting is tested, the tracked status is accurate, and `check:publication` passes.

Creating a GitHub repository, pushing, opening participation, releasing, and deploying are separate
authorized actions. This runbook grants none of them by itself.
