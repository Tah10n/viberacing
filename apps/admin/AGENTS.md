# Admin workspace agent guidance

Read the root `AGENTS.md`, this directory's `README.md`, `docs/PROJECT_PLAN.md`, the current
implementation status, database capability documentation, security invariants, abuse cases, privacy
data map, ADR 0066, ADR 0067, and the dependency policy before editing this workspace. The root
public-data, dependency, documentation, and staged-review rules all apply.

## Non-negotiable boundaries

- Keep this workspace transport-free. It has no HTTP listener, page, CLI, process entry point,
  complete authorization implementation, WebAuthn verifier, external audit backend, or deployable
  host. ADR 0067 adds only the bounded local Cloudflare Access assertion and individual-membership
  prerequisite.
- Preserve the exact Access boundary: header assertion only, local one-or-two-key RS256 JWKS
  snapshot, exact team issuer and single audience, human application token, at-most-one-hour token,
  opaque non-email subject, canonical 128-bit `adm_` mapping, second non-regressing clock read, and
  redacted output. Reject service tokens, email identity, unknown/duplicate members, caller-built
  config, remote key locations, alternate algorithms, broader audiences, and JWT/JWKS imports
  outside `access-verifier.ts`. The protected snapshot still needs independently reviewed deployment
  refresh and monitoring before real use.
- Every invitation attempt must first obtain one exact, current decision from the injected
  request-scoped authorization gateway. That gateway contract requires separate Access policy,
  individual admin membership, and consumed fresh-passkey proof. The local Access identity alone is
  not this decision. Do not accept a normal Web session, caller-built allow object, shared admin
  identity, alternate reason, or reusable authorization.
- Append the fixed external `authorized` audit event before database work, then recheck that the
  decision remains current and that the clock did not move backward. Return the invite only after
  the same sink acknowledges the fixed `committed` event. Neither event may contain the invite ID,
  plaintext secret, verifier digest, database value, raw proof, token, or configuration.
- The Admin database login is a distinct NOINHERIT principal whose only group membership is
  `viberacing_admin`. Preserve the exact pre-role login, membership, direct-capability denial,
  search-path, read-write, and TLS probe; the fixed role assumption; the Admin capability/table
  denial probe; the one parameterized `issue_invite` call; and the fixed role reset plus repeated
  login probe before a session can be reused.
- The application creates one seven-day beta invitation from OS CSPRNG entropy. Keep the exact
  `BETA_ADMISSION` reason, canonical Web-compatible credential grammar, generated identifiers, and
  one-time return. Clear mutable secret/digest copies on every path and never log or persist the
  plaintext outside the successful caller response.
- Treat a database result or committed-audit failure as ambiguous committed state: return no
  credential, perform no automatic retry, and retain only the preceding external authorization event
  plus any database-owned audit row. Do not add invite lookup, revoke, list, retry, repair, or
  generic SQL authority here.
- Do not claim a working issuer, Admin UI/API, separate deployed origin, real Access policy/token or
  key refresh, consumed passkey proof, complete authorization composition, external audit retention,
  production database/TLS result, monitoring, cohort workflow, or deployment until those independent
  adapters and gates exist.

## Commands

Run from the repository root:

```text
pnpm run lint:admin
pnpm run typecheck:admin
pnpm run test:admin
pnpm run verify
```

Run coverage and the production build when Admin behavior changes. Run
`pnpm run test:admin:postgres-integration` only when the database capability, login probe, or
transaction boundary changes; it is an explicit synthetic Docker gate. `pnpm run verify:release`
belongs to release/publication preparation or broad cross-cutting work, not routine Admin edits.

Before committing, stage only intended files, run `git diff --cached --check` and
`pnpm run check:public:staged`, then inspect every staged manifest, lockfile, source, test, ADR, and
documentation line.
