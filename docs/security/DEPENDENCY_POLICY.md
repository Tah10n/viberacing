# Dependency and supply-chain policy

## Principles

Every dependency, action, container, toolchain, and generated lockfile is executable supply-chain
input. Convenience is not enough reason to add one. Prefer platform APIs and small repository-owned
checks when they are clear and maintainable.

Mature frameworks and analysis tools are used only where their maintained behavior materially
reduces project risk. The current deliberate set includes Next.js and React for the web runtime,
`@noble/ed25519` for two strict server-side device-signature checks, `pg` for six confined
server-side pool wrappers, `jose` for one bounded Admin Access verifier, `@simplewebauthn/server`
and `@simplewebauthn/browser` for one passkey-registration ceremony, Fastify for one confined Ingest
HTTP server factory, and CSpell, TypeScript, ESLint, Vitest, jsdom, and axe-core for offline
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

`markdownlint-cli2@0.23.1` is a root-only development tool for the repository Markdown gate. The
patch update replaced the exact `globby`, `js-yaml`, `markdown-it`, and `markdownlint` lock nodes
selected by 0.23.0 without adding a package or changing the runtime graph. A later exact
parent-scoped override selects `js-yaml@5.2.2`, the upstream patch for GHSA-pm4m-ph32-ghv5; direct
`markdownlint-cli2@0.23.2` was not admitted while it remained inside the 24-hour release quarantine.
The official-registry manifests and integrity values, upstream changelog, complete lock and
inventory diff, MIT licenses, disabled install lifecycle scripts, Markdown output, and
zero-moderate-or-higher online audit result were reviewed through 2026-07-27. An update requires the
same registry, lock, license, script, advisory, formatting, documentation, and Markdown-gate review;
this CLI must never enter a product workspace or runtime artifact.

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

`@simplewebauthn/server@13.3.2` and `@simplewebauthn/browser@13.3.0` implement the WebAuthn binary,
CBOR/COSE, authenticator-response, and browser ceremony details that should not be reimplemented in
application code. ESLint permits the server package only in the initial-registration verifier and
the browser package only in the passkey setup component; static imports are mandatory. Registration
requires a discoverable credential, user presence and verification, exact RP ID, exact origin, exact
ceremony type, and one-time server challenge. Both direct packages have no lifecycle scripts and use
MIT. The browser package adds no transitive package; the server adds twenty-one exact transitive
records using MIT, BSD-3-Clause, Apache-2.0, or 0BSD. Official-registry integrity, release
quarantine, manifests, complete lock diff, notices, production asset budget, and the online
moderate-or-higher advisory result were reviewed on 2026-07-16. An update requires the same review
plus the options/proof, wrong-origin, wrong-RP, replay, user-verification, dependency-confinement,
coverage, and production-build regressions. Remove both packages if passkeys are removed; do not
replace the verifier with repository-owned WebAuthn parsing.

`jose@6.2.3` implements compact JWS/JWT, local JWK-set selection, WebCrypto-backed RS256 signature
verification, and registered-claim validation for the bounded Admin Cloudflare Access boundary.
Cloudflare's official Node/TypeScript guidance uses this package; repository code additionally
requires the exact assertion header shape, issuer, single audience, human application-token class,
opaque individual membership, one-hour maximum token lifetime, and a second non-regressing clock
read. Lint confines the only product import to `apps/admin/src/access-verifier.ts`, which uses only
`createLocalJWKSet` and `jwtVerify`; remote JWK fetching, signing, decryption, arbitrary algorithms,
email identity, and service tokens remain outside the capability. The exact package is ESM,
side-effect-free, MIT, has no dependency, optional dependency, lifecycle script, native build, or
browser bundle. Its canonical publisher/repository, 2026-04-27 release, registry integrity, release
quarantine, installed manifest, notice, zero-node lock expansion, and online moderate-or-higher
advisory result were reviewed under ADR 0067. An update requires renewed provenance,
release/security/license/script review plus algorithm-confusion, key-rotation, issuer/audience,
service-token, membership, time, confinement, coverage, and production-build regressions. Remove it
if the Admin Access verifier is removed; do not replace it with repository-owned JWT/RSA parsing.

`pg@8.22.0` is the only application PostgreSQL client. It is confined to fixed pool-wrapper files
inside the private Web, Ingest, Jobs, migration, and Admin workspaces; each workspace lint policy
rejects static, dynamic, re-export, and CommonJS driver access elsewhere. The adapters expose only
their reviewed parameterized functions and no general query or ORM surface. Its exact registry
integrity, MIT license, transitive graph, optional unused native peer, absence of install lifecycle
scripts, maintenance, and advisory state were reviewed under ADRs 0011, 0014, 0016, 0027, and 0028.
Adding the second Web pool and its fixed pairing-start method changes no package version or
transitive node. An update requires renewed source/release/advisory/license/script/transitive review
plus all role, query, result, timeout, and failure-isolation regressions.

