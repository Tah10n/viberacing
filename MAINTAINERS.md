# Maintainers

Public maintainer registry: configured.

## Current maintainers

### Tah10n

- Public GitHub profile: [Tah10n](https://github.com/Tah10n)
- Current roles: maintainer, security responder, and release manager during bootstrap
- Responsibilities: repository stewardship, architecture and security policy, release review, and
  public-source administration
- Effective date: 2026-07-28
- Public conflict disclosure: none declared

The connected GitHub identity and repository administrator/write access were verified on the
effective date. Strong multi-factor authentication remains an account-owner responsibility that
cannot be proven by repository-local checks.

## Maintainer record

Each maintainer entry must include:

- a public GitHub profile URL;
- current project roles from [GOVERNANCE.md](GOVERNANCE.md);
- areas of responsibility;
- the date the role became effective;
- any public conflict disclosures needed for project decisions.

Personal email addresses, private chat handles, recovery contacts, and signing-key secrets do not
belong in this file. Project-controlled contact endpoints may be documented only after they exist
and have been tested.

## Publication gate

The initial source-only publication is complete. Before first populating a replacement public
repository, and before relying on any later public revision as reviewed evidence:

Follow the repository-owned
[first GitHub publication runbook](docs/getting-started/GITHUB_FIRST_PUBLICATION.md). It configures
an empty public repository before the first source push and keeps outside participation closed.

1. Record at least one real public maintainer profile and mark the registry configured.
2. Add `.github/CODEOWNERS` using only identities that have confirmed write access. At least one
   listed maintainer must appear as a direct user owner for the protected policies; organization
   teams may be additional owners because local checks cannot verify team membership.
3. Protect `.github/`, SECURITY.md, and CODE_OF_CONDUCT.md with CODEOWNERS rules.
4. Enable and test GitHub private vulnerability reporting on the empty public repository.
5. Keep source-only participation closed by disabling Issues and Discussions and limiting Pull
   Requests to collaborators; a conduct channel is required only before public interactions open.
6. After the first source push, verify hosted branch protection, multi-factor authentication,
   least-privilege access, and the first Actions run.
7. Run `pnpm run verify:release` and `pnpm run check:publication`.

Two independent maintainers are recommended before public beta and required before a process claims
independent approval or resilient incident response. The current single-maintainer bootstrap does
not claim either property.
