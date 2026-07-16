# Dependency and supply-chain policy

## Principles

Every dependency, action, container, toolchain, and generated lockfile is executable supply-chain
input. Convenience is not enough reason to add one. Prefer platform APIs and small repository-owned
checks when they are clear and maintainable.

Mature frameworks and analysis tools are used only where their maintained behavior materially
reduces project risk. The current deliberate set includes Next.js and React for the web runtime,
`@noble/ed25519` for two strict server-side device-signature checks, `pg` for four confined pool
wrappers serving five narrow server-side PostgreSQL adapters, Fastify for one confined Ingest HTTP
server factory, and CSpell, TypeScript, ESLint, Vitest, jsdom, and axe-core for offline
verification. Every direct package is exact-pinned, installs without lifecycle scripts, and is
represented with its complete transitive graph in the dependency inventory. Pull-request CI is
secretless.

The project does not auto-merge dependency updates. A green dependency pull request still requires
human review of purpose, provenance, release history, permissions, transitive changes, and license.

## JavaScript and TypeScript

Every external direct dependency in the root and in each bounded `apps/*` or `packages/*` workspace
uses an exact version. Internal packages use only `workspace:*`. Workspace manifests remain private
until a separate publication review. `pnpm-lock.yaml` is committed and CI installs it with
`--frozen-lockfile --ignore-scripts` from the official npm registry.

`docs/reference/dependency-inventory.json` must exactly match every reachable lockfile package and
installed manifest. Its direct-dependency records identify every declaring workspace and dependency
scope, so an application dependency cannot hide behind a clean root manifest. Cross-platform
optional packages may not be installed on the current host; their exact official-registry license
metadata is committed in `config/npm-package-metadata.json` and cryptographically bound to the
lockfile integrity. Normal verification is offline. Only the explicit
`node scripts/check-licenses.mjs --refresh-npm-metadata` workflow may fetch missing exact manifests;
it refuses redirects, oversized responses, identity/integrity mismatches, and non-official registry
origins.

The offline gate rejects missing, extra, stale, malformed, unapproved, or inventory-drifted
metadata, including an installed package absent from the lockfile. `pnpm run audit:dependencies` is
a separate online check pinned to the official npm registry and fails on moderate, high, or critical
advisories.

`@noble/ed25519@3.1.0` is the only current application cryptography dependency. A local probe showed
that Node's native OpenSSL-backed verifier accepted an all-zero Ed25519 public key and signature, so
platform verification alone did not provide the strict point policy required by VR-DEVICE-001. The
package is confined to one reviewed `verifyAsync` call with `zip215: false` in each private Ingest
and Web service workspace. The Web declaration added by ADR 0026 reuses the exact existing lock
record and transitive-empty graph; lint confines it to the server-only pairing verifier, and the
Next.js production build proves it does not enter a client chunk. The package has no dependency,
optional dependency, native build, install lifecycle script, network capability, or public API
exposure. Its exact registry integrity, MIT license, canonical repository/release, maintenance and
security-review history, and adversarial zero-key regressions were reviewed under ADRs 0015
and 0026. Replacing or updating it requires the same review and proof of strict behavior on every
supported runtime; permissive native fallback is prohibited.

`pg@8.22.0` is the only application PostgreSQL client. It is confined to fixed pool-wrapper files
inside the private Web, Jobs, and Ingest workspaces; each workspace lint policy rejects static,
dynamic, re-export, and CommonJS driver access elsewhere. The adapters expose only their reviewed
parameterized functions and no general query or ORM surface. Its exact registry integrity, MIT
license, transitive graph, optional unused native peer, absence of install lifecycle scripts,
maintenance, and advisory state were reviewed under ADRs 0011, 0014, 0016, 0027, and 0028. Adding
the second Web pool and its fixed pairing-start method changes no package version or transitive
node. An update requires renewed source/release/advisory/license/script/transitive review plus all
role, query, result, timeout, and failure-isolation regressions.

`fastify@5.10.0` is the only direct HTTP server framework. It is confined to the private Ingest
workspace and one reviewed server module; effective lint policy rejects Fastify imports, re-exports,
dynamic imports, and CommonJS access elsewhere. The server registers only the exact Community sync
POST and its closed method/not-found handling, disables framework logging and inbound request IDs,
does not trust proxy headers, preserves the raw body and raw header sequence, and applies bounded
parser, request, handler, keep-alive, socket-reuse, connection, header, and no-queue admission
policies. Its exact official-registry integrity, MIT license, supported Node runtime, release
recency and maintenance state as reviewed on 2026-07-15, security guidance, complete 42-package
added graph, absence of lifecycle/native build scripts, and online advisory result were reviewed
under ADR 0020. The added declarations are MIT or BSD-3-Clause. An update requires renewed
source/release/security/license/script/transitive review plus the raw-framing, proxy, timeout,
overload, generic-error, response-contract, and production-build regressions.

`config/license-policy.json` is a reviewed allowlist of the license expressions currently present;
it is not a general statement that a license is suitable for every future distribution. The checker
also binds pinned Actions and container images to explicit notices. Unknown, missing, changed,
orphaned, or unreviewed declarations fail closed.