`fastify@5.10.0` is the only direct HTTP server framework. It is confined to the private Ingest
workspace and one reviewed server module; effective lint policy rejects Fastify imports, re-exports,
dynamic imports, and CommonJS access elsewhere. The server registers only the exact Community sync
POST and its closed method/not-found handling, disables framework logging and inbound request IDs,
does not trust proxy headers, preserves the raw body and raw header sequence, and applies bounded
parser, request, handler, keep-alive, socket-reuse, connection, header, and no-queue admission
policies. Shutdown disables forced idle-socket closure so a fully read request cannot be destroyed
while its application handler still waits on PostgreSQL; the existing five-second keep-alive and
36-second host bounds remain, and a real-listener plus OS-signal regression proves settlement. Its
exact official-registry integrity, MIT license, supported Node runtime, release recency and
maintenance state as reviewed on 2026-07-15, security guidance, complete 42-package added graph,
absence of lifecycle/native build scripts, and online advisory result were reviewed under ADR 0020.
The added declarations are MIT or BSD-3-Clause. An update requires renewed
source/release/security/license/script/transitive review plus the raw-framing, proxy, timeout,
overload, generic-error, response-contract, and production-build regressions.

The 2026-07-27 registry audit required exact parent-scoped patches for the unchanged Fastify
release: `fast-uri@3.1.4` and `fast-uri@4.1.1` close GHSA-v2hh-gcrm-f6hx, while `find-my-way@9.7.0`
closes GHSA-c96f-x56v-gq3h within Fastify's declared range. The exact production runtime inventory,
Ingest unit and PostgreSQL integrations, Edge compatibility, signal settlement, and pinned
production image must remain green until upstream parents select those versions.

`config/license-policy.json` is a reviewed allowlist of the license expressions currently present;
it is not a general statement that a license is suitable for every future distribution. The checker
also inventories every workflow and binds pinned Actions, command-invoked container images, and
exact deployment tools to explicit notices. Unknown, missing, changed, orphaned, mutable, or
unreviewed declarations fail closed.

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
expiry date, and removal condition. Current security overrides close the official-registry
advisories in the Fastify, Markdown, and ESLint tool graphs without relaxing the online audit.
ESLint 9's three parents use only the named `Minimatch` constructor retained by the
quarantine-cleared `minimatch@10.2.5`; its child is fixed at `brace-expansion@5.0.8` until the
parents select a safe pair themselves. Every workspace lint gate is the compatibility oracle for
that temporary cross-major substitution.

The two remaining Next.js overrides move its PostCSS dependency from advisory-affected 8.4.31 to
patched 8.5.19 and remove the optional `sharp` graph because this application disables remote images
and does not use image optimization. All current overrides expire on 2026-10-25. The PostCSS
override must be removed when the pinned Next.js release resolves a patched version itself; `sharp`
must be restored and re-reviewed before any feature depends on image optimization. A `never`-typed
declaration satisfies Next.js's upstream type-only `sharp` reference without exposing a runtime
implementation, and the effective ESLint policy rejects static, dynamic, re-export, and CommonJS
product imports of the package.

An install-script exception requires source review, exact package and version scope, a documented
reason, and a regression check. `dangerouslyAllowAllBuilds` is prohibited.

## Rust

The Rust compiler is pinned in `rust-toolchain.toml`; the workspace uses a committed `Cargo.lock`.
Once a crate exists, the root Rust gate automatically runs formatting, all-target/all-feature
checking, tests, and Clippy with warnings denied.

The connector directly pins `serde@1.0.228` and `serde_json@1.0.150` for closed JSON boundaries,
with derive enabled only for the closed pairing request and response records. Exact-body composition
pins `sha2@0.11.0` with default features disabled for SHA-256, and isolated signing pins
`ed25519-dalek@3.0.0` with default features disabled and only `zeroize` enabled. The repository does
not implement cryptographic primitives or expose generic hashing, signing, or serialization APIs.

The executable pairing slice adds three exact direct dependencies after necessity review:

- `getrandom@0.4.3` obtains the private key and anonymous rate identifier from the operating-system
  CSPRNG;
- `keyring@3.6.3`, with only `windows-native`, `apple-native`, `sync-secret-service`, and
  `crypto-rust`, stores the fixed connector record in Windows Credential Manager, macOS Keychain, or
  Linux Secret Service without a repository plaintext fallback;
- `ureq@3.2.0`, with only `rustls` and `platform-verifier`, performs the two fixed blocking pairing
  requests. Repository code disables proxies and redirects, restricts non-TLS origins to loopback,
  and exposes no general network client.

The enabled `x86_64-pc-windows-msvc` connector graph contains 58 non-workspace packages. The full
cross-target lock graph contains 209 registry packages because the selected keyring features retain
the mutually exclusive Windows, macOS, and Linux native backends and their build-time dependencies.
Both counts are derived from locked Cargo metadata, and the machine-readable inventory remains
authoritative. Every recorded license expression is in the exact reviewed permissive allowlist;
adding a new expression still requires review rather than inventory regeneration as a workaround.

