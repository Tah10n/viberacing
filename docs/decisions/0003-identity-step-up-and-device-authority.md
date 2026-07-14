# ADR 0003: GitHub identity, passkey step-up, and source-bound device authority

- Status: Accepted (storage foundation implemented; application flows pending)
- Date: 2026-07-14
- Decision owners: Web/Auth, Pairing, Ingest, and Database
- Supersedes: None
- Superseded by: None

## Context

The product needs one public profile identity, phishing-resistant approval for destructive or
durable security changes, and unattended local synchronization. Reusing one credential for all three
would let a stolen connector key administer a profile or let a normal browser session silently add a
device.

GitHub provides a stable upstream numeric user ID for profile binding, but GitHub membership alone
is not sufficient approval for device binding, recovery changes, source unlink, or deletion.

## Decision

Use minimal GitHub OAuth with state, PKCE, exact redirect matching, one-time code handling, session
rotation, and immediate access-token disposal after resolving the numeric user ID. Enforce one Vibe
Racing profile per resolved GitHub ID.

Require at least one passkey after enrollment and fresh user-verified WebAuthn step-up for device
approval, passkey/recovery changes, source unlink/reactivation, and profile deletion. Exact RP ID
and origins are environment-specific. Challenges are high-entropy, one-time, short-lived, and bound
to the displayed transaction.

Give each connector an Ed25519 device key stored in the operating-system credential store and bound
to exactly one source. Device requests are canonical signed messages, not long-lived bearer tokens.
Device authority can submit Community sync for its source and nothing else.

Bind the pending public key immutably when pairing starts. Return a high-entropy, short-lived poll
token and transaction challenge once, persist only a keyed token verifier, and never log plaintext.
The token can poll but cannot approve or activate a device. Activation requires the authenticated
browser's fresh passkey approval of the displayed transaction plus an Ed25519 proof over the bound
challenge.

## Security and privacy consequences

This separates profile identity, human step-up, and unattended device authority. A stolen device key
cannot manage security state; a stolen session cannot silently complete critical actions without a
fresh passkey. Recovery remains a high-risk path and must not downgrade into email or support-based
social engineering.

Attestation is not required in MVP, avoiding a device fingerprint database. WebAuthn sign counters
are risk signals, not universal clone proof. Friendly device labels are private bounded text and
should default to non-identifying values.

## Alternatives considered

- **GitHub OAuth only:** rejected because a session compromise could add durable devices or delete a
  profile without independent step-up.
- **Passkey-only identity:** possible later, but complicates invite/profile identity and public
  GitHub opt-in during bootstrap.
- **One bearer token per connector:** rejected because bearer scope is easy to broaden accidentally
  and offers weaker message/replay binding.
- **Device certificate with profile-admin scope:** rejected because unattended sync does not need
  that authority.
- **Email recovery:** rejected because account email is not collected and support recovery is highly
  exposed to social engineering.

## Migration and rollback

Enrollment is incomplete until a passkey exists. If passkey service is impaired, pause enrollment
and critical changes rather than bypass user verification. Existing public reads and already valid
bounded device sync may remain independently available under incident policy.

Device signing-format changes use an explicit version and bounded dual-verification window. A
compromised format/key triggers device revoke/rotation, not promotion to a broader credential.

## Verification

- OAuth state, PKCE, exact callback, code replay, token disposal, user-ID uniqueness, and session
  fixation tests.
- WebAuthn RP/origin, challenge replay/expiry, transaction binding, user verification, multiple
  passkey, recovery, and fresh-step-up tests.
- Pairing code expiry/guess/race, displayed transaction, source choice, possession, revoke, and
  rotation tests, including plaintext poll-token storage/log rejection and immutable-key tests.
- Scope matrix proving device credentials cannot manage profile, devices, invites, sources,
  recovery, deletion, or admin.
- Canonical-signature, body tamper, nonce, idempotency, cross-source, clock, and stolen-key tests.

## References

- [Data flow](../architecture/DATA_FLOW.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Auth and device abuse cases](../security/ABUSE_CASES.md#pairing-device-and-connector-abuse)
