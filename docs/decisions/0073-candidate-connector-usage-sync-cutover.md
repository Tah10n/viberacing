# ADR 0073: Candidate connector UsageSyncV1 cutover

- Status: Accepted (local candidate connector; release and deployment pending)
- Date: 2026-07-26
- Decision owners: Connector, Contracts, Ingest, Compatibility, Security, and Privacy
- Supersedes: None
- Superseded by: None

## Context

ADR 0071 added the provider-neutral `UsageSyncV1` route beside the legacy `ConnectorSyncV1`
boundary. The only connector implementation remains an unreleased Windows x86_64 development command
for the exact Codex `0.144.5` candidate. Keeping that command on the legacy body would leave the
direct-token beta dependent on a compatibility format even though its replacement is already
implemented and derives the same Codex source attribution on the server.

There is no released connector compatibility promise to preserve. The server must still accept the
legacy route for previously built development clients and for rollback.

## Decision

Keep the existing `sync` command and its closed App Server reader, native credential, admission,
one-shot signing, and no-retry transport boundaries. Change only its emitted wire contract:

- serialize the seven-field `UsageSyncV1` body using `clientVersion`, `agentVersion`,
  `reportedDate`, and `dailyTokenTotal`;
- bind the existing device signature to exact `POST /v1/community/usage`;
- validate only the closed `UsageSyncResultV1` acknowledgement; and
- share one new synthetic exact-body/digest/signature vector between Rust and the production Ingest
  verifier.

The connector does not send provider or accounting revision. Ingest derives both from the active
device/source binding under ADR 0071. The legacy `/v1/community/sync` route and `ConnectorSyncV1`
contract remain accepted but are no longer emitted by the current candidate connector.

This cutover does not widen the App Server method allowlist, add a reader, scheduler, retry,
background process, credential, provider, platform, supported-version row, package, release, or
deployment claim.

## Alternatives considered

- **Keep the current candidate on `ConnectorSyncV1`:** rejected because the working direct-token
  slice would continue to depend on the compatibility body after its exact replacement exists.
- **Send both contracts or retry one after the other:** rejected because an ambiguous first POST
  cannot be safely repeated under another signed path.
- **Add a second user-facing sync command:** rejected because both bodies derive the same bounded
  Codex daily total and a second command would create avoidable operator ambiguity.
- **Remove legacy server acceptance immediately:** rejected because previously built development
  clients and rollback still need the closed compatibility route.

## Security and privacy consequences

The exact path remains inside the signed message, preventing replay across the legacy and usage
routes. Renamed fields carry the same minimized date/token values and version strings; no new data
class leaves the connector. Source-owned provider attribution remains non-writable.

The body, digest input, nonce, signature message, key capability, and request headers remain
non-reflective and one-use. The transport still disables proxies and redirects and sends once.

## Migration and rollback

Deployment must enable exact `VIBERACING_USAGE_SYNC_ENABLED=true` at both Edge and Ingest before
using this candidate command. If the new route is unavailable, leave the token beta disabled and use
a previously reviewed legacy development binary; the command does not retry or silently fall back to
a differently signed path.

After deployment, remove legacy acceptance only through a separate compatibility decision and
evidence window. No database rollback is required because both contracts settle through the same
source-attributed submission semantics.

## Verification

Required local evidence includes:

- exact Rust body, digest, signature, header, URL, and acknowledgement tests;
- strict `UsageSyncV1` validation and signature verification of the shared vector in Ingest;
- contract-checker drift rejection for that vector;
- the complete locked Rust workspace test suite;
- focused Ingest tests; and
- the repository development and release gates.

This remains synthetic/local evidence. It proves no real Codex account read, supported version,
released package, protected Edge/Ingest configuration, external TLS route, production credential,
real-user sync, or deployment.

## References

- [Provider-attributed UsageSyncV1 foundation](0071-provider-attributed-usage-sync-foundation.md)
- [Direct Community token leaderboard](0072-direct-community-token-leaderboard.md)
- [One-shot candidate Community sync](0031-one-shot-candidate-community-sync.md)
- [Codex compatibility policy](../architecture/COMPATIBILITY_POLICY.md)
- [Codex compatibility matrix](../reference/codex-compatibility.md)
- [Usage sync contract](../../contracts/v1/usage-sync.schema.json)
- [Usage sync authentication policy](../../contracts/v1/connector-usage-sync-authentication.json)
