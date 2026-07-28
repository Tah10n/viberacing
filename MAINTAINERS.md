# Maintainers

Public maintainer registry: not configured.

No public maintainer identity is recorded in this pre-public tree. Local usernames, account names,
email addresses, Git identities, and filesystem paths are private workstation context and must not
be copied here.

## Maintainer record

When participation opens, each maintainer entry must include:

- a public GitHub profile URL;
- current project roles from [GOVERNANCE.md](GOVERNANCE.md);
- areas of responsibility;
- the date the role became effective;
- any public conflict disclosures needed for project decisions.

Personal email addresses, private chat handles, recovery contacts, and signing-key secrets do not
belong in this file. Project-controlled contact endpoints may be documented only after they exist
and have been tested.

## Publication gate

Before the repository is announced or outside contributions are accepted:

Follow the repository-owned
[first GitHub publication runbook](docs/getting-started/GITHUB_FIRST_PUBLICATION.md). It keeps the
initial source upload private while the local and private-repository controls below are completed,
then requires a controlled visibility cutover and verified private vulnerability reporting before
announcement or outside participation.

1. Record at least one real public maintainer profile and mark the registry configured.
2. Add `.github/CODEOWNERS` using only identities that have confirmed write access. At least one
   listed maintainer must appear as a direct user owner for the protected policies; organization
   teams may be additional owners because local checks cannot verify team membership.
3. Protect `.github/`, SECURITY.md, and CODE_OF_CONDUCT.md with CODEOWNERS rules.
4. Configure and test private security and conduct-reporting channels.
5. Verify hosted branch protection, multi-factor authentication, and least-privilege access.
6. Run `pnpm run verify:release` and `pnpm run check:publication`.

Two independent maintainers are recommended before public beta and required before a process claims
independent approval or resilient incident response.
