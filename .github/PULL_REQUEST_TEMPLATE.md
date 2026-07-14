# Pull request

Outside contributions are closed until the publication gates in MAINTAINERS.md are complete. Once
participation opens, remove instructional comments and complete every applicable section. Never
include secrets, personal data, private logs, screenshots, account details, or local paths.

## Summary

<!-- Describe the user-visible outcome, why it is needed, and the intentionally excluded scope. -->

## Security and public-data review

- [ ] I reviewed the exact staged diff for secrets, personal data, and local paths.
- [ ] Fixtures and examples are synthetic and use reserved values.
- [ ] No prompt, repository content, credential, private log, or real usage record is collected.
- [ ] Authorization, parsing, state-transition, and abuse-path changes have negative tests.
- [ ] New permissions, data flows, dependencies, assets, and trust boundaries are documented.
- [ ] Community scores remain self-reported and grant no reward, privilege, or access.

<!-- Explain residual risk and why the change preserves every relevant security invariant. -->

## Verification

- [ ] `pnpm run verify` passes from the repository root.
- [ ] Component-specific tests and clean-environment checks are listed below with exact commands.
- [ ] Failure, rollback, migration, and compatibility paths were exercised where applicable.

<!-- List commands and concise results. Do not paste private logs or local absolute paths. -->

## Documentation and compatibility

- [ ] Public contracts, docs, changelog, and EN/RU user-visible copy are updated where applicable.
- [ ] Breaking changes include an ADR, migration, deprecation, and rollback plan.
- [ ] Generated artifacts identify their source and pass drift checks.

## Contributor attestation

- [ ] Every commit includes a DCO sign-off.
- [ ] I have the right to submit all code, documentation, and assets in this change.
- [ ] I read CODE_OF_CONDUCT.md, CONTRIBUTING.md, SECURITY.md, and the security invariants.

## Reviewer notes

<!-- Name the highest-risk assumption, the evidence a reviewer should inspect, and any follow-up. -->