`pnpm-workspace.yaml` enforces:

- a minimum 24-hour release quarantine, with failure when registry publish time is absent;
- `trustPolicy: no-downgrade` and lockfile revalidation;
- a repository-local virtual store so CI and interactive installs do not depend on hidden global
  dependency layout state;
- rejection of exotic transitive package sources;
- strict peer and engine handling;
- an explicit dependency-build allowlist, empty by default;
- no tracked registry redirection or project `.npmrc`.

Resolution overrides are exceptions, not invisible configuration. Each exact selector and
replacement must be mirrored in `config/dependency-overrides.json` with a reason, review date,
expiry date, and removal condition. One current override moves Next.js's PostCSS dependency from the
advisory-affected 8.4.31 release to the patched 8.5.19 release; another removes Next.js's optional
`sharp` graph because this application disables remote images and does not use image optimization.
Both expire on 2026-10-12. The PostCSS override must be removed when the pinned Next.js release
resolves a patched version itself; `sharp` must be restored and re-reviewed before any feature
depends on image optimization. A `never`-typed declaration satisfies Next.js's upstream type-only
`sharp` reference without exposing a runtime implementation, and the effective ESLint policy rejects
static, dynamic, re-export, and CommonJS product imports of the package.

An install-script exception requires source review, exact package and version scope, a documented
reason, and a regression check. `dangerouslyAllowAllBuilds` is prohibited.

## Rust

The Rust compiler is pinned in `rust-toolchain.toml`; the workspace uses a committed `Cargo.lock`.
Once a crate exists, the root Rust gate automatically runs formatting, all-target/all-feature
checking, tests, and Clippy with warnings denied.

The connector protocol foundation directly pins `serde@1.0.228` without derive and
`serde_json@1.0.150` for its closed JSON boundaries. Exact-body composition pins `sha2@0.11.0` with
default features disabled for one SHA-256 digest over the returned body bytes. Isolated device
signing pins `ed25519-dalek@3.0.0` with default features disabled and only `zeroize` enabled. The
project does not implement cryptographic primitives, expose generic hashing/signing APIs, or enable
Dalek allocation, batch, digest, fast-table, hazmat, legacy-compatibility, PKCS8/PEM, random-key,
Serde, or prehash features.

Cargo.lock records thirty non-workspace packages. The enabled Windows runtime tree contains
twenty-three: the prior fourteen JSON/digest records plus ed25519-dalek, curve25519-dalek,
curve25519-dalek-derive, ed25519, signature, subtle, zeroize, rustc_version, and semver. The
complete cross-target graph additionally records the five Serde derive/proc-macro packages retained
by impossible `cfg(any())` metadata, target-specific libc through CPU-feature detection, and
target-specific Fiat-Crypto. All thirty records use reviewed permissive expressions; the Dalek slice
adds BSD-3-Clause, `Apache-2.0 OR MIT`, `MIT/Apache-2.0`, and `MIT OR Apache-2.0 OR BSD-1-Clause`
declarations to the exact Cargo allowlist.

All exact registry provenance, checksums, active feature edges, upstream unsafe surface, and build
scripts were reviewed. The Ed25519 graph is pure Rust and reuses the existing SHA-2 0.11 graph. Its
only active build script reads the pinned compiler and Cargo target capabilities to select a local
curve backend; it neither downloads nor links a bundled native library. Reviewed upstream unsafe is
confined to curve constants/SIMD intrinsics, generated dispatch glue, constant-time helpers, and
zeroization's volatile memory operations. Repository-owned connector code remains
`#![forbid(unsafe_code)]`. No new record provides a runtime network client, credential reader,
serializer, key generator, persistent store, or transport.

The maintained upstream 3.0.0 release was more than 24 hours old on review, supports the pinned Rust
toolchain, and avoids a duplicate legacy digest graph. Exact OSV queries on 2026-07-15 reported no
known advisory for any of the ten added lock records. The historical ed25519-dalek keypair-oracle
advisory affects pre-2.0 versions and does not affect 3.0.0; the historical SHA-2 0.9.7
miscomputation advisory is patched from 0.9.8 and does not affect 0.11.0. This is point-in-time
evidence, not a permanent safety claim. SHA-2 must be removed with the composer and Dalek with the
signer, or each must be re-reviewed on update or crypto-provider change. Automated
RustSec/cargo-deny release enforcement, SBOM, and binary audit remain required before connector
distribution.

The Node CI job performs the public-file scan first, installs the pinned minimal Rust toolchain, and
runs `cargo fetch --locked` before deterministic repository verification. Fetch resolves only the
committed checksums and does not execute crate build scripts. The license checker then runs Cargo
metadata offline. The separate Rust job compiles and tests the same lock graph; neither job receives
secrets or release authority.

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
requests. Deterministic pull-request CI uses offline-capable lock, metadata, license, override, and
inventory checks. Maintainers run the separate online `pnpm run audit:dependencies` gate against the
official npm registry before releases and during dependency maintenance; it fails on
moderate-or-higher advisories. Network audit outages are reported separately from test failures and
are never silently treated as success.

Emergency security updates may bypass the quarantine only for one exact reviewed version. A broad or
permanent exclusion is not acceptable.
