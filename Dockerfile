FROM node:24.19.0-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS build

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

FROM node:24.19.0-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS runtime

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
