# Public repository data policy

## Purpose

The Vibe Racing source repository, Git history, pull requests, workflow logs,
release artifacts, and documentation are public surfaces. This policy defines
what may enter them and how a publication candidate is reviewed.

## Public by design

The repository may contain source code, versioned protocol schemas, synthetic
fixtures, reserved example addresses, public architecture decisions, bounded
CarRecipe examples, and documented security invariants.

## Private by design

The following stay outside Git and outside public CI output:

- production and staging credentials, signing keys, recovery material, and
  deployment tokens;
- real profile, account, device, source, invite, usage, IP, audit, support, or
  incident data;
- account email, Codex credentials, prompts, conversations, repositories, and
  local Codex logs;
- production host values when disclosure would weaken origin controls;
- exact anti-abuse thresholds, emergency procedures, and detection signals
  whose publication would materially help bypass controls;
- maintainer workstation paths, shell history, browser state, and tool caches.

Secrets belong in the deployment platform or release environment. Operational
records belong in access-controlled systems with retention and audit policy.
Neither is reconstructed in repository fixtures.

## Safe examples

Use only synthetic identities and data. Email examples use RFC-reserved
`example.com`, `example.net`, `example.org`, or `.invalid` domains. Network
examples use documentation address ranges. Identifiers are visibly fake and
usage buckets cannot be mistaken for exports from a real account.

Screenshots and generated assets require metadata and visible-content review.
Do not publish a screenshot of a signed-in browser or a terminal containing a
user-home path. Prefer deterministic fixtures rendered in an isolated profile.

## Required review before a commit

1. Stage only the intended files.
2. Run `pnpm run check:public:staged` so the exact index blobs are scanned.
3. Run `git diff --cached --check` and inspect the complete staged diff.
4. Confirm binary files have intentional provenance and no private metadata.
5. Confirm documentation and fixtures are synthetic and safe to quote publicly.

If a finding is inconvenient, replace the data. Do not add an exception for a
real value. A suspected secret is rotated before work continues because removal
from a later commit does not remove it from Git history.

## Required review before GitHub publication

- scan every reachable Git object, not only the current tree;
- confirm the remote owner, repository visibility, default branch, license,
  security policy, and private vulnerability reporting;
- inspect workflow permissions and prove untrusted pull requests receive no
  secrets or privileged tokens;
- enable GitHub secret scanning and push protection when the repository and
  account support them;
- verify release and deployment environments are approval-gated and separate
  from pull-request CI.

The initial publication is blocked until these checks have recorded evidence.

## Scanner limitations

`scripts/check-public-files.mjs` deliberately rejects common secret shapes,
personal-looking addresses, user-home paths, and risky filenames. Pattern
matching cannot recognize every credential or private fact. Binary metadata,
Git history, external systems, screenshots, and semantic disclosures require
separate review. The scanner is one control in a layered publication process,
not a confidentiality guarantee.
