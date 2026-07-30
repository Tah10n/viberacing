# ADR 0077: Forward-only individual DCO remediation

- Status: Accepted (local checker implemented; hosted recovery evidence pending)
- Date: 2026-07-30
- Decision owners: Maintainers, Security, Privacy, and Developer Experience
- Supersedes: None
- Superseded by: None

## Context

Vibe Racing requires every reachable commit to carry one exact author-matching Developer Certificate
of Origin sign-off. The history checker also treats the validated Git identity as the only narrow
exception to the public repository's ordinary email-address prohibition.

GitHub's normal pull-request merge creates a new merge commit after required pull-request checks
have passed. A published merge commit can therefore contain a missing or mechanically mismatched
sign-off even though every reviewed head commit passed its DCO gate. Rewriting protected public
`main` would invalidate the published commit ID, bypass the normal pull-request path, and disrupt
existing clones. Ignoring merge commits or hard-coding one failed commit would weaken the repository
policy without recording the contributor's certification.

The DCO App documents individual remediation commits as a forward-only way for the original author
to add their sign-off retroactively. Vibe Racing needs a narrower repository-owned form that
preserves the exact author, ancestry, public-data, and single-remediation invariants.

## Decision

The normal and preferred path remains one exact final `Signed-off-by` trailer that byte-for-byte
matches the commit author's name and email. An unpublished branch fixes a missing or incorrect
trailer by amending or rebasing before merge.

Only an already published reachable commit may use one individual remediation commit. The
remediation commit contains exactly one declaration with this grammar:

```text
I, AUTHOR_NAME <AUTHOR_EMAIL>, hereby add my Signed-off-by to this commit: FULL_40_HEX_COMMIT_ID
```

and ends with its own direct author-matching trailer:

```text
Signed-off-by: AUTHOR_NAME <AUTHOR_EMAIL>
```

The history checker accepts the target only when all of these conditions hold:

- the declaration names one exact reachable 40-hex commit ID;
- the target is a strict ancestor of the remediation commit;
- the target and remediation commit have the same exact author name and email;
- the remediation commit has its own normal direct DCO trailer;
- exactly one valid remediation commit names the target; and
- the target either lacks a sign-off or has one syntactically valid final trailer whose email
  already equals the target author's email and whose name alone is mismatched.

Different-email, malformed, duplicate, non-final, sibling-branch, partial-ID, unsigned, ambiguous,
and third-party remediation attempts fail closed. A valid remediation declaration and the eligible
same-email target trailer are sanitized to reserved example identities before public-content
inspection. An invalid declaration remains ordinary commit text and therefore remains subject to the
normal personal-data checks.

Repository administrators require GitHub's automatic sign-off policy for future web-created commits
and read it back before relying on it. This hosted setting prevents recurrence but does not
retroactively repair an existing commit.

## Security and privacy consequences

The decision preserves immutable public history and provides a durable in-history record of the same
author's certification. Full commit IDs and strict ancestry prevent an attestation from being
silently retargeted. Exact author matching prevents another maintainer, bot, or compromised sibling
branch from certifying on the contributor's behalf. Requiring one directly signed remediation
prevents chains of unsigned attestations.

The mechanism adds no application data, credential, dependency, network destination, runtime role,
or production authority. The Git identity remains public indefinitely under DCO 1.1. The checker
continues to reject the identity when it appears in tracked files, arbitrary message text, malformed
remediation text, or a different-email target trailer.

Affected controls are VR-PUBLIC-001 and the TB-01 public repository boundary. Residual risk remains
that a repository host or maintainer account can create misleading Git metadata; protected branch
review, hosted settings, exact history scanning, and human review remain required.

## Alternatives considered

- **Rewrite protected `main`:** rejected because the repository is already public, force pushes are
  blocked, and published commit IDs must remain stable.
- **Ignore all merge commits:** rejected because this repository intentionally applies its public
  identity and privacy checks to every reachable commit.
- **Allow a hash-specific exception:** rejected because it records no contributor certification and
  turns an incident into permanent opaque policy.
- **Allow third-party remediation:** rejected because one maintainer must not certify another
  contributor's DCO assertion.
- **Treat the pull-request head sign-offs as sufficient:** rejected because GitHub adds a distinct
  merge commit with its own author and message.

## Migration and rollback

The published mismatched merge commit is repaired by one empty descendant commit authored and
directly signed by the same Git identity. It names the full immutable target ID with the decided
declaration. The checker, tests, policy, and remediation commit travel through a normal protected
pull request.

Rollback before publication removes the checker and documentation change. After a remediation is
published, do not rewrite it or the target; supersede this ADR and replace the checker through a
forward pull request if the policy changes. Disabling automatic GitHub web sign-off requires a
documented replacement control.

## Verification

Required evidence includes:

- positive tests for a missing trailer and a same-email name mismatch;
- negative tests for unreachable and non-ancestor targets, unsigned or wrong-author remediation,
  different-email targets, duplicate remediation, and malformed commit IDs;
- the exact current-history remediation commit;
- `check:public:staged`, `git diff --cached --check`, checker mutation tests, documentation checks,
  and the complete reachable-history scan; and
- protected pull-request checks followed by a successful exhaustive `main` workflow.

Neither local success nor pull-request success is hosted `main` evidence.

## References

- [Developer Certificate of Origin 1.1](https://developercertificate.org/)
- [DCO App individual remediation support](https://github.com/dcoapp/app#individual-remediation-commit-support)
- [GitHub web commit sign-off policy](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/managing-the-commit-signoff-policy-for-your-repository)
- [Public repository data policy](../security/PUBLIC_REPOSITORY_POLICY.md)
- [First GitHub publication](../getting-started/GITHUB_FIRST_PUBLICATION.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
