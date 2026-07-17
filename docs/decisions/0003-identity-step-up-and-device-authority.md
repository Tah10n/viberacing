# ADR 0003: GitHub identity, passkey step-up, and source-bound device authority

- Status: Accepted (identity, passkey, recovery, pairing, and source/device DB slices implemented)
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

Login is discoverable-credential compatible: its short-lived challenge has no profile authority, and
the database derives the profile only from an active exact credential after application
verification. Sessions record the authenticating passkey and preserve that provenance across
rotation. Critical step-up challenges separately record the exact verifying passkey. A profile may
retain at most 32 passkey records and 32 active unexpired browser sessions as public database safety
ceilings; deployment controls may be lower.

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

Removing a passkey is terminal and cannot remove the profile's last active credential. It revokes
browser sessions authenticated by that key and cancels its unused ceremonies and approved but not
activated device authority. Activated connectors remain independent credentials that the user can
inspect and revoke explicitly. Recovery uses a separate restricted authority and does not mint a
normal session before a replacement passkey is established.

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

Current database evidence covers exact session-verifier possession, composite session/profile
challenge binding, bounded expiry, challenge and action replay, atomic invite redemption, initial
passkey activation, session rotation/revocation, cross-profile deletion denial, failed-operation
rollback, immediate authority revoke, least-privilege role grants, exact pairing/source-choice
binding, post-approval competing-profile denial, poll possession, single activation, and immutable
device binding. This database evidence alone does not prove OAuth, cookies, CSRF, WebAuthn
cryptographic verification, or Ed25519 proof verification in an application service.

The local Web/Auth application now adds injected evidence for invite enrollment, state plus S256
PKCE, token minimization, purpose-separated cookies, initial WebAuthn registration, and returning
discoverable-credential login. Login options retain only a profile-free encrypted challenge and
create no database state; after exact RP ID/origin/challenge/type/user-verification/signature
checks, one atomic database call advances credential state and mints a passkey-provenance session.
This does not prove a live OAuth app, authenticator, database login, edge policy, or deployment.

An additional identity concurrency suite holds each authoritative row until both tagged contenders
are visible in its transitive blocker chain. It proves one winner for shared invite enrollment,
initial-passkey challenge consumption, and session rotation, plus deletion dominance over a
concurrent rotation without a losing profile, session, or browser authority surviving. This adds
evidence for the existing procedure boundary; it introduces no new database capability or
application claim.

Revision 0003 also has deterministic cross-connection evidence: two valid profile approvals wait
behind one locked pairing and produce exactly one winner; separate same-profile races prove the
source and live-device ceilings cannot be crossed by concurrent approvals. The runner tags every
session and releases the holder only after every contender appears in its transitive blocker chain.

Revision 0004 adds session-derived private source/device inventory, immediate owned-device revoke,
and fresh consumed source-bound step-up claims for reactivation and unlink. It proves cross-profile
ID denial, replay denial, quarantine separation, stale challenge/approval invalidation, atomic audit
failure rollback, recursive revoke on unlink, and protective outcomes under concurrent approval or
activation. It still relies on a future application service to verify the WebAuthn ceremony before
challenge consumption.

The local Web/Auth account slice now consumes the exact inventory and immediate-revoke boundary. It
derives authority only from the possessed session, exposes at most 32 sources and 64 active devices
with day-rounded metadata, submits only the selected opaque device ID, and returns generic failures.
Revision 0016 preserves those protective controls while a profile is hidden without adding a schema
field, role, or broader capability. Revision 0017 similarly preserves pause and reactivation while
hidden. The application sends no raw source ID to HTML: a 15-minute encrypted session-bound token
selects the source. Pause is immediate; reactivation requires a fresh required-UV assertion bound to
the session, source, RP ID, and origin before one atomic consume/reactivate statement. Source unlink
now uses a distinct fresh context and one atomic consume/unlink statement. It accepts only an
active, paused, or quarantined owned source, is terminal, revokes every active source device, and
preserves hidden visibility.

Revision 0019 reuses that possessed-session authority for a read-only private account score view.
Only Web can request one bounded Monday's existing derived season summary and seven daily scores;
hidden profiles return no score, and raw usage or private identifiers are not exposed. The local
server render combines this with visibility in one checkout and adds no browser fetch or storage.

Revision 0005 adds credential-derived passkey login, session and step-up provenance, private
multi-passkey inventory, bounded add/revoke, terminal revoke, last-key protection, monotonic stored
sign state, and atomic rollback on audit/session conflicts. Two observed blocker-chain races prove a
single login challenge has one winner and revocation leaves no active browser or pending pairing
authority for the removed credential under concurrent login. The database returns only minimal
verification material and still relies on Web/Auth for exact RP ID, origin, challenge, context,
signature, and user-verification checks.

The local Web/Auth account slice now supplies that application evidence for revoking an owned
non-current active passkey. It revalidates the session-derived inventory, binds one five-minute
challenge to the exact session, target, RP, and origin, verifies a fresh user-verified assertion,
and uses one atomic consume-and-revoke query. Current, last, foreign, malformed, and replayed
attempts fail closed. The same account slice now validates and seals a backup-key label, verifies
independent existing-key assertion and registration challenges, and uses one atomic consume-and-add
query under the existing lifetime cap. The other critical-action step-up paths remain separate.

Revision 0006 adds passkey-protected recovery-code regeneration, immediate used-PHC scrub, a single
ten-minute recovery-only registration authority, deletion revoke, and atomic replacement-passkey
completion. Three observed blocker-chain races prove one-code/one-authority use, fresh rotation
dominates old-code start, and completion leaves only the replacement passkey/session active under a
concurrent old-passkey login. [ADR 0007](0007-restricted-recovery-authority.md) defines the narrow
authority and remaining application boundary.

Revision 0021 and the local `/connect` application now supply the browser pairing step for an
explicitly selected new or active existing opaque source. Every admitted code lookup first
increments a bounded window on the exact active session, then probes the primary and optional
rotation verifier in one closed function. The UI renders only bounded pending-device metadata, the
full public-key fingerprint, active source ordinals/device labels, and encrypted session-bound
source controls. A separate fresh user-verified assertion is bound to session, pairing, exact source
choice and ID, RP, and origin before one atomic consume-and-approve statement rechecks ownership and
active state. Unit, component, HTTP, fixed-query, and isolated PostgreSQL tests cover malformed
code, opaque existing-source selection and tamper, cross-origin and duplicate-cookie denial, key
rotation, attempt exhaustion/reset, replay-resistant step-up, and first-winner settlement. The exact
local start/poll routes and native-store connector client now compose this synthetic journey, but
there is no live authenticator/database result, supported connector, trusted edge, or deployment
claim.

Remaining application and protocol evidence includes:

- Application WebAuthn transaction rendering and verification for remaining critical-action step-up,
  recovery Argon2id/pepper and generic-response behavior, and anonymous ceremony/recovery-lookup
  rate-limit and cleanup tests.
- Anonymous pairing-start attempt policy, operational connector proof/transport, live key rotation,
  scheduled bounded cleanup, and plaintext token log rejection.
- Scope matrix proving device credentials cannot manage profile, devices, invites, sources,
  recovery, deletion, or admin.
- Canonical-signature, body tamper, nonce, idempotency, cross-source, clock, and stolen-key tests.

## References

- [Data flow](../architecture/DATA_FLOW.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Restricted recovery authority](0007-restricted-recovery-authority.md)
- [Auth and device abuse cases](../security/ABUSE_CASES.md#pairing-device-and-connector-abuse)
