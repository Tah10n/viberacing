# Vibe Racing

> Status: Phase 2/3 local vertical slices are in progress. No production service or released
> connector exists.

External participation is closed until real public maintainers, CODEOWNERS, and private reporting
channels are configured. Local identities are never copied into the repository to fill that gap.

Vibe Racing is an open-source, pixel-art weekly leaderboard for people using Codex. Participants
connect a local, least-privileged connector, submit their own token-activity buckets, and appear as
racing cars on a public track.

The current runnable site starts with a clearly labeled synthetic preview so contributors can use it
without an account, connector, or database. It now also requests the current Community week from the
same-origin public score route and replaces the visible race and leaderboard only after a bounded
response passes browser-side validation. A Community handle now selects a same-page public summary
from that same validated field set; daily detail, device counts, exact usage, and identifiers remain
absent. Each selection has a canonical public-handle URL, and a signed-in public profile links to
its current summary without adding a new API or browser storage. An unavailable route leaves the
synthetic fallback visible; the demo garage remains synthetic. A separate invite-only join flow now
composes GitHub OAuth with state and PKCE, one encrypted short-lived continuation, atomic profile
enrollment, required WebAuthn registration, returning discoverable-credential login, a
session-scoped passkey inventory, an active account page, immediate public-profile hide/show, source
and active-device inventory, immediate source pause, fresh-passkey paused-source reactivation,
device revoke, backup-passkey addition and fresh-passkey terminal source unlink, non-current-passkey
revocation, fresh-passkey recovery-code rotation with one-time display, an exact-handle
fresh-passkey profile-deletion request, one-time recovery-code replacement-passkey sign-in, and
logout. It is locally tested only: the repository supplies no invite issuer UI, OAuth registration,
real secret, live OAuth/authenticator/database credentials, scheduled deletion purge,
cache/backup/tombstone handling, restore replay, distributed edge abuse controls, recovery cleanup
or notifications, or live-user evidence.

The authenticated account page now also renders the current Community week's seven derived daily
scores and bounded summary from one combined server-side visibility/score checkout. Hidden profiles
show no score; raw usage, private identifiers, a browser fetch, and browser storage remain absent.

## Trust model

Community results are self-reported by local devices. They are not verified by OpenAI and must never
be used for prizes, money, access control, or other valuable benefits. A separate Verified league
remains disabled until a server-verifiable OpenAI data source exists.

The project does not collect prompts, conversations, repository contents, Codex access tokens, API
keys, or arbitrary user-uploaded files.

## Current documents

- [Public implementation plan](docs/PROJECT_PLAN.md)
- [Implementation status](docs/IMPLEMENTATION_STATUS.md)
- [Security invariants](docs/architecture/SECURITY_INVARIANTS.md)
- [Threat model](docs/security/THREAT_MODEL.md)
- [Abuse cases](docs/security/ABUSE_CASES.md)
- [Privacy data map](docs/security/PRIVACY_DATA_MAP.md)
- [System context](docs/architecture/SYSTEM_CONTEXT.md) and
  [data flows](docs/architecture/DATA_FLOW.md)
