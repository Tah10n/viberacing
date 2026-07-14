# Database guidance

Read the root `AGENTS.md`, `database/README.md`, ADRs 0002–0004, the security invariants, abuse
cases, and privacy data map before changing this subtree.

## Hard boundaries

- Treat migration SQL, manifests, fixtures, output, and commit history as immediately public.
- Use deterministic synthetic fixtures only. Never paste a production row, identifier, credential,
  hash, hostname, incident detail, query output, local path, or private anti-abuse threshold.
- Never store GitHub tokens, account email, prompts, conversations, repository data, Codex
  credentials, API keys, arbitrary files, or free-form diagnostic payloads.
- Runtime roles remain `NOLOGIN`, non-owner, non-members of other database roles, and unable to use
  private tables directly. Add one narrowly owned API procedure per reviewed capability.
- Every `SECURITY DEFINER` function pins `search_path` to `pg_catalog, pg_temp`, fully qualifies
  application objects, revokes `PUBLIC` execution, validates all caller-controlled input, and has
  forbidden-capability tests.
- Keep schema ownership and deployment migration authority out of runtime services.
- Pending device keys have no authority. Activation must bind the exact immutable key record to one
  source and one public device ID in the same transaction.
- Do not weaken forced RLS, state constraints, digest/length checks, or role denials to simplify
  application code.

## Migration rules

- Once a migration has reached a shared or released environment, do not edit it. Add the next
  contiguous revision and use expand-and-contract changes.
- Keep one transaction, bounded lock/statement time, advisory serialization, explicit owner role,
  and exact migration-ledger insert.
- Update `manifest.json` only after reviewing the complete SQL diff. The checksum records review; it
  is not a substitute for review.
- Avoid extensions, dynamic file inclusion, `COPY PROGRAM`, `ALTER SYSTEM`, cluster role mutation,
  implicit `search_path`, and direct runtime table/sequence grants.
- Add indexes for bounded cleanup and hot authorization paths, but verify concurrency and query
  behavior in PostgreSQL rather than inferring it from SQL text.

## Required verification

```text
pnpm run test:database-check
pnpm run check:database
pnpm run test:database:integration
pnpm run verify
```

The integration runner uses only the isolated `postgres-test` Compose profile. Do not point it at a
shared database or change it to reuse the normal local volume. Before committing, run the exact
staged public-data scan and manually inspect every staged SQL/manifest line.

Document new columns in the privacy map and `database/README.md`, new authority in the capability
matrix and threat model, and any durable design change in an ADR. Do not claim an application flow
is implemented merely because its storage table exists.
