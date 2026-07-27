# Public repository data policy

## Purpose

The Vibe Racing source repository, Git history, pull requests, workflow logs, release artifacts, and
documentation are public surfaces. This policy defines what may enter them and how a publication
candidate is reviewed.

## Public by design

The repository may contain source code, versioned protocol schemas, synthetic fixtures, reserved
example addresses, public architecture decisions, bounded CarRecipe examples, and documented
security invariants.

Tracked symbolic links and Git submodules are not allowed. Public checks must never follow a
repository path into a maintainer workstation, another checkout, or mutable external source.

## Private by design

The following stay outside Git and outside public CI output:

- production and staging credentials, signing keys, recovery material, and deployment tokens;
- real profile, account, device, source, invite, usage, IP, audit, support, or incident data;
- account email, Codex credentials, prompts, conversations, repositories, and local Codex logs;
- production host values when disclosure would weaken origin controls;
- exact anti-abuse thresholds, emergency procedures, and detection signals whose publication would
  materially help bypass controls;
- maintainer workstation paths, shell history, browser state, and tool caches.

Secrets belong in the deployment platform or release environment. Operational records belong in
access-controlled systems with retention and audit policy. Neither is reconstructed in repository
fixtures.

## Safe examples

Use only synthetic identities and data. Email examples use RFC-reserved `example.com`,
`example.net`, `example.org`, or `.invalid` domains. Network examples use documentation address
ranges. Identifiers are visibly fake and usage buckets cannot be mistaken for exports from a real
account.

Git identity metadata is the narrow exception. An author explicitly confirms a public
GitHub-verified or GitHub-provided `noreply` address before it is used in Git Author/Committer
headers and one exact author-matching DCO `Signed-off-by` trailer. The address remains forbidden in
tracked files and ordinary commit-message text. Placeholder identities, missing or duplicate
sign-offs, and author/sign-off mismatches fail the reachable-history check.

Screenshots and generated assets require metadata and visible-content review. Do not publish a
screenshot of a signed-in browser or a terminal containing a user-home path. Prefer deterministic
fixtures rendered in an isolated profile.

The Phase 1 viewport baseline capture is narrower still: it accepts only an exact loopback origin
and an explicitly named Chromium executable, creates a temporary profile, permits only synthetic
page state, and writes page-only PNGs. The committed manifest and offline checker protect matrix
coverage, dimensions, digests, size, and PNG chunks; they do not replace inspection of every image
or certify a visual change. Its separate verify-only mode first applies that integrity boundary,
requires the manifest's exact reported browser product/platform, and rejects any decoded-pixel
difference without changing repository files. The supplied executable still requires explicit
operator and provenance review.

## Required review before a commit

1. Stage only the intended files.
2. Run `pnpm run check:public:staged` so the exact index blobs are scanned.
3. Run `git diff --cached --check` and inspect the complete staged diff.
4. Confirm binary files have intentional provenance and no private metadata.
5. Confirm documentation and fixtures are synthetic and safe to quote publicly.

If a finding is inconvenient, replace the data. Do not add an exception for a real value. A
suspected secret is rotated before work continues because removal from a later commit does not
remove it from Git history.

## Required review before GitHub publication

- run `pnpm run verify:release` and require `pnpm run check:publication` to pass;
- scan every reachable Git object, not only the current tree;
- confirm every reachable commit has a non-placeholder public Git identity and one exact
  author-matching DCO sign-off;
- record real public maintainers and CODEOWNERS without copying private workstation identities;
- confirm the remote owner, repository visibility, default branch, license, security policy, and
  private vulnerability reporting;
- test the private conduct-reporting channel and restrict its access and retention;
- inspect workflow permissions and prove untrusted pull requests receive no secrets or privileged
  tokens;
- enable GitHub secret scanning and push protection when the repository and account support them;
- verify release and deployment environments are approval-gated and separate from pull-request CI.

The initial publication is blocked until these checks have recorded evidence.

## Scanner limitations

`scripts/check-public-files.mjs` deliberately rejects common secret shapes, personal-looking
addresses, user-home paths, and risky filenames. `scripts/check-git-history.mjs` exempts an address
only after structurally validating the Author/Committer headers and exact author-matching DCO
trailer; it still scans ordinary message text and every historical blob. Pattern matching cannot
recognize every credential or private fact. Binary metadata, external systems, screenshots, and
semantic disclosures require separate review. The scanners are controls in a layered publication
process, not a confidentiality guarantee.
