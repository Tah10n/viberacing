# ADR 0026: Bounded pairing possession proof

- Status: Accepted (pure signer/verifier kernels; local application added by ADR 0027)
- Date: 2026-07-15
- Decision owners: Web/Auth, Connector, Database, Security, Privacy, Compatibility, and Release
- Supersedes: None
- Superseded by: None

## Context

Revision 0003 deliberately separates pairing state from application cryptography. After browser
approval, `read_pairing_verification_material` returns only the exact pairing identifier, 32-byte
challenge, pending public key, and expiry selected by the presented poll verifier. The Web role may
call `activate_pairing` only after an application verifies possession, but no language-neutral
message, connector signer, or strict Web verifier existed. ADR 0025 signs later Community requests
only after a device is already source-bound and therefore cannot establish the pending key's
possession.

This slice must close the pure cryptographic agreement without implying that poll-token hashing,
anonymous HTTP admission, browser/passkey approval, a PostgreSQL adapter, atomic application
composition, device-ID issuance, key generation/storage, or an operational connector exists.

## Decision

Add `connector-pairing-authentication.json` as a manifest-inventoried version 1 policy. The exact
UTF-8 message has four LF-separated fields and no trailing separator:

1. `viberacing-pairing-possession-v1`;
2. the canonical lower-case version-4 pairing identifier;
3. the exact 32-byte server challenge as unpadded base64url; and
4. the exact 32-byte pending Ed25519 public key as unpadded base64url.

The public key is included in addition to being the verification key so the signed bytes state the
immutable key binding explicitly. The poll token is not copied into the message: it remains a
separately presented, one-time bearer value whose exact keyed-verifier lookup selects the approved
transaction and verification material. The policy makes all four activation preconditions explicit:
exact poll match, browser-approved transaction, unexpired pending key, and strict possession proof.

Add `CandidatePairingPossessionV1Signer` to the non-publishable Rust connector library. It consumes
an inaccessible `PendingDevicePairingSigningKey` and inaccessible `ReviewedPairingChallenge`,
revalidates the canonical identifier, derives the public key from the consumed private key, signs
only the exact message, overwrites temporary challenge/message encodings, and returns only the
pairing ID plus canonical signature. It does not approve or activate the transaction.

Add one server-only pure Web verifier. It accepts `unknown`, admits only a plain object with exactly
`pairingId`, `pairingChallenge`, and `publicKey`, requires exact native byte views and lengths,
copies caller-owned bytes before asynchronous work, admits only canonical 64-byte base64url
signatures, reconstructs the same message, and calls `@noble/ed25519@3.1.0` with `zip215: false`.
Every malformed, exceptional, invalid-point, or signature failure returns only `false`; copied
buffers are overwritten after settlement. The verifier performs no lookup, timing equalization, rate
limiting, audit, HTTP translation, or database mutation.

The contract manifest now inventories both authentication policies by file and protocol ID. Policy
bytes contribute to the generated-contract digest even when no HTTP operation references the pairing
policy yet. One synthetic vector uses the same deterministic public key as the Community sync vector
and contains only a fake transaction, challenge, public key, message, and signature.

Web adds the already pinned `@noble/ed25519@3.1.0` as a direct runtime declaration, with lint
confinement to the one server-only verifier. This changes no npm version or transitive record. The
dependency remains necessary because the reviewed native Node verifier accepted the all-zero
key/signature case; the strict Noble regression is retained in both application boundaries.

## Security and privacy consequences

The proof is domain-separated and binds the exact transaction, server challenge, and immutable
pending public key. A signature for another challenge, transaction, key, protocol, or trailing-LF
message fails. The Web verifier rejects accessors, proxies that throw, inherited/extra fields,
derived byte views, wrong lengths, non-canonical encodings, small-order zero material, and
caller-side mutation after invocation.

This kernel alone does not make activation safe. Revision 0003 cannot prove that its caller ran the
application verifier, and the Web database role still has procedure authority. A future pairing
application boundary must resolve and rate-limit the poll token, obtain only the matching approved
material, verify the proof, generate bounded server-owned identifiers/audit references, and call
activation through one closed composition. No route may expose this kernel until that control flow,
generic timing/error behavior, and live-role boundary are reviewed and tested.

