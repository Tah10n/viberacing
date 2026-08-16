# Contributing

Keep changes focused on the product: one web service, one PostgreSQL database, and one connector.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before starting

- Search existing issues and pull requests before opening a duplicate.
- Use the bug, feature, or question issue form when an issue is useful.
- Discuss broad product or architecture changes before implementing them.
- Report vulnerabilities privately through GitHub's **Report a vulnerability** action as described
  in [SECURITY.md](SECURITY.md). Never put vulnerability details in an issue or pull request.

## Development

For live code reloading, first configure `apps/web/.env.local` as described in the main README, then
run:

```bash
corepack pnpm install --frozen-lockfile
docker compose up -d
corepack pnpm db:migrate
corepack pnpm dev
```

Use `corepack pnpm local:up` instead when testing the complete production image locally.

## Before a pull request

1. Run `corepack pnpm verify`.
2. For production-path changes, also run `corepack pnpm local:up`, `corepack pnpm local:test`, and
   `corepack pnpm local:down` when Docker is available.
3. Update documentation when setup, deployment, privacy, or user-visible behavior changes.
4. Review the diff for secrets and private data.
5. Complete the pull request template with concrete validation evidence.

Never commit credentials, tokens, prompts or responses, proprietary or private third-party source
code, real repository names or local paths, unsanitized agent logs, hostnames, or real user data.

Sanitized excerpts from Vibe Racing, synthetic fixtures, redacted diagnostics, public stack traces,
and example paths such as `/home/example/project` are allowed. `corepack pnpm privacy:check`
verifies the repository boundary without printing secret values.

Security vulnerabilities belong in a private GitHub security advisory, not a public issue. See
[SECURITY.md](SECURITY.md).

## Pull request expectations

- Keep each pull request focused and explain user-visible and operational impact.
- Add regression coverage for behavior changes and fixes.
- Preserve integer precision, UTC date/week semantics, same-origin browser mutations, bounded
  request bodies, parameterized SQL, and the documented privacy boundary.
- Do not weaken a security or privacy property to simplify a change.
- Resolve review conversations and keep required CI checks green before merge.

Maintainers may close changes that are unsafe, out of scope, or too broad to review reliably. This
is a small project, so review time is best-effort; a clear and focused pull request is much easier
to evaluate.

## Contribution licensing

Unless you explicitly state otherwise, any contribution intentionally submitted for inclusion in
Vibe Racing is licensed under the repository's [Apache License 2.0](LICENSE), consistent with
Section 5 of that license. You must have the right to submit the contribution.
