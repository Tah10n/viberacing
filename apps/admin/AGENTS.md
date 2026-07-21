# Admin workspace agent guidance

Read the root `AGENTS.md`, this directory's `README.md`, `docs/PROJECT_PLAN.md`, the current
implementation status, database capability documentation, security invariants, abuse cases, privacy
data map, and ADR 0066 before editing this workspace. The root public-data, dependency,
documentation, and staged-review rules all apply.

## Non-negotiable boundaries

- Keep this workspace transport-free. It has no HTTP listener, page, CLI, process entry point,
  default authorization implementation, Cloudflare Access verifier, admin membership store, WebAuthn
  verifier, external audit backend, or deployable host.
- Every invitation attempt must first obtain one exact, current decision from the injected
  request-scoped authorization gateway. That gateway contract requires separate Access policy,
  individual admin membership, and consumed fresh-passkey proof. Do not accept a normal Web session,
  caller-built allow object, shared admin identity, alternate reason, or reusable authorization.
- Append the fixed external `authorized` audit event before database work, then recheck that the
  decision remains current and that the clock did not move backward. Return the invite only after
  the same sink acknowledges the fixed `committed` event. Neither event may contain the invite ID,
  plaintext secret, verifier digest, database value, raw proof, token, or configuration.
- The Admin database login is a distinct NOINHERIT principal whose only group membership is
  `viberacing_admin`. Preserve the exact runtime role, membership, capability, table-denial,
  search-path, read-write, and TLS probe before the one fixed parameterized `issue_invite` call.
- The application creates one seven-day beta invitation from OS CSPRNG entropy. Keep the exact
  `BETA_ADMISSION` reason, canonical Web-compatible credential grammar, generated identifiers, and
  one-time return. Clear mutable secret/digest copies on every path and never log or persist the
  plaintext outside the successful caller response.
- Treat a database result or committed-audit failure as ambiguous committed state: return no
  credential, perform no automatic retry, and retain only the preceding external authorization event
  plus any database-owned audit row. Do not add invite lookup, revoke, list, retry, repair, or
  generic SQL authority here.
- Do not claim a working issuer, Admin UI/API, separate deployed origin, real Access/passkey proof,
  external audit retention, production database/TLS result, monitoring, cohort workflow, or
  deployment until those independent adapters and gates exist.

## Commands

Run from the repository root:

```text
pnpm run lint:admin
pnpm run typecheck:admin
pnpm run test:admin:coverage
pnpm run build:admin
pnpm run verify
```

Before committing, stage only intended files, run `git diff --cached --check` and
`pnpm run check:public:staged`, then inspect every staged manifest, lockfile, source, test, ADR, and
documentation line.
