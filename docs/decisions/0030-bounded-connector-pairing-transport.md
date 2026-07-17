# ADR 0030: Bounded connector pairing transport and native key custody

- Status: Accepted (local vertical slice implemented; deployment and release pending)
- Date: 2026-07-17
- Decision owners: Connector, Web/Auth, Database, Security, Privacy, and Operations
- Supersedes: None
- Superseded by: None

## Context

ADRs 0027 and 0028 implemented the transport-free pairing activation and start applications, while
the signed-in `/connect` flow supplied browser review and fresh-passkey approval. The repository
still had no public request/response contract, anonymous HTTP route, distributed start/poll limit,
connector key custody, or runnable client. That left the shortest useful device-connection journey
incomplete even though every internal step existed.

The missing slice handles bearer material and a device private key. It must therefore fail closed on
redirects, proxies, oversized or open JSON, credential-store failure, replay, process interruption,
and anonymous request floods. It must not expand into Codex discovery, usage upload, scheduling,
packaging, or a generic HTTP/credential framework.

## Decision

Version 1 adds four closed JSON Schemas and two exact operations:

- `POST /v1/connector/pairing/start`; and
- `POST /v1/connector/pairing/poll`.

Both accept only `application/json`, one canonical 16-byte unpadded-base64url
`x-viberacing-client-id`, a 1024-byte request, and the existing closed fields. Responses are at most
2048 bytes, revalidated before serialization, `no-store`, same-origin without CORS, and either the
exact success contract or the existing generic problem shape. The route constructs its shared
four-call transport service only after request framing and schema validation.

The client ID has rate-shaping authority only. Web/Auth immediately reduces it to a domain-separated
SHA-256 digest and clears the decoded copy. PostgreSQL receives the digest only to select one of 64
fixed buckets; it stores neither the ID nor digest. Revision 0022 preallocates one global row and 64
bucket rows for each of `start` and `poll`. One Web-only function locks global then bucket,
increments saturating counters, resets expired windows, and returns a boolean under a five-second
statement/lock deadline. Global limits remain effective when a client rotates IDs; bucket limits
cheaply shape one identifier without creating attacker-controlled rows. All six limits/windows are
mandatory deployment-private configuration.

The Rust binary supports one command only:

```text
viberacing-connector connect --origin <https-origin> --label <device-label>
```

It allows HTTPS origins and explicit loopback HTTP for local development, disables environment
proxies and redirects, uses platform certificate verification, fixes request paths and headers, and
bounds connect/global time, response headers, and response bodies. It generates an Ed25519 secret
and anonymous client ID from the operating-system CSPRNG. A versioned fixed-size record is stored
only through the native Windows Credential Manager, macOS Keychain, or Linux Secret Service; there
is no file or mock fallback on supported platforms.

The record has `prepared`, `pending`, and `active` states. The connector persists `prepared` before
the first network call, persists the returned token/challenge/code before displaying the code, and
persists the activated source/device binding before reporting success. A restart resumes pending
polling with the same key. Polling uses the exact ADR 0026 possession signature every two seconds
for at most eight local minutes, conservatively inside the server's nine-minute transaction. The
client prints only the approval URL, human code, generic progress, and success; it never prints the
private key, poll token, pairing challenge, source ID, or device ID.

This slice does not construct the candidate Codex process supervisor or Community sync composer. The
compatibility matrix stays empty, and no connector artifact is released or supported.

## Security and privacy consequences

The OS store becomes the only persistent private-key and poll-token sink. The record is keyed by a
domain-separated digest of canonical origin and device label and embeds a second origin digest, so
cross-origin or malformed records fail closed. Fixed binary fields avoid an extensible credential
document; decoded and encoded byte buffers are overwritten on ordinary drop/error paths where safe
Rust permits. Platform malware or the same unlocked local identity can still use or extract the
credential.

Anonymous client IDs are self-asserted and are not authentication, identity, fingerprinting, or a
substitute for edge capacity controls. Their raw values remain only in connector secure storage and
one request header. The database retains only 130 reusable aggregate counter rows with operation,
bucket, window start, and saturated count. No IP address, user agent, client digest, profile,
source, device, body, or credential is added to that table.

