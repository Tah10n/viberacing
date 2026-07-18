# ADR 0038: Bounded device CarRecipe proposal ingress

- Status: Accepted (local Web/Auth, database, and connector slice; deployment pending)
- Date: 2026-07-17
- Decision owners: Contracts, Web/Auth, Database, Connector, and Security
- Supersedes: None
- Superseded by: None

## Context

ADR 0035 proves that a signed-in browser can create, inspect, approve, or reject one private
`CarRecipeV1` proposal. Phase 4 also needs a connector-facing proposal origin without turning a
source-bound device credential into profile administration. Reusing Community Ingest would merge
service and database capabilities, while accepting a prompt or arbitrary JSON would widen the
privacy and content boundary.

## Decision

Web/Auth owns `POST /v1/connector/cars/proposals`. The request body is exactly `CarRecipeV1`, at
most 512 bytes, with no query, CORS permission, cookie authority, prompt, conversation, profile ID,
source ID, proposal ID, URL, file, markup, or arbitrary color. A versioned authentication policy
binds the exact raw body digest, method, path, public device ID, fresh 16-byte nonce, and canonical
millisecond UTC timestamp into a domain-separated Ed25519 message. A shared synthetic vector is
verified independently by Rust and Web.

The Web boundary admits at most four in-flight calls without a queue, preserves the exact raw body,
rejects malformed headers and parser budgets, validates the generated recipe contract, uses strict
Ed25519 semantics, and performs a dummy-key verification for an unknown device. It returns only a
generic versioned acknowledgement or the shared problem contract. Web overwrites every owned
body/signature/public-key/nonce/message byte-buffer copy after settlement; Rust does the same for
owned proposal buffers on drop. Platform-managed header strings are not logged or persisted.

Revision 0028 gives only the probed read-write Web role two fixed procedures. The first returns a
minimal key ID/public-key tuple only for an active device on an active source whose profile is
`active` or `hidden`. The second rechecks and locks profile, source, and device in that order,
consumes a domain-separated nonce digest with a seven-minute expiry, and inserts or replaces the
profile's single pending exact recipe. The server owns the proposal UUID, receipt time, and 24-hour
expiry. Ingest, Jobs, Admin, `PUBLIC`, direct tables, paused/quarantined/unlinked sources, revoked
devices, mismatched keys, stale requests, future-skewed requests, and nonce replay are denied.

The fixed Rust `propose-car` command accepts only the seven enum flags and a canonical integer seed,
loads one active source-bound key from the existing native credential record, creates fresh time and
nonce material, sends one signed request without retry through the proxy-free, redirect-free HTTP
agent, validates the closed acknowledgement, and prints no identifier or recipe data.

ADR 0039 adds a local Agent Skill above this command. It selects only those exact fields, validates
explicit origin/label values under a narrower shell-safe grammar, invokes the command once, and
receives no extra connector or service authority.

This capability can only create or replace a pending proposal. It cannot read proposal state,
approve, reject, activate, publish, hide, delete, pair, revoke, recover, or administer a profile.
Approval and rejection remain exact possessed-browser-session actions under ADR 0035.

## Security and privacy consequences

- This composes `VR-CAR-001`, `VR-AUTH-002`, `VR-ABUSE-CAR-INJECTION`, `VR-ABUSE-DEVICE-KEY-THEFT`,
  and `VR-ABUSE-DEVICE-ESCALATION` without widening the Ingest role.
- A stolen active device key can replace the bound profile's pending presentation proposal and
  consume request capacity, but cannot activate it; explicit browser review remains mandatory.
- The retained proposal contains only the already-mapped enum recipe and server metadata. The raw
  signed envelope is transient; only the domain-separated nonce digest is retained for seven minutes
  in the existing replay store.
- Hidden profiles may receive a private proposal, while paused, quarantined, unlinked, or revoked
  authority cannot. No proposal becomes public until browser approval, and only the existing active
  recipe projection can publish it.
- This local evidence does not prove edge rate policy, live Web/database credentials, distributed
  admission, monitoring, capacity, cleanup scheduling, packaging, release, or deployment.

## Alternatives considered

- **Route through Ingest:** rejected because usage submission and profile presentation proposals
  require different service/database capabilities and failure policy.
- **Let the device approve or activate:** rejected because device authority is source-bound and
  cannot administer the profile.
- **Send prompts or conversation context:** rejected because the exact recipe fully represents the
  product result and there is no collection purpose for conversation data.
- **Return proposal identity:** rejected because the connector has no decision authority and needs
  only a generic settled acknowledgement.
- **Retry automatically:** rejected because a one-shot command plus replay consumption has a smaller
  duplicate-load and ambiguity surface; the user can review account state before another command.

## Migration and rollback

Revision 0028 is additive. An application rollback can remove the route and command while both
functions remain inaccessible to every role except Web. A forward database migration can revoke and
drop the two functions after callers are removed. Existing pending recipes remain governed by ADRs
0035 and 0036; enum meaning is never reinterpreted in place.

## Verification

- Contract generation and 49 checker regressions pin the operation, policy, parser budgets, generic
  result, implementation evidence, and shared vector.
- Web tests cover exact signature agreement, freshness boundaries, unknown-device dummy work,
  malformed input, enum validation, dependency containment, no-queue admission, request/response
  correlation, copied-secret clearing, fixed pool calls, and closed route methods.
- Rust tests cover the same body/message/signature vector, exact CLI flags, device-key binding, one
  proxy-free/redirect-free POST, closed acknowledgement, and non-reflective output.
- The isolated PostgreSQL suite covers active/hidden authority, proposal replacement without active
  mutation, browser visibility, replay, key/device mismatch, paused-source denial, role denial, and
  an observed race in which source pause serializes ahead of a queued proposal.

## References

- [ADR 0003](0003-identity-step-up-and-device-authority.md)
- [ADR 0005](0005-enum-only-car-recipe.md)
- [ADR 0035](0035-bounded-session-car-recipe-proposal.md)
- [CarRecipe reference](../reference/car-recipe.md)
- [Authentication policy](../../contracts/v1/connector-car-proposal-authentication.json)
- [Migration 0028](../../database/migrations/0028_connector_car_proposal_ingress.sql)
- [ADR 0039](0039-bounded-agent-car-proposal-orchestration.md)
- [Security invariants](../architecture/SECURITY_INVARIANTS.md)
