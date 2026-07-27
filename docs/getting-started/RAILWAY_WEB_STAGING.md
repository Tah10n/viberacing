# Railway Web staging

This is the shortest supported deployment path for the current repository: one production Web
container serving the synthetic EN/RU experience. Legacy ranking, direct-token ranking, enrollment,
pairing, source creation, and CarRecipe mutation stay disabled, so this deployment needs no
database, OAuth credential, passkey secret, or connector.

It is a deployable product preview, not the complete participant beta. It does not collect real
usage, create accounts, issue invites, run Ingest or Jobs, or prove the planned
Cloudflare-to-Railway direct-origin control.

## Verify the exact runtime

Use the repository-pinned package manager from the repository root:

```text
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm run verify:web:deployment
```

The command builds the contracts and Next.js standalone output, assembles the same runtime layout as
the production image, then requires:

- a `200` home response with the production CSP and HSTS headers;
- a referenced `/_next/static/` CSS or JavaScript asset returning `200`;
- the configured HTTPS public origin in generated metadata;
- generic `503` problem responses from both intentionally disabled public-ranking decisions.

For an additional container-engine check:

```text
docker build --tag viberacing-web:local .
docker run --rm --read-only --tmpfs /tmp --publish 3000:3000 --env VIBERACING_PUBLIC_RANKING_ENABLED=false --env VIBERACING_TOKEN_RANKING_ENABLED=false --env VIBERACING_ENROLLMENT_ENABLED=false --env VIBERACING_PAIRING_ENABLED=false --env VIBERACING_SOURCE_CREATION_ENABLED=false --env VIBERACING_CAR_PROPOSALS_ENABLED=false viberacing-web:local
```

Open the loopback service on port `3000` only for this check. The image runs as the pre-existing
unprivileged `node` user and contains the standalone server plus its required static assets, not the
repository or build dependencies. The omitted public origin uses the reserved non-live production
fallback for this smoke only; set the real origin before any hosted deployment.

## Deploy

1. Create a Railway project and deploy this repository from its root. Railway detects `Dockerfile`;
   `railway.json` sets the root health check and an on-failure restart policy.
2. Generate the service domain or attach the intended custom domain.
3. Set `VIBERACING_PUBLIC_ORIGIN` to that exact HTTPS origin. Use only the origin: no path, query,
   fragment, credentials, IP literal, or non-default port.
4. Set these exact values:

   | Variable                             | Value   |
   | ------------------------------------ | ------- |
   | `VIBERACING_PUBLIC_RANKING_ENABLED`  | `false` |
   | `VIBERACING_TOKEN_RANKING_ENABLED`   | `false` |
   | `VIBERACING_ENROLLMENT_ENABLED`      | `false` |
   | `VIBERACING_PAIRING_ENABLED`         | `false` |
   | `VIBERACING_SOURCE_CREATION_ENABLED` | `false` |
   | `VIBERACING_CAR_PROPOSALS_ENABLED`   | `false` |

5. Redeploy after setting the final origin. Confirm the root health check is green, the page has its
   styles, and both `/v1/community/race/status` and `/v1/community/tokens` return `503`. Those
   responses prove that no database-backed participant surface was accidentally opened.

Railway supplies `PORT`; do not override the image command. No tracked `.env` file is copied into
the image.

## Boundary for a data-backed deployment

Do not turn the six switches on merely to make the preview look more complete. A real participant
staging environment additionally needs separate least-privileged PostgreSQL principals, the checked
migration runner, protected secrets, OAuth/WebAuthn origin registration, Ingest and Jobs services,
edge direct-origin denial, and operational evidence. The repository now contains bounded images and
configuration for those data-plane services plus a local Cloudflare signer; follow
[Railway data-plane staging](RAILWAY_DATA_PLANE_STAGING.md) for their exact composition. It still
does not supply a compatible production PostgreSQL service, protected credential, OAuth app, Admin
invite host, released connector, monitoring, or live deployment evidence.
