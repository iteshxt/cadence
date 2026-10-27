# API and worker image. Build from the repo root:
#   docker build -f apps/api/Dockerfile -t cadence-api .
# On Render it runs as one service (RUN_WORKER=true, MIGRATE_ON_START=true, tech-spec §13.2);
# deploy/docker-compose.prod.yml runs the API and worker as separate containers instead.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @cadence/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @cadence/shared build && pnpm --filter @cadence/api build
# A self-contained production copy: compiled API plus prod-only node_modules (shared included).
RUN pnpm --filter @cadence/api deploy --prod --legacy /out

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 4000
# Overridden per service in deploy/docker-compose.prod.yml (worker, migrate).
CMD ["node", "dist/src/server.js"]