The direct crate versions, registry checksums, enabled features, target branches, native-store
backends, TLS verifier, and transitive lockfile expansion were reviewed. The active Windows graph
includes Rustls/ring TLS, Windows credential APIs, proc macros, and local build scripts; the
complete graph also includes platform-specific native bindings for macOS and Linux. Build and
proc-macro code runs only during compilation. Repository-owned connector code remains
`#![forbid(unsafe_code)]`, but that lint does not make transitive native or unsafe implementation
disappear. Clean-machine builds and runtime credential-store tests on every supported platform
remain release gates.

An exact OSV batch query on 2026-07-17 reported no known advisory for all 209 locked registry
packages. The historical ed25519-dalek keypair-oracle advisory affects pre-2.0 versions and does not
affect 3.0.0; the historical SHA-2 0.9.7 miscomputation advisory is patched from 0.9.8 and does not
affect 0.11.0. This is point-in-time evidence, not a permanent safety claim. Every dependency must
be removed with its capability or re-reviewed on update, feature change, TLS/crypto-provider change,
or supported-platform change. The checked candidate builder now derives a path-free SPDX 2.3
inventory from exact offline `cargo metadata --locked`, binds it to the Cargo lock digest and one
versioned compatibility manifest, and mutation-tests checksums, privacy, release labeling, and
reader-version drift. Hosted cross-platform binary and credential-store results, native platform
signing, notice bundling, automated RustSec/cargo-deny enforcement, and binary audit remain required
before connector distribution.

The pull-request Node job performs the public-file scan first, installs the frozen npm graph without
lifecycle scripts, and runs the bounded development gate. The `main` or manually dispatched Node job
also installs the pinned minimal Rust toolchain and runs `cargo fetch --locked` before the
exhaustive release gate. Fetch resolves only committed checksums and does not execute crate build
scripts; the license checker then runs Cargo metadata offline. The separate Rust job compiles and
tests the same lock graph for every event; no job receives secrets or release authority. Its Ubuntu
runner installs only the `libdbus-1-dev` headers and `pkg-config` before compilation because the
reviewed Linux Secret Service backend links to the runner's native D-Bus library; a configuration
regression binds that exact build-only setup and order. This is hosted build infrastructure, not an
embedded connector runtime or deployment dependency. After exhaustive Node verification, the
secretless `main` or manual job runs eleven synthetic disposable-PostgreSQL integrations, including
the real local Web and Ingest HTTP boundaries plus separate OS-signal checks for emitted Ingest and
Jobs-scheduler processes. They use no production credential or artifact upload and are not release
or deployment evidence.

New crates require the same necessity, maintenance, license, provenance, and advisory review as npm
packages. Native code, build scripts, proc macros, network clients, cryptography, parsers, and
unsafe code receive additional scrutiny. The workspace forbids unsafe code by default.

## GitHub Actions

Remote actions are pinned to full 40-character commit SHAs with a nearby release comment. Tag-only
references are rejected. Checkout credentials are not persisted. Pull-request CI has read-only
permissions, no secrets, no writable cache, and bounded job timeouts.

An action update is reviewed by comparing the old and new commits in the action's canonical
repository. A version comment is informative; the SHA is authoritative.

The manual `main`-only connector-candidate workflow uses
`actions/attest@59d89421af93a897026c735860bf21b6eb4f7b26` (`v4.1.0`) for GitHub Sigstore build
provenance and SPDX attestations and
`actions/upload-artifact@bbbca2ddaa5d8feaa63e36b76fdaad77386f024f` (`v7.0.0`) for a seven-day
`UNSIGNED-CANDIDATE-*` bundle. The exact permissions, protected Environment name, five runner
labels, step order, subjects, retention, and unsigned naming are policy- and mutation-checked. These
first-party actions add a trusted hosted capability and require renewed source, release, permission,
license, and workflow review on update. Their declaration and local policy pass are not a hosted
attestation or native platform signature.

The protected service workflow uses
`cloudflare/wrangler-action@ebbaa1584979971c8614a24965b4405ff95890e0` (`v4.0.0`) only after its
secretless verification job and protected GitHub Environment approval. It selects exact
`wrangler@4.112.0`; either pin change requires renewed canonical-source, release, permission,
license, and workflow-regression review.

## Containers

Container references use a human-readable version tag plus a SHA-256 index digest. The digest is
verified against the publisher's canonical registry before update. Mutable tags such as `latest` are
prohibited.

The current PostgreSQL container is local development infrastructure only. The separate Node
container is a test-profile-only Linux runtime for emitted Ingest and scheduler signal integrations;
each host mounts only its exact generated production graph read-only, while the Ingest client
receives only one synthetic signed request over stdin. It is not a product image and is not
redistributed. The protected workflow invokes Railway CLI `5.26.0` only through
`ghcr.io/railwayapp/cli` at the reviewed index digest, with a read-only filesystem/workspace,
bounded temporary filesystems and resources, all Linux capabilities dropped, and
`no-new-privileges`. Production application images still require separate build, scanning, SBOM,
provenance, and deployment policies.

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