- [Compatibility policy](docs/architecture/COMPATIBILITY_POLICY.md)
- [Versioned public contracts](contracts/README.md)
- [Database foundation](database/README.md)
- [Architecture decisions](docs/decisions/README.md)
- [Local development](docs/getting-started/LOCAL_DEVELOPMENT.md)
- [Web prototype](apps/web/README.md)
- [Ingest verification kernel](apps/ingest/README.md)
- [Connector protocol foundation](crates/connector/README.md)
- [Dependency policy](docs/security/DEPENDENCY_POLICY.md)
- [Dependency inventory](docs/reference/dependency-inventory.json)
- [Asset provenance](docs/reference/ASSET_PROVENANCE.md)
- [Pull-request CI trust model](docs/architecture/CI_TRUST_MODEL.md)
- [Public repository data policy](docs/security/PUBLIC_REPOSITORY_POLICY.md)
- [Documentation index](docs/README.md)
- [Repository guidance for coding agents](AGENTS.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Governance](GOVERNANCE.md)
- [Maintainers and publication gate](MAINTAINERS.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [Support](SUPPORT.md)
- [Roadmap](ROADMAP.md)
- [Release policy](RELEASE.md)
- [Changelog](CHANGELOG.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
- [Russian overview](README.ru.md)

## Open-source baseline

The code is licensed under [Apache-2.0](LICENSE). The current product visuals are local HTML, CSS,
canvas primitives, fixed pixel recipes, and one documented project-generated social preview; no
remote fonts or third-party source visual assets are loaded. The current tree has pinned toolchains,
locked dependencies, reproducible repository gates, read-only secretless pull-request CI, and a
disposable loopback-only PostgreSQL service. Protected reviews, remote security settings, documented
governance, and signed and attested connector releases remain gates before public beta.

The governance documents and structured contribution forms are now present and policy-tested. The
repository still has no GitHub remote, public maintainer registry, CODEOWNERS file, or verified
private reporting channels; those hosted controls cannot be safely invented from local data.

Phase 2/3/4 contract and persistence foundations are also present: ten closed, bounded JSON Schemas
plus generated TypeScript validators and locally implemented OpenAPI GET and POST operations. They
cover connector sync/result, problem details, a one-season Community score query, and a
response-only top-32 Community score page with fixed self-reported trust metadata. A server-only
fail-closed mapper now converts only the exact ten-column SQL projection into that response and
rejects malformed, inconsistent, oversized, or contract-invalid results. A bounded server-only
PostgreSQL adapter now uses a separate least-privileged Web login contract, certificate-verified
production transport, a four-connection pool, per-checkout role/read-only verification, fixed
deadlines, and one parameterized top-32 procedure call. A server-only HTTP problem factory now
generates opaque 128-bit request IDs and closed, contract-validated, no-store error responses. A
thin server-only route now enforces the exact query, GET-only method and `Accept` policy,
four-request no-queue admission, adapter deadline policy, store-error translation, final response
validation, and no-store/no-CORS headers. It is locally implemented, not deployed: there is still no
cache, deployment login/TLS integration, edge rate policy, or live API, and this is not evidence
that real Codex data can be submitted. A separate pure local Ingest kernel now copies and bounds the
exact Community sync body and raw headers, verifies a replay-consumed body-bound origin HMAC before
JSON or device work, rejects duplicate headers/decoded keys and excessive parser structure,
validates the generated sync contract, and strictly verifies the source-bound Ed25519 request. It
returns only a frozen database-ready allowlist. A separate bounded Ingest PostgreSQL adapter now
revalidates that allowlist, copies all binary/array parameters, verifies the exact least-privileged
Ingest login/role boundary on every checkout, and exposes only fixed origin-replay, device-lookup,
and submission calls through a four-client deadline-bound pool. Its transport config is
loopback-only without TLS and otherwise certificate-verified; focused tests use mock pools. A
protected local factory now requires one exact primary origin HMAC pair and permits one complete
distinct rotation pair through namespaced configuration; it returns only the verifier and the
repository contains no real key or secret-manager binding. A forced-RLS PostgreSQL replay table now
stores only the origin key ID, domain-separated nonce digest, and millisecond expiry; one Ingest
procedure atomically consumes it, and an observed race proves one winner for an expired tuple. A
transport-free application boundary now generates one server request ID, composes that
replay/device/submission adapter with the exact verifier, waits for database settlement, and returns
only a validated acknowledgement or generic problem decision. A separate local Fastify server
factory now preserves the exact raw body/header evidence for `POST /v1/community/sync`, rejects
proxy and inbound request ID trust, admits four application calls without a queue, applies bounded
parser/header/connection and 5/33/34-second request/handler/connection deadlines, and serializes
only revalidated `no-store` success/problem contracts. A separate local host now binds that exact
factory under loopback-only development/test or explicit Railway-edge production configuration,
closes partial startup, and handles SIGINT/SIGTERM under a fixed deadline. Its 121 tests and built
entrypoint check are synthetic/local evidence, not proof of Railway, external TLS, edge routing,
live credentials, or deployment. A separate opt-in integration builds the emitted host, creates a
synthetic dedicated Ingest login in disposable PostgreSQL, sends independently signed loopback HTTP
requests, and proves accepted, duplicate, persistent origin-replay, revoked-device, response-header,
and exact persistence behavior before cleanup. It supplies no deployment credential, certificate,
protected secret delivery, external edge route, real-user data, or capacity result. A library-only
Rust foundation now emits the fixed stable App Server handshake and, only after it succeeds, a
candidate `0.144.5` account/usage sequence. It confirms ChatGPT mode while discarding
email/plan/summary values and returns at most 31 sorted strict date/token entries. Exact release
metadata, schema digests, minimal extracts, fixtures, and a drift/matrix checker are committed. The
Windows x86_64 development command admits only the exact official artifact size and SHA-256;
repository tests still do not execute a user's Codex account and the compatibility matrix remains
empty. A one-shot supervisor proves the exact sequence against a target-built synthetic child with a
fixed `app-server` argument, local pipes, cleared ambient environment, bounded stdout/stderr/time,
late-output rejection, and reap-before-success cleanup. Its reviewed-launch capability remains
private to exact admission. A second inaccessible reviewed context now lets a candidate composer
consume the minimized entries into the exact `ConnectorSyncV1` JSON, SHA-256 digest, unpadded
base64url nonce, and LF-separated device-signature message. An isolated one-use signer consumes that
closed material with an equally inaccessible device-bound Ed25519 key capability and returns only
the same body plus five exact header values. A shared synthetic vector proves the exact public
key/signature across Rust and the production Ingest verifier. A separate inaccessible
pending-key/challenge signer and server-only Web verifier now agree on the exact domain-separated
pairing-possession message and a second shared vector. A transport-free Web/Auth start boundary
generates fresh server identifiers, poll token, challenge, 60-bit human code, separate keyed
verifiers, and a nine-minute pending transaction from closed device metadata. A second activation
boundary uses the same separately probed read-write pool wrapper for protected poll lookup, verifies
the exact approved proof, and alone invokes atomic activation with server-owned identifiers behind
four-call admission and a settlement floor. A local signed-in `/connect` page now accepts one
pending human code, shows the exact bounded device metadata and full public-key fingerprint, and
requires a separate fresh passkey assertion before atomically approving a new opaque source. Its
PostgreSQL lookup counts attempts on the possessed session across Web instances under
deployment-private limits. Two closed local POST routes now expose the versioned pairing start/poll
contracts through shared four-call admission, a fixed-storage global-and-64-bucket PostgreSQL rate
policy, bounded bodies, generic failures, and no-store/no-CORS responses. A local Rust `connect`
command generates an Ed25519 key and anonymous rate ID with the OS CSPRNG, persists a versioned
prepared/pending/active record only in the native credential store, proves possession, and resumes
an interrupted pending poll without printing key, token, challenge, source, or device IDs. A
separate explicit Windows x86_64 `sync` command now canonicalizes and hash-admits one exact
`0.144.5` executable, launches it in a fresh empty working directory, creates fresh request
time/ID/nonce from the active record, sends the exact signed body once to the fixed sync path, and
accepts only a closed acknowledgement. It does not discover binaries, retry an ambiguous POST, or
send edge origin proof. There is still no macOS/Linux admission or result, live protected key
injection, edge signer/direct-origin denial, deployed host/TLS/database login, capacity evidence,
packaging, release, monitoring, supported connector, or deployment. Twenty-six SQL migrations now
add 27 private identity, passkey, restricted-recovery, source, device, pairing, audit, deletion,
replay, usage, Community scoring, and CarRecipe tables with deny-by-default runtime roles, forced
RLS, state-machine constraints, checksum drift detection, and an isolated PostgreSQL capability
test. A narrow procedure boundary implements invite issuance, atomic enrollment, session-bound
initial-passkey challenges, credential-derived login, bounded multi-passkey management, session
rotation/revocation, the immediate lock-down portion of profile deletion, one-time
new/existing-source device pairing, private source/device inventory, source
pause/reactivation/unlink, immediate device revoke, passkey-protected recovery-code rotation, and
short-lived recovery-only replacement-passkey authority. Pairing creates only opaque user-declared
sources: it never reads or stores Codex account email or claims account uniqueness. Source pause is
immediate. Paused-source reactivation now requires a fresh user-verified passkey assertion and one
atomic challenge-consume/reactivate call. Terminal source unlink now uses its own fresh passkey
context and one atomic consume/unlink call that revokes every active source device. The local
identity flow verifies both initial passkey registration and returning discoverable-credential
login. Login options keep the profile-free challenge only in an encrypted cookie; a valid assertion
causes one atomic database create-consume-session call. Anonymous login still requires edge
rate/capacity controls before exposure. The account page uses that same possessed session to read
only passkey labels, active/revoked state, rounded creation dates, the current-authenticator marker,
the closed `public`/`hidden` profile state, at most 32 opaque sources, and at most 64 active device
labels/platforms/versions with rounded activation dates. Credential IDs, raw source IDs, internal
keys, and profile IDs are not rendered; source actions receive only a 15-minute encrypted token
bound to the current session. A same-origin server form can hide the profile from the public score
read or publish it again without stopping source sync. Another can immediately revoke one exact
owned active device even while the profile is hidden. The same page can immediately pause a source
and can reactivate only a paused source after a fresh required-UV passkey assertion; neither action
changes hidden/public visibility or lifts quarantine. A separate destructive control permanently
unlinks any non-terminal source after the same kind of fresh assertion, including while the profile
is hidden; it does not publish the profile. An authenticated passkey revoke control sends only the
selected opaque passkey ID, requires a fresh user-verified assertion bound to that session and
target, and reaches one atomic consume-and-revoke call; the current or last active passkey cannot be
removed. A separate add control validates and seals the label before prompting, requires an
existing-key assertion plus an independent registration ceremony, and atomically consumes that
step-up while inserting the new credential under the 32-record lifetime cap. A local CarRecipe slice
now validates one exact versioned enum-only recipe, stores at most one private 24-hour proposal per
session-derived profile, previews it in all three themes, and requires an explicit encrypted
session-bound approve or reject control. Approval atomically replaces the active recipe; device,
cross-profile, and non-Web capabilities remain denied. A separate Jobs-only command now deletes
bounded oldest-first batches of expired private proposals while preserving live and active recipes.
The active recipe is not yet projected publicly, and agent/connector ingress, cleanup scheduling,
live credentials, and deployment remain pending. A database-only Community ingest capability now
exposes minimal active-device verification material and accepts bounded source-bound snapshots with
exact retry, nonce replay, monotonic source/date, quarantine, and lifecycle-race enforcement. A
Jobs-only procedure deletes independently bounded batches of expired origin nonces, device nonces,
and raw snapshots while preserving current source/day values. A separate Jobs-only procedure deletes
bounded expired non-activated pairing transactions plus their still-pending keys, while preserving
live and activated bindings. A third cleanup procedure independently deletes expired authentication
challenges and restricted recovery authorities plus an exact still-present used code whose verifier
was already scrubbed. It preserves live ceremonies, unused recovery codes, sessions, passkeys, and
audit evidence, and serializes on profile locks against recovery transitions. The database does not
verify a wire signature; the local kernel and adapter are composed locally and exercised together
with a signed synthetic request. The opt-in loopback integration now carries an independently signed
request through the emitted host and a disposable least-privileged PostgreSQL login, including
duplicate, replay, revoke, response, and stored-state checks. Another Jobs-only procedure serializes
an atomic refresh of one open ISO-week Community season: it sums distinct eligible sources before
one profile daily cap, stores an immutable formula and season binding, shares rank on equal score
and active days, and persists no raw token or source identifier in the score tables. Revision 0024
adds a separate Jobs-only maximum-10 primary deletion procedure. It accepts only due queued/retry
work linked to committed `deletion_pending` profiles, locks its fixed five-capability maintenance
set in stable order, removes restrictive pairings and authority-free pending keys first, terminally
settles the opaque job, and cascades identity, credentials, sources, devices, usage, and personal
score rows atomically. It deliberately creates no unkeyed tombstone. Revision 0010 adds a public
48-hour server-time grace rule, late-snapshot quarantine, and a Jobs-only idempotent finalization
procedure whose terminal metadata and score projection reject silent rewrites while profile purge
can still remove personal rows. One local one-shot Jobs runner now wraps exactly one of seven fixed
functions: authentication cleanup, CarRecipe-proposal cleanup, ingest cleanup, pairing cleanup,
primary profile purge, refresh, or finalization. It uses a distinct least-privileged configuration
namespace, one-client pool, per-checkout role/login/search-path probe, fixed deadlines and prepared
parameters, closed result validation, destructive release after failure, and stable non-reflective
CLI output. It has no scheduler, live login/certificate, monitoring backend, retry loop,
application-to-PostgreSQL integration result, or deployment. Revision 0011 gives only the Web
database role a bounded active-profile score projection containing no raw values, private
identifiers, or exact timestamps. The score response component and Web PostgreSQL adapter preserve
only that public allowlist through the local score route. The visible race, leaderboard, and
selectable participant summary now consume its validated current-week response with a
credential-free same-origin request and an explicit synthetic fallback. Canonical
`/?profile=handle#profile` links select only an exact public handle in that page, and a missing
current top-32 row is not replaced with another participant. There is now a local
invite/OAuth/initial-passkey enrollment, returning-passkey login, fresh-passkey recovery-code
rotation, one-time recovery-code replacement-passkey sign-in, and a fresh-passkey profile-deletion
request flow. Recovery lookup returns only the selected unused PHC; admitted attempts use bounded
Argon2id work, a protected pepper, generic responses, a configured minimum response floor, and a
four-call local no-queue limit. A valid code creates only the sealed five-minute replacement-passkey
continuation; the normal session is returned only after exact WebAuthn verification and atomic
database completion. The local `/connect` flow now reviews one pending device, explicitly selects a
new or active owned opaque source without exposing its raw ID, and fresh-passkey approves that exact
choice under a database-backed session attempt window; the local start/poll routes and native-store
Rust client complete that synthetic connection path. The separate candidate-only Windows sync
command now joins the reviewed local collector, signer, and one bounded upload, but no repository
test runs a real Codex account or deployed service. There is still no deployed Ingest/score/pairing
API, supported sync connector, trusted edge limit or direct-origin policy, anonymous recovery edge
policy, recovery notification, cleanup/scoring/deletion scheduler, audited correction flow,
cache/backup/tombstone purge, restore replay, live OAuth/authenticator/Web/Jobs database
integration, deployment Ingest credential/TLS integration, cross-platform connector evidence,
released binary, or deployed database.

## Run and verify the synthetic prototype

```text
pnpm install --frozen-lockfile --ignore-scripts
pnpm run dev:web
pnpm run verify
pnpm run test:ingest:postgres-integration
```

The final command is an opt-in Docker-backed synthetic loopback integration; it is also required in
CI but is intentionally outside the deterministic offline `verify` command.

`pnpm run check:publication` is a separate fail-closed gate. It is expected to fail in the current
pre-public state and must pass only after real hosted identities and controls are configured.

The development site binds to loopback and remains fully usable with committed synthetic fixtures.
If a separately provisioned Web login is configured, the browser can display the current public
Community projection through the same-origin route; the repository still supplies no working
credential or real user data. See [local development](docs/getting-started/LOCAL_DEVELOPMENT.md)
before running it or starting PostgreSQL. The local enrollment application fails closed without an
externally issued invite, dedicated GitHub OAuth app, fresh cookie key, exact RP/origin settings,
and separately provisioned read-write Web login. No live OAuth, authenticator, or database-login
result is claimed; real-user ingestion does not exist, and database evidence uses only rolled-back
or disposable synthetic fixtures.

## Important warning

Do not place production credentials, personal account data, private logs, internal anti-abuse
thresholds, or local machine paths in this repository. Treat every tracked file as public. Run
`pnpm run verify`, then scan and review the exact staged snapshot before committing.
