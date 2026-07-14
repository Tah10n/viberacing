# Dependency and supply-chain policy

## Principles

Every dependency, action, container, toolchain, and generated lockfile is executable supply-chain
input. Convenience is not enough reason to add one. Prefer platform APIs and small repository-owned
checks when they are clear and maintainable.

CSpell is the current deliberate exception for English code/document spelling: a mature offline
dictionary is materially more reliable than a home-grown word list. It is exact-pinned,
development-only, installed without lifecycle scripts, and its larger transitive graph is fully
represented in the dependency inventory. It never receives secrets in CI because pull-request CI is
secretless.

The project does not auto-merge dependency updates. A green dependency pull request still requires
human review of purpose, provenance, release history, permissions, transitive changes, and license.

## JavaScript and TypeScript

Every external direct dependency in the root and in each bounded `apps/*` or `packages/*` workspace
uses an exact version. Internal packages use only `workspace:*`. Workspace manifests remain private
until a separate publication review. `pnpm-lock.yaml` is committed and CI installs it with
`--frozen-lockfile --ignore-scripts` from the official npm registry.

`docs/reference/dependency-inventory.json` must exactly match every lockfile package and installed
manifest. Its direct-dependency records identify every declaring workspace and dependency scope, so
an application dependency cannot hide behind a clean root manifest. `config/license-policy.json` is
a reviewed allowlist of the license expressions currently present; it is not a general statement
that a license is suitable for every future distribution. The checker also binds pinned Actions and
container images to explicit notices. Unknown, missing, changed, or unreviewed declarations fail
closed.

`pnpm-workspace.yaml` enforces:

- a minimum 24-hour release quarantine, with failure when registry publish time is absent;
- `trustPolicy: no-downgrade` and lockfile revalidation;
- rejection of exotic transitive package sources;
- strict peer and engine handling;
- an explicit dependency-build allowlist, empty by default;
- no tracked registry redirection or project `.npmrc`.

An install-script exception requires source review, exact package and version scope, a documented
reason, and a regression check. `dangerouslyAllowAllBuilds` is prohibited.

## Rust

The Rust compiler is pinned in `rust-toolchain.toml`; the workspace uses a committed `Cargo.lock`.
Once a crate exists, the root Rust gate automatically runs formatting, all-target/all-feature
checking, and Clippy with warnings denied.

New crates require the same necessity, maintenance, license, provenance, and advisory review as npm
packages. Native code, build scripts, proc macros, network clients, cryptography, parsers, and
unsafe code receive additional scrutiny. The workspace forbids unsafe code by default.

## GitHub Actions

Remote actions are pinned to full 40-character commit SHAs with a nearby release comment. Tag-only
references are rejected. Checkout credentials are not persisted. Pull-request CI has read-only
permissions, no secrets, no writable cache, and bounded job timeouts.

An action update is reviewed by comparing the old and new commits in the action's canonical
repository. A version comment is informative; the SHA is authoritative.

## Containers

Container references use a human-readable version tag plus a SHA-256 index digest. The digest is
verified against the publisher's canonical registry before update. Mutable tags such as `latest` are
prohibited.

The current PostgreSQL container is local development infrastructure only. Production images will
have separate build, scanning, SBOM, provenance, and deployment policies.

## Review checklist

Before adding or updating a dependency:

1. Explain the capability that repository-owned or platform code cannot reasonably provide.
2. Verify the canonical publisher, package name, release age, repository, and maintainer activity.
3. Inspect lifecycle/build scripts and the full transitive lockfile diff.
4. Check known advisories, release notes, supported runtimes, and security policy.
5. Confirm license compatibility and update third-party notices when required.
6. Assess browser bundle, connector binary, startup, memory, and network impact.
7. Add or update tests that prove the dependency is used through a bounded interface.
8. Record any exception with an owner, expiry, removal plan, and explicit review.

## Automated updates and audits

Dependabot proposes weekly npm, Cargo, Docker, and GitHub Actions updates with bounded open pull
requests. CI runs a high-severity npm audit in addition to deterministic offline-capable checks.
Network audit outages are reported separately from test failures; they are not silently treated as
success.

Emergency security updates may bypass the quarantine only for one exact reviewed version. A broad or
permanent exclusion is not acceptable.
