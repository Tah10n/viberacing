# ADR 0007: Restricted recovery authority and passkey replacement

- Status: Accepted (database capability, account-side rotation, and local recovery use implemented)
- Date: 2026-07-15
- Decision owners: Web/Auth, Database, Security, and Privacy
- Supersedes: None
- Superseded by: None

## Context

A user who loses every available passkey needs a way to regain profile access. Recovery material is
a high-value credential: treating it as an ordinary browser session would let a stolen code bypass
WebAuthn, approve devices, change security state, or remain useful after the user rotates codes.
Email and support recovery would also add personal data and a social-engineering path that the
project deliberately avoids.

The database cannot verify an Argon2id recovery secret or a WebAuthn response. Web/Auth must perform
those cryptographic checks, while the database must make the resulting authority narrow,
short-lived, one-time, race-safe, and unable to become a normal session before a replacement passkey
is established.

## Decision

Recovery-code generation and display belong to Web/Auth. A regenerated batch contains between 8 and
16 independently generated codes; the local application fixes its batch at ten. Plaintext is shown
once and never sent to logs, audit, support, or another service. The database stores an opaque
random selector and an Argon2id PHC verifier for each unused code. Deployment-specific work factors,
pepper material, response timing, and attempt thresholds remain protected configuration rather than
public repository values.

Regenerating a batch requires an active browser session plus a fresh, exact-passkey
`recovery_change` step-up. Replacement is atomic: the old batch is deleted and every active
authority derived from it is revoked before the new verifier batch is committed. Used verifier
material is immediately scrubbed.

Recovery proceeds through a separate authority:

1. Web/Auth receives the opaque selector and secret, obtains only that selector's unused PHC
   material, and performs bounded Argon2id verification with generic response shaping, local
   no-queue admission, and a configured minimum response floor. A distributed edge attempt policy
   remains required before deployment.
2. After successful verification, one database capability consumes and scrubs that code and creates
   a single authority for the profile. The authority expires within ten minutes and is bound to an
   exact WebAuthn registration challenge and context.
3. The authority is not a browser session and cannot call session-, profile-, source-, device-,
   invite-, deletion-, ingest-, job-, or admin-scoped capabilities.
4. After Web/Auth verifies the exact replacement WebAuthn registration, one transaction registers
   the new passkey, revokes every previous active passkey and browser session, cancels
   approved-but-not-activated pairings, clears profile-bound challenges and remaining recovery
   codes, completes the authority, and only then creates a passkey-bound normal session.

Activated connector keys remain separate source-bound authority. Recovery does not silently revoke
them because they cannot administer the profile and may be needed for continuity; the recovered user
must be shown those devices and can revoke them explicitly. Profile deletion revokes an active
recovery authority and cannot be reversed through recovery.

All protective recovery operations serialize on the profile row. Security timestamps are captured
after that lock is acquired, so code rotation dominates a concurrent old-code recovery start and
recovery completion dominates a concurrent old-passkey login regardless of transaction order.

Historical passkey rows preserve session and pairing provenance. Until a reviewed bounded cleanup
capability exists, recovery completion fails closed when the profile already has 32 lifetime passkey
records. The application must explain this availability condition without weakening the credential
boundary. Cleanup is a launch requirement, not permission to erase referenced history or raise the
public ceiling silently.

## Security and privacy consequences

The design prevents a recovery code from becoming durable general-purpose authority. It also makes
old-code rotation, one-time use, profile deletion, and replacement-passkey activation atomic at the
database boundary. Lookup reveals no profile ID, handle, email, source, device, session, or audit
record; known-used and unknown selectors both return no material.

The database retains only unused PHC verifier material, opaque identifiers, short-lived keyed
authority/challenge/context digests, lifecycle timestamps, and bounded audit references. Used PHCs
are scrubbed immediately; remaining codes are removed on replacement, successful recovery, or
profile deletion. The authority row remains only for a bounded security/audit need that must receive
a public retention and cleanup policy before launch.

Residual risks remain at the application boundary. A compromised Web/Auth service can falsely claim
that Argon2id or WebAuthn verification succeeded. Unbounded selector lookup can enable resource
exhaustion or offline guessing against returned PHCs. Timing, status, and body differences can
become an account-existence oracle. These risks require body limits, keyed/slow verification,
perimeter and service rate controls, generic responses, bounded cleanup, monitoring, and
application-level cryptographic tests before public deployment. The local endpoint now supplies the
bounded application checks, generic results, four-call no-queue admission, and configured floor; it
does not claim a distributed perimeter or operational monitoring.

Compromise of both all passkeys and all recovery material can still take over one profile. There is
no email or routine support override. Any future manually governed exceptional recovery is a new
authority design and requires a separate ADR, anti-social-engineering review, user communication,
and audit policy.

