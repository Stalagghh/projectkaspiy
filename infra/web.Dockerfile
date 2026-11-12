# Production build of the Next.js app (next build, then next start).
FROM node:24.22.3-trixie-slim AS build

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@12.18.0 && npm cache clean --force

WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY services/ingest/package.json services/ingest/
COPY services/simulator/package.json services/simulator/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "@ecoshield/web..."

COPY packages packages
COPY apps/web apps/web
RUN pnpm --filter @ecoshield/web build

FROM node:24.22.3-trixie-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "--port", "3000", "--hostname", "0.0.0.0"]