ADR 0027 later implements that transport-free local composition with a protected keyed poll
verifier, fixed database adapter, strict proof ordering, server-owned identifiers, and bounded local
admission/timing. Pairing start, browser/WebAuthn approval, external HTTP policy, live-role
evidence, and distributed client-rate controls remain pending.

The challenge, message, signature, public key, and pairing ID are existing Security data classes.
They remain transient copied memory in the new kernels. There is no new cookie, log, metric, cache,
analytics event, database field, export, network destination, retention rule, real key, or bearer
token. Buffer overwriting is defense in depth and not a guarantee about runtime or compiler copies.

Affected invariants are VR-DEVICE-001, VR-PUBLIC-001, VR-CODEX-002, and VR-RELEASE-001. Primary
attacker stories are VR-ABUSE-PAIRING-GUESS, VR-ABUSE-DEVICE-KEY-THEFT, VR-ABUSE-DEVICE-ESCALATION,
VR-ABUSE-CONNECTOR-LOCAL, and VR-ABUSE-RESOURCE-EXHAUSTION.

## Alternatives considered

- **Sign only the raw challenge:** rejected because it lacks protocol and transaction domain
  separation and leaves the immutable public-key binding implicit.
- **Include the plaintext poll token in the signed message:** rejected because exact poll lookup is
  an independent activation precondition and copying the bearer value into another cryptographic
  surface is unnecessary.
- **Let the connector submit an arbitrary signed message:** rejected because it would create a
  generic signing oracle and permit server/client serialization drift.
- **Use Node's native Ed25519 verifier:** rejected because the existing all-zero key/signature probe
  demonstrated semantics weaker than VR-DEVICE-001 requires.
- **Call `activate_pairing` from the verifier:** rejected because token admission, database access,
  audit/ID generation, atomic settlement, and HTTP policy require a separately reviewed application
  boundary.
- **Generate or store the device key here:** rejected because operating-system custody, entropy,
  fallback, lifecycle, and platform evidence are independent release-critical decisions.

## Migration and rollback

This change adds no database migration, route, environment variable, persistent field, network
destination, supported Codex row, executable, or release artifact. It adds one policy and vector,
one Rust module, one Web verifier and tests, one existing-package Web declaration, manifest policy
inventory, checker regressions, and this ADR. Rollback removes those files/declarations and restores
the prior generated digest; revision 0003 pairing state remains unchanged and must still not be
exposed without an application verifier.

## Verification

Five Rust unit cases prove the exact vector, policy constants, strict verification, shared sync key,
canonical identifier rejection, and challenge/key binding. Seven Node-environment Web cases prove
the same vector, exact native input shape, changed transaction/challenge/key/signature rejection,
zero-key/zero-signature denial, malformed/proxy/accessor/encoding rejection, copy-before-await and
early-rejection zeroization behavior, and policy constants. The contract checker inventories both
policies, validates the exact pairing policy/vector, includes policies in generated drift, and adds
semantic-drift regressions.

Focused Rust tests, Web lint/type/tests, generated-contract checks, dependency inventory, and the
root verification gate pass before commit. None of this evidence pairs or activates a real device,
handles a poll token, verifies WebAuthn, opens an HTTP route, uses a database login, stores a
private key, or supports/releases a connector.

## References

- [ADR 0003](0003-identity-step-up-and-device-authority.md)
- [ADR 0025](0025-bounded-candidate-device-signing-boundary.md)
- [Pairing authentication policy](../../contracts/v1/connector-pairing-authentication.json)
- [Shared synthetic pairing vector](../../contracts/v1/connector-pairing-possession.test-vector.json)
- [Pairing database capability](../../database/migrations/0003_pairing_capabilities.sql)
- [Project plan](../PROJECT_PLAN.md)
- [Implementation status](../IMPLEMENTATION_STATUS.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Abuse cases](../security/ABUSE_CASES.md)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
- [Dependency policy](../security/DEPENDENCY_POLICY.md)