Affected invariants are VR-AUTH-001, VR-AUTH-002, VR-AUTH-003, VR-DEVICE-002, VR-DATA-001,
VR-DELETE-001, and VR-PUBLIC-001. The primary attacker stories are VR-ABUSE-AUTH-TAKEOVER and
VR-ABUSE-RECOVERY-ORACLE.

## Alternatives considered

- **Recovery code directly creates a session:** rejected because it bypasses replacement WebAuthn
  and grants broad authority to a single stolen secret.
- **Recovery code plus GitHub OAuth creates a session:** rejected because GitHub identity is not a
  fresh phishing-resistant security-change approval and does not narrow recovery authority.
- **Email recovery:** rejected because account email is prohibited data and email is a weaker
  recovery factor susceptible to phishing.
- **Routine support override:** rejected because it creates a high-risk social-engineering and
  insider path with no user-held proof.
- **Immediately revoke activated connectors during recovery:** rejected for MVP because connector
  keys already lack account authority; silent revocation harms continuity. The recovered inventory
  must instead make them visible and explicitly revocable.
- **Delete old passkey history to bypass the 32-record ceiling:** rejected because sessions and
  activated or historical pairing records retain credential provenance through foreign keys.

## Migration and rollback

Revision 0006 adds the forced-RLS `recovery_authorities` table, terminal state triggers, restricted
procedure grants, bounded audit enums, recovery-code verifier scrubbing, and deletion revocation.
Revision 0020 composes successful recovery completion with a minimal profile ID, handle, and locale
result for sealing the new session cookie. The local account application implements
passkey-protected batch rotation and one-time display plus exact-code Argon2id verification,
five-minute restricted-authority continuation, replacement WebAuthn verification, and normal-session
creation only after atomic completion. Tracked pepper, work-factor, and response-floor settings are
deliberately non-working placeholders rather than production values.

The migration is forward-only. Before a shared environment exists, a disposable database can be
rebuilt. After deployment, repair defects with a reviewed forward migration. An incident can disable
the application recovery endpoints while leaving passkey login and explicit device revoke available;
it must not convert restricted authority into a normal session or add a support bypass.

Rollback of an in-progress recovery means revoking its authority and requiring a different unused
code or an existing passkey. A failed completion transaction leaves the authority, old passkeys,
sessions, pairings, challenges, and recovery material in their pre-call state.

## Verification

Current PostgreSQL evidence covers:

- exact-session and exact-passkey step-up for 8-to-16-code batch replacement;
- cross-profile, malformed, oversized, replay, duplicate, and audit/constraint rollback failures;
- minimal profile-free PHC lookup, immediate used-verifier scrub, one-code/one-authority use, exact
  authority/challenge/context binding, expiry, terminal state, and deletion revoke;
- atomic replacement-passkey/session creation with old passkey/session revoke, stale challenge and
  approved-pairing cancellation, recovery-code deletion, and activated-device preservation;
- fail-closed behavior at the 32-lifetime-passkey provenance ceiling;
- role isolation, including no recovery capability for Ingest, Jobs, Admin, device credentials, or
  `PUBLIC`; and
- observed cross-connection races for one recovery-code winner, code rotation versus old-code start,
  and completion versus old-passkey login.

Local Web/Auth evidence additionally covers ten-code generation through Node's bounded Argon2id
path, a distinct protected pepper, exact work-factor/configuration parsing, fresh
session/profile/RP/origin-bound WebAuthn verification, atomic challenge consumption and batch
replacement, narrow no-store cookies/responses, one-time EN/RU display,
malformed/replay/cross-session denial, and the fixed database adapter calls. Recovery-use tests also
cover exact code parsing, matching and dummy Argon2id work, generic bounded HTTP decisions, the
configured response floor, purpose-separated cookies, exact replacement registration, no database
completion after failed WebAuthn, and minimal post-commit profile mapping. They use synthetic
secrets, authenticator responses, and database results only.

ADR 0032 now supplies bounded cleanup for expired challenges and terminal recovery authority. The
repository still lacks distributed/edge anonymous attempt controls, cleanup scheduling,
notifications, production secrets and timing values, live authenticator/database integration,
monitoring, and hosted operational evidence. Recovery sign-in is locally implemented but not
launch-ready until those controls are implemented and tested.

## References

- [Identity and device authority](0003-identity-step-up-and-device-authority.md)
- [Data flow](../architecture/DATA_FLOW.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
- [Threat model](../security/THREAT_MODEL.md)
- [Bounded authentication retention cleanup](0032-bounded-auth-retention-cleanup.md)
- [Authentication takeover abuse](../security/ABUSE_CASES.md#vr-abuse-auth-takeover-oauth-session-passkey-or-recovery-abuse)
- [Recovery oracle abuse](../security/ABUSE_CASES.md#vr-abuse-recovery-oracle-recovery-enumeration-replay-or-authority-expansion)
- [Privacy data map](../security/PRIVACY_DATA_MAP.md)
- [Database capability boundary](../../database/README.md)
