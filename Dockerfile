FROM node:26.5.1-bookworm-slim@sha256:9e6f9357d371591e32ab6f2d8a26d63bdd0d17c29eee3f4f3e7e454d9634bf73 AS build

ENV CI=true
ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json

RUN corepack pnpm install --filter @viberacing/web... --frozen-lockfile --ignore-scripts

COPY apps/web apps/web
COPY packages/contracts packages/contracts

RUN corepack pnpm --filter @viberacing/contracts run build
RUN corepack pnpm --filter @viberacing/web run build
RUN mkdir -p apps/web/public

FROM node:26.5.1-bookworm-slim@sha256:9e6f9357d371591e32ab6f2d8a26d63bdd0d17c29eee3f4f3e7e454d9634bf73 AS runtime

ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

COPY --from=build --chown=node:node /workspace/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /workspace/apps/web/public ./apps/web/public

USER node
WORKDIR /app/apps/web

EXPOSE 3000

STOPSIGNAL SIGTERM

CMD ["node", "server.js"]
