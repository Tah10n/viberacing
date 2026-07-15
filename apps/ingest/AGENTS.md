# Ingest workspace guidance

Read the root `AGENTS.md`, `contracts/README.md`, `contracts/v1/connector-sync-authentication.json`,
the security invariants, threat model, abuse cases, privacy data map, and ADRs 0015–0017 before
changing this workspace.

## Non-negotiable boundaries

- Treat the request body, raw headers, device identifiers, clocks, callback results, and every
  parsed value as untrusted. Enforce the raw byte and structure budgets before contract traversal.
- Verify the edge proof before parsing or device lookup. Bind both proofs to the SHA-256 digest of
  the exact received body bytes; never serialize JSON again for signing.
- Reject duplicate security headers, duplicate JSON object keys, unknown body fields, non-canonical
  encodings, stale/future edge proofs, replay-consume failure, unknown devices, cross-source
  binding, and invalid signatures without reflecting submitted values.
- Device signatures authenticate one registered Community device only. They do not verify Codex,
  usage honesty, account uniqueness, or a trust tier.
- The PostgreSQL adapter may expose only fixed device lookup and verified submission calls. Probe
  the exact Ingest role/login/search path before each capability, copy all bytes/arrays, accept only
  closed results, and destroy failed clients. Never expose a general query or reuse another role.
- Only `database-pool.ts` imports `pg`. Only `database-config.ts` and `origin-proof-config.ts` read
  process environment. Keep database settings namespaced, redacted, loopback-only without TLS, and
  certificate-verified elsewhere.
- Origin proof configuration requires one exact primary ID/key pair and permits only one complete,
  distinct secondary rotation pair. Keys are canonical 32-byte base64url values from protected
  configuration only. Never add defaults, literals, files, commands, general keyrings, or
  key-returning APIs.
- This workspace owns no HTTP listener, persistent origin replay store, OAuth, passkey, admin,
  signing, deployment, logging, analytics, monitoring backend, or scheduler. It contains no real
  origin key or secret-manager integration.
- Never log or serialize bodies, signatures, nonces, proof keys, public keys, callback errors, or
  internal failure stacks. Future public response mapping must remain generic.

## Required checks

Run `pnpm run lint:ingest`, `pnpm run typecheck:ingest`, `pnpm run test:ingest:coverage`,
`pnpm run build:ingest`, and the root `pnpm run verify`. Before committing, review the exact staged
diff and run `pnpm run check:public:staged` plus `git diff --cached --check`.
