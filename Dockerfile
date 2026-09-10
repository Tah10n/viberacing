FROM node:24.21.0-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS build

ENV CI=true
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY LICENSE LICENSE
COPY apps/web/package.json apps/web/package.json
RUN corepack pnpm install --filter @viberacing/web... --frozen-lockfile --ignore-scripts

COPY packages/connector packages/connector
COPY apps/web apps/web
RUN corepack pnpm --filter @viberacing/web build
RUN corepack pnpm --filter @viberacing/web deploy --prod /runtime-deps

FROM node:24.21.0-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS runtime

ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app

COPY --from=build --chown=node:node /workspace/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /workspace/apps/web/public ./apps/web/public
COPY --from=build --chown=node:node /workspace/apps/web/database ./apps/web/database
COPY --from=build --chown=node:node /workspace/apps/web/scripts ./apps/web/scripts
COPY --from=build --chown=node:node /runtime-deps/node_modules ./apps/web/node_modules

USER node
WORKDIR /app/apps/web
EXPOSE 3000
STOPSIGNAL SIGTERM
CMD ["node", "server.js"]
