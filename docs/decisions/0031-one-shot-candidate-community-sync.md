# ADR 0031: One-shot candidate Community sync

- Status: Accepted (Windows development slice; release and deployment pending)
- Date: 2026-07-17
- Decision owners: Connector, Ingest, Security, Privacy, Compatibility, and Release
- Supersedes: None
- Superseded by: None

## Context

The local device-connection journey already leaves one source-bound Ed25519 key and its opaque
source/device binding in the native credential store. Separate reviewed boundaries collect bounded
daily usage, compose the exact `ConnectorSyncV1` bytes, sign the exact device message, and accept
that request in Ingest. None of those pieces gave a connected user one command that actually joined
them.

The shortest useful Phase 2 step is a single explicit sync. It must not turn into a discovery
service, daemon, scheduler, updater, generic process launcher, or generic HTTP client. TB-03, TB-04,
and TB-05 still treat the selected executable, App Server output, local environment, device key,
request bytes, network, and acknowledgement as separate hostile boundaries.

## Decision

Add exactly one command:

```text
viberacing-connector sync --origin <https-origin> --label <device-label> --codex <absolute-path>
```

The development command is limited to the Windows x86_64 Codex `0.144.5` candidate. It does not
search `PATH`, read a path override from the environment, or select a newer version. It
canonicalizes the explicit path, opens the file while denying write sharing, requires a regular file
with the exact official Windows release byte count and SHA-256 digest, keeps that handle open across
process execution, and displays only the admitted exact version before launch. The checked-in
candidate manifest records the release, schema, method, fixture, and artifact evidence; the public
support matrix remains empty.

The command creates one fresh unguessable empty working directory, passes only the existing platform
allowlist from the current process, and invokes the existing fixed-argument, bounded,
reap-before-success supervisor. It then:

- requires an existing `active` native credential for the exact origin and label;
- creates one fresh 128-bit `syn_` identifier and 128-bit device nonce from the OS CSPRNG;
- formats the current system time as canonical millisecond UTC and rejects time outside `20xx`;
- constructs the previously inaccessible source/device context and one-use signing-key capability
  only from that validated active record;
- consumes the minimized non-empty daily usage through the existing exact composer and signer; and
- sends the exact body once to the fixed `/v1/community/sync` path with only the five device
  headers.

The HTTP client retains the pairing transport's HTTPS-only remote and loopback-development origin
policy, disabled proxies and redirects, platform certificate verification, bounded deadlines and
response headers, and no ambient credentials. It accepts only a 200 JSON acknowledgement of at most
1024 bytes whose header/body request IDs agree, whose sync ID equals the submitted idempotency key,
and whose closed outcome/count fields validate. It does not send origin-proof headers; the trusted
edge owns that separate proof. It performs no automatic retry after an ambiguous POST. Output is
limited to the admitted exact version and one generic accepted, duplicate, or review message. The
path, usage values, source/device IDs, nonce, signature, and request ID are never printed.

This is a local development slice, not a supported or released connector. It adds no background
execution, automatic discovery, macOS/Linux admission, credential migration, production origin, edge
proof, deployment entry point, live database login, package, updater, or support-matrix row.

## Later decision

[ADR 0051](0051-bounded-candidate-executable-discovery.md) later adds a bounded fixed-name `PATH`
selection path while retaining this explicit `--codex` form and every exact artifact-admission
requirement above. This ADR remains the record of the original explicit-path slice; ADR 0051 is the
authoritative discovery policy and still creates no supported version or release claim.

## Security and privacy consequences

Exact hash admission and the held Windows file handle close the substitution window between review
and launch for the admitted file. The isolated working directory prevents repository context from
becoming the child working tree; the existing environment, framing, output, deadline, and cleanup
limits remain unchanged. Exact source/device binding and one-use signing preserve VR-DEVICE-001,
while strict local extraction and the closed request preserve VR-CODEX-001 and VR-CODEX-002.

