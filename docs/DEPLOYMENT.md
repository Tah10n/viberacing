# Deployment

## Railway

1. Create a Railway project, add PostgreSQL, and deploy this repository as a service.
2. Assign an HTTPS domain to the web service.
3. Create a separate production GitHub OAuth app. GitHub OAuth apps support one callback URL, so do
   not reuse the localhost app.
4. Set its Homepage URL to your production origin and its Authorization callback URL to:

   ```text
   https://your-domain.example/api/auth/github/callback
   ```

   Device Flow is not used and does not need to be enabled.

5. Set these Railway variables:

   ```text
   DATABASE_URL=<Railway PostgreSQL connection URL>
   VIBERACING_PUBLIC_ORIGIN=https://your-domain.example
   GITHUB_CLIENT_ID=<GitHub OAuth app client ID>
   GITHUB_CLIENT_SECRET=<GitHub OAuth app client secret>
   VIBERACING_DATABASE_SSL=false
   ```

   Use the values from the production OAuth app. Set `VIBERACING_DATABASE_SSL=true` only when
   `DATABASE_URL` points to an endpoint with a trusted TLS certificate.

6. Deploy. `railway.json` builds the root `Dockerfile`, runs the idempotent migration, and checks
   `/health`.
7. Verify GitHub sign-in, connector pairing, sync, disconnect, leaving the leaderboard, and the
   public profile.

Before inviting users, enable database backups and test restoring one into a separate database.

## Connector publication

Authenticate npm for the `@viberacing` scope, then publish:

```bash
corepack pnpm --filter @viberacing/connector publish --access public
```

Users can then connect each computer with:

```bash
npx @viberacing/connector connect --origin https://your-domain.example
```
