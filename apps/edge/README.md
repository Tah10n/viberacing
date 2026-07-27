# Edge origin signer

This Worker is the narrow, independently default-off public ingress for exact
`POST /v1/community/usage`. It preserves the client's raw JSON body and device-authentication
fields, rejects caller-supplied origin fields, adds one fresh body-bound HMAC-SHA-256 origin proof,
and forwards once to the configured HTTPS Ingest origin. It reads at most 8192 response bytes and
relays only the exact Usage Sync result or endpoint-problem contract whose request ID matches the
validated upstream header. The unreleased `/v1/community/sync` path is not registered.

It has no database, queue, cache, retry, user session, analytics sink, generic proxy route, or
runtime dependency. All local failures are bounded problem responses without reflected values.

## Local checks

From the repository root:

```text
corepack pnpm --filter @viberacing/edge run lint
corepack pnpm --filter @viberacing/edge run test
```

The tests run under Node's standards-compatible Fetch and Web Crypto APIs. They prove the exact
canonical Usage Sync messages, exact enablement, legacy-path rejection, body preservation, key
rebinding, route/header/body limits, generic failures, and a single upstream attempt. The separate
root compatibility test builds the real Ingest package and requires this Worker's proof to pass the
production verifier:

```text
corepack pnpm run test:edge-ingest-compatibility
```

These checks do not contact Cloudflare or Railway.

## Deploy

The checked `wrangler.jsonc` deliberately contains no route or secret and fixes
`VIBERACING_USAGE_SYNC_ENABLED` to `false`. Configure the intended custom domain in Cloudflare, then
use the reviewed one-shot Wrangler version to set all three required bindings as Worker secrets:

```text
corepack pnpm dlx wrangler@4.112.0 secret put VIBERACING_INGEST_ORIGIN_URL --config apps/edge/wrangler.jsonc
corepack pnpm dlx wrangler@4.112.0 secret put VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_ID --config apps/edge/wrangler.jsonc
corepack pnpm dlx wrangler@4.112.0 secret put VIBERACING_INGEST_ORIGIN_PRIMARY_KEY_BASE64URL --config apps/edge/wrangler.jsonc
corepack pnpm dlx wrangler@4.112.0 deploy --config apps/edge/wrangler.jsonc
```

Wrangler is deliberately not a workspace dependency: adding its optional development graph would
expand the locked supply chain for a dependency-free runtime. The exact command downloads the
reviewed CLI only for this operator action. Run it from a clean pinned checkout and inspect the
deployment preview before confirming the live route.

`VIBERACING_INGEST_ORIGIN_URL` is the exact dedicated HTTPS Railway origin with no path, query,
fragment, credentials, IP literal, or non-default port. The key ID and 32-byte canonical base64url
key must exactly match the Ingest service's active primary pair. Never put the raw key in
`wrangler.jsonc`, a tracked `.dev.vars` file, a command argument, or a log.

Enable Usage Sync only after the matching Ingest host deployment also has the exact protected value
`VIBERACING_USAGE_SYNC_ENABLED=true`; replacing only one side leaves the route unavailable. Keep the
tracked default false and use the one reviewed non-secret deployment override:

```text
corepack pnpm dlx wrangler@4.112.0 deploy --var VIBERACING_USAGE_SYNC_ENABLED:true --config apps/edge/wrangler.jsonc
```

The tracked false value is a startup/deployment default, not a dynamic incident control or protocol
migration switch. The override enables only the already checked `/v1/community/usage` route and must
be removed again for containment or rollback.

For rotation, first configure the new Ingest primary and retain the old value as its bounded
secondary. Then replace the Worker's active pair and deploy it. Remove the Ingest secondary only
after the maximum proof window and old Worker isolates have drained. A direct request to the Railway
origin still lacks a valid proof and is rejected by Ingest.

This source and its local tests are not Cloudflare deployment, route, secret-delivery, WAF,
monitoring, capacity, or real-user evidence.
