# Deployment

## Railway

1. Create a Railway project, add PostgreSQL, and deploy the repository root as one service.
2. Assign an HTTPS domain and create a dedicated production GitHub OAuth app. Set its homepage to
   the origin and callback to `https://your-domain.example/api/auth/github/callback`. Device Flow is
   not used.
3. Set:

   ```text
   DATABASE_URL=<Railway PostgreSQL URL>
   VIBERACING_PUBLIC_ORIGIN=https://your-domain.example
   GITHUB_CLIENT_ID=<production OAuth client ID>
   GITHUB_CLIENT_SECRET=<production OAuth client secret>
   VIBERACING_DATABASE_SSL=false
   VIBERACING_MIN_CONNECTOR_VERSION=0.2.0
   VIBERACING_MAX_DAILY_TOKENS=9999999999999999
   ```

   Set database SSL to `true` only for an endpoint with a trusted TLS certificate. Do not set the
   local-only insecure-origin exception in production.

4. Deploy. `railway.json` builds the pinned root image, runs the idempotent migration before
   traffic, and gates rollout on `/ready`.
5. Verify `/health`, `/ready`, GitHub sign-in, multi-source pairing, sync/correction, reconnect
   token rotation, source/installation disconnect, public ranking, and deletion.

Production startup validates all required variables. The service refuses non-HTTPS remote origins,
unknown schema versions, or missing PostgreSQL connectivity. See the
[production checklist](PRODUCTION_CHECKLIST.md) for backups, repository controls, and npm setup.

## Connector publication

After configuring npm trusted publishing and inspecting
`npm pack --dry-run --json ./packages/connector`:

```bash
corepack pnpm --filter @viberacing/connector publish --access public --provenance
```

Users connect with:

```bash
npx @viberacing/connector connect --origin https://your-domain.example
```