Residual risk remains: there is no real Web login/TLS/database integration result, deployed edge,
load/capacity evidence, monitoring, cross-platform execution matrix, signed package, updater,
credential migration/rotation command, connector uninstall flow, Codex admission, usage upload, or
release. Two concurrent local `connect` processes are not coordinated; the native store fails closed
but the user should run one connection attempt at a time. Crashes after server creation but before
local persistence can leave an authority-free pending row until the separate bounded cleanup runs.

Affected invariants are VR-DEVICE-001, VR-DATA-001, VR-NETWORK-001, and VR-ABUSE-001. Primary
attacker stories are VR-ABUSE-PAIRING-GUESS, VR-ABUSE-DEVICE-KEY-THEFT, VR-ABUSE-CONNECTOR-LOCAL,
VR-ABUSE-DATABASE-ROLE, and VR-ABUSE-RESOURCE-EXHAUSTION.

## Alternatives considered

- **Store the key in a local file:** rejected because permissions and backup behavior differ across
  platforms and create a plaintext fallback.
- **Generate the device key in the browser:** rejected because browser approval must not receive or
  retain connector device authority.
- **Create one database row per client ID:** rejected because an attacker could create unbounded
  persistent state. Fixed buckets bound storage independently of request cardinality.
- **Use only a client-ID bucket:** rejected because rotating the self-asserted value would bypass
  admission. Every request also consumes the operation-global row.
- **Use IP address as the current application identity:** rejected because this local route has no
  reviewed trusted-proxy/edge chain and the data class would require separate retention controls.
- **Follow system proxy and redirect settings:** rejected because a local or bearer-token request
  could leave the exact configured origin.
- **Add sync, Codex discovery, packaging, and device management together:** rejected because none is
  required to prove the connection journey and each has a separate trust boundary.

## Migration and rollback

Revision 0022 is forward-only and creates the fixed table/function/grant under the migration owner.
Before a shared environment, rollback discards the disposable database and removes the route and
client together. After release, repair requires a new reviewed migration; do not edit revision 0022.
Disabling the routes stops new admission but does not delete pending pairings or local native
credentials. A future uninstall or key-rotation design must explicitly remove or replace the one
origin/label record without weakening device revocation.

## Verification

Acceptance evidence recorded for this decision included:

- contract generation and drift checks for nine Schemas, three policies, and four operations;
- focused Web route/application/database tests for framing, duplicate/unknown fields, rate and
  unavailable decisions, retry-safe activation with a fresh possession proof, pool failure, and
  exact success serialization;
- real isolated PostgreSQL checks for the fixed 130-row matrix, forced RLS, global/bucket limits, ID
  rotation, changed-limit saturation, expiry reset, and runtime-role denials;
- Rust format/check/test/Clippy gates, including record corruption/origin separation, strict origin
  policy, closed responses, start-to-activation persistence, non-reflective output, and active-state
  restart; and
- a point-in-time OSV query across all 209 locked crates with no known advisory returned on
  2026-07-17, plus deterministic license/inventory checks.

At acceptance, the PostgreSQL suite proved 25 private tables, 25 observed lock-wait races, 12 direct
relation denials, and 34 cross-capability denials in an ephemeral database. HTTP/client tests use
injected services and synthetic material. They do not prove a live login, real browser approval,
cross-platform key-store behavior, Internet TLS path, capacity, release artifact, or deployment.

## References

- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
- [Connector boundary](../../crates/connector/README.md)
- [Web/Auth boundary](../../apps/web/README.md)
- [Database boundary](../../database/README.md)
- [Bounded pairing possession proof](0026-bounded-pairing-possession-proof.md)
- [Bounded pairing activation composition](0027-bounded-pairing-activation-composition.md)
- [Bounded pairing start composition](0028-bounded-pairing-start-composition.md)
- [Bounded pairing retention cleanup](0029-bounded-pairing-retention-cleanup.md)