Daily usage, exact body, nonce, device signature, source/device IDs, and key bytes remain transient
connector memory. The only new egress is the already documented `ConnectorSyncV1` body and five
authentication headers to the explicit origin. No new persistent field, log, metric, cache,
analytics event, export, or browser storage is added. The native credential record format does not
change.

Residual risk remains substantial: the same unlocked local user or platform malware can use the
credential; a locally installed file matching the reviewed hash is not a signed Vibe Racing release;
only Windows x86_64 admission has local evidence; system time can be wrong; and no deployed
edge/Ingest/database or real-user result is proved. An ambiguous network failure may cause the user
to run a later command with a fresh sync ID, but the connector never retries a private signed body
silently.

Affected invariants are VR-PUBLIC-001, VR-CODEX-001, VR-CODEX-002, VR-DEVICE-001, VR-INGEST-001, and
VR-RELEASE-001. Primary attacker stories are VR-ABUSE-CONNECTOR-LOCAL,
VR-ABUSE-RELEASE-SUBSTITUTION, VR-ABUSE-DEVICE-KEY-THEFT, VR-ABUSE-USAGE-FORGERY, and
VR-ABUSE-RESOURCE-EXHAUSTION.

## Alternatives considered

- **Run `codex` from `PATH`:** rejected because PATH and wrapper resolution can silently select a
  different executable or version.
- **Accept any absolute executable:** rejected because an absolute path says nothing about artifact
  identity and reopens local data exfiltration.
- **Add discovery, scheduling, packaging, and multi-platform admission now:** deferred because none
  is required for one explicit development sync and each expands the release boundary.
- **Retry the POST automatically:** rejected because a lost acknowledgement makes automatic replay
  behavior invisible to the user; the first command sends once.
- **Generate edge-origin proof in the connector:** rejected because the edge key must never enter a
  user device and direct-origin denial remains a deployment responsibility.

## Migration and rollback

The candidate evidence advances from `0.144.4` to schema-compatible `0.144.5`; the exact signed test
vector advances with the emitted version. No database migration, public request schema, credential
record, keyring account, server route, or stored user data changes. Rollback removes the `sync`
command and `0.144.5` admission while leaving `connect`, pairing records, Ingest, and the language-
neutral contracts intact. A released replacement must use a new reviewed connector release rather
than silently widening these constants.

## Verification

Repository evidence covers:

- exact artifact path, size, digest, manifest drift, and launch while the handle remains held;
- fixed CLI arguments and refusal before an active connection;
- canonical leap-day UTC formatting plus lower/upper contract boundaries;
- active-record source/device/key composition, fresh request grammar, and the updated shared
  cross-language body/digest/signature vector;
- a real loopback HTTP exchange proving the exact method, path, body, five device headers, absence
  of origin headers, and closed acknowledgement; and
- the existing hostile App Server framing, output, timeout, cleanup, parser, signer, Ingest, and
  public-data gates.

Tests use synthetic usage, keys, records, and loopback responses. They do not execute a local Codex
account, open a real user credential, call a deployed service, or establish release support.

## References

- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [Compatibility policy](../architecture/COMPATIBILITY_POLICY.md)
- [Codex compatibility matrix](../reference/codex-compatibility.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
- [Connector boundary](../../crates/connector/README.md)
- [Current Usage Sync contract](../../contracts/v1/usage-sync.schema.json)
- [Current Usage Sync authentication policy](../../contracts/v1/connector-usage-sync-authentication.json)
- [Current single-protocol decision](0075-single-unreleased-usage-sync-protocol.md)
- [ADR 0023](0023-bounded-candidate-app-server-supervisor.md)
- [ADR 0024](0024-bounded-candidate-community-sync-composer.md)
- [ADR 0025](0025-bounded-candidate-device-signing-boundary.md)
- [ADR 0030](0030-bounded-connector-pairing-transport.md)
- [ADR 0051](0051-bounded-candidate-executable-discovery.md)
