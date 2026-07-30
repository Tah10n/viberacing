# Web workspace guidance

Read the root `AGENTS.md`, `apps/web/README.md`, accepted ADRs, security invariants, threat/abuse
models, privacy map, and implementation ledger before changing this workspace.

## Scope

`apps/web` owns:

- the database-free synthetic public experience;
- three public snapshot GET routes and their narrow PostgreSQL adapter;
- enrollment, login, passkeys, recovery, and private account applications;
- batch connector pairing transport/browser approval;
- CarRecipe browser and device proposal boundaries; and
- Web-specific accessibility, configuration, admission, and process evidence.

It does not own Edge/Ingest usage submission, Jobs scheduling, migrations, provider readers,
production credentials, deployment, or a generic database API.

## Non-negotiable boundaries

- Keep the synthetic home usable without protected configuration or a database. Mark synthetic
  fallback explicitly.
- Public routes may read only immutable published snapshots. Never aggregate raw observations or
  account/day totals on a request.
- Preserve exact decimal strings and `bigint`; never convert token totals through JavaScript
  `Number`.
- Rank depends only on exact weekly total. Equal totals share rank; stable display position is not a
  tie breaker.
- Never expose raw usage, AgentAccount/device/installation IDs, account keys, private labels, exact
  receipt times, OAuth/access tokens, WebAuthn material, recovery codes, database details, or
  internal errors in a public response.
- Preserve same-origin policy, closed paths/queries/bodies, bounded deadlines, four-call no-queue
  admission, and generic problem serialization.
- Construct protected configuration and pools only after the relevant exact capability decision.
  Disabled modules must perform no parsing, admission, secret access, or database work.

## Capability decisions

- Public snapshot GET modules: exact `VIBERACING_PUBLIC_SNAPSHOTS_ENABLED=true`.
- Invite/OAuth/initial-passkey modules: exact `VIBERACING_ENROLLMENT_ENABLED=true`.
- Optional invite policy: exact `VIBERACING_INVITE_GATE_ENABLED=true`.
- Pairing start/poll, `/connect`, review, options, and verify modules: exact
  `VIBERACING_PAIRING_ENABLED=true`.
- Browser proposal creation/approval and connector proposal ingress: exact
  `VIBERACING_CAR_PROPOSALS_ENABLED=true`.

There is no source-creation decision or source-era compatibility path. Returning login, recovery,
required deletion lock-down, and exact rejection must remain available according to their separate
authority rather than being accidentally coupled to enrollment or mutation gates.

Each decision is resolved once per module evaluation. Accept only the own exact string property;
missing, inherited, accessor, non-string, alternate case, whitespace, or read failure closes it.

## Identity and authority

- Key profiles only by immutable positive GitHub numeric ID. Handle/email/display name are mutable
  metadata, never identity or ownership.
- OAuth state/PKCE and WebAuthn challenges remain purpose-separated and single-use.
- OAuth tokens are discarded after identity resolution and grant no usage-sync authority.
- A normal session appears only after initial passkey registration or replacement-passkey recovery
  completion.
- Restricted recovery authority lasts at most five minutes and cannot perform normal account work.
- Critical actions consume a fresh action-bound passkey assertion with exact target/digest binding.
- Derive owned resources from the session. Do not accept caller-selected profile IDs.
- Profile deletion immediately hides the profile and revokes every browser/connector authority class
  before returning the pending state.

## AgentAccount and pairing

- AgentAccount is the counted domain. Installation and device multiplicity must not duplicate usage.
- Seal provider, account key, reader, accounting revision, scope, and trust on the candidate
  manifest and revalidate them in PostgreSQL.
- Private labels never establish account identity.
- Batch review must show every candidate and allow only create, owned-same-provider attach, or skip.
- One fresh passkey settles the exact ordered decision batch atomically; no partial approval.
- Polling must prove possession of each pending account key.
- Keep fallback-code and poll verifiers distinct, bounded, rotation-aware, and non-reflective.
- Preserve global plus bucketed PostgreSQL admission for anonymous start/poll.
- A device key acts only for its bound AgentAccount and cannot mutate profile/security/other-device
  state.

## Database adapter

- Use only the narrow `viberacing_web` role through reviewed procedures.
- Never grant or query private tables directly from runtime code.
- Enforce loopback-only cleartext in development/test; otherwise require verified TLS to a DNS
  hostname.
- Probe login identity and TLS before role assumption.
- Use bounded pools and deadlines; reset role/session state before reuse and on every error path.
- Do not log protected configuration, SQL, identifiers, parameters, cookies, assertions, public
  keys, or raw database errors.

## Frontend and accessibility

- Preserve semantic headings, landmarks, table/list relationships, labels, live-region discipline,
  keyboard-visible focus, forced-colors, and reduced-motion behavior.
- Treat the pixel race as optional decoration. Meaningful leaderboard information must remain in
  accessible HTML before the canvas loads or when it fails.
- Keep EN/RU copy aligned, including Community/unverified and tokenizer-difference disclosure.
- Do not add remote fonts, analytics, trackers, uncontrolled image hosts, or client persistence of
  protected/account data.

## Verification

For any Web change, run the focused lint, typecheck, and tests. Add production build, PostgreSQL
integration, standalone-process, visual, or root release gates in proportion to the surface changed:

```text
pnpm run lint:web
pnpm run typecheck:web
pnpm run test:web:coverage
pnpm run build:web
pnpm run test:web:postgres-integration
pnpm run test:web:standalone
```

Tests must exercise production modules, negative/failure paths, disabled-before-work behavior, and
resource cleanup. Use synthetic identities, keys, usage, and screenshots only. Do not turn a local
green gate into a claim about OAuth, authenticators, hosted TLS, provider data, capacity, or
deployment.

Update `apps/web/README.md`, public contracts, privacy/security docs, ADRs, and
`docs/IMPLEMENTATION_STATUS.md` whenever the externally visible surface or evidence boundary
changes.
