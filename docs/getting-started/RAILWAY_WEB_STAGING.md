# Railway Web staging preparation

This is a repository-owned procedure for a database-free synthetic Web preview. It is not evidence
that Railway is configured, compatible, healthy, secure, or deployed. Verify current platform
behavior and record hosted results before changing the implementation ledger.

The preview serves the EN/RU synthetic experience with every data/account mutation capability
closed. It accepts no real usage and needs no database, OAuth app, passkey secret, pairing key, or
connector.

## Verify the exact local runtime

```text
corepack pnpm install --frozen-lockfile --ignore-scripts
corepack pnpm run verify:web:deployment
```

The gate builds contracts and the Next standalone runtime, then checks:

- a `200` home response with production CSP and HSTS;
- one referenced static CSS or JavaScript asset;
- the configured HTTPS public origin in metadata;
- generic `503` from all three disabled public snapshot routes; and
- `404` from the four removed legacy Community read routes.

Optional local container smoke:

```text
docker build --tag viberacing-web:local .
docker run --rm --read-only --tmpfs /tmp --publish 3000:3000 --env VIBERACING_PUBLIC_SNAPSHOTS_ENABLED=false --env VIBERACING_ENROLLMENT_ENABLED=false --env VIBERACING_INVITE_GATE_ENABLED=false --env VIBERACING_PAIRING_ENABLED=false --env VIBERACING_CAR_PROPOSALS_ENABLED=false viberacing-web:local
```

Use loopback port `3000` only for this smoke. The image runs as the existing unprivileged `node`
user and contains the standalone runtime/static assets rather than the repository and build graph.

## Hosted preparation

1. Review `Dockerfile` and `railway.json` at the exact source revision.
2. Create a new service from the repository root only after the project/operator has approved it.
3. Generate or attach the intended domain.
4. Set `VIBERACING_PUBLIC_ORIGIN` to that exact HTTPS DNS origin with no credentials, path, query,
   fragment, IP literal, or non-default port.
5. Keep these values exact:

   | Variable                              | Value   |
   | ------------------------------------- | ------- |
   | `VIBERACING_PUBLIC_SNAPSHOTS_ENABLED` | `false` |
   | `VIBERACING_ENROLLMENT_ENABLED`       | `false` |
   | `VIBERACING_INVITE_GATE_ENABLED`      | `false` |
   | `VIBERACING_PAIRING_ENABLED`          | `false` |
   | `VIBERACING_CAR_PROPOSALS_ENABLED`    | `false` |

6. Let Railway supply `PORT`; do not override the image command.
7. Replace the process after final configuration and verify the root health check, static assets,
   metadata origin, headers, three disabled snapshot responses, and four removed-route responses.

No tracked `.env` is copied into the image. Do not use a production/personal value in a build
argument, Docker layer, source file, public log, screenshot, or issue.

## Evidence boundary

A successful hosted preview would prove only that one exact synthetic Web revision was served. It
would not prove:

- a database, OAuth, passkey, pairing, provider, usage, Jobs, Edge, or Ingest path;
- direct-origin denial, secret delivery, monitoring, capacity, backup, restore, or containment;
- a supported/released connector; or
- readiness for real participants.

Do not enable data-backed capabilities opportunistically. Their narrow logins, verified TLS,
protected values, migration, service order, negative controls, and rollback requirements are in
[Railway data-plane staging preparation](RAILWAY_DATA_PLANE_STAGING.md).
