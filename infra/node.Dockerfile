# Image for the TypeScript services (ingest, simulator, migrations and seed).
# Node 24 runs the .ts sources directly (type stripping), so there is no build step.
FROM node:24.22.3-trixie-slim

ENV NODE_ENV=production
RUN npm install -g pnpm@12.18.0 && npm cache clean --force

WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY services/ingest/package.json services/ingest/
COPY services/simulator/package.json services/simulator/
COPY apps/web/package.json apps/web/
# --ignore-scripts: no git hooks inside the image.
RUN pnpm install --frozen-lockfile --prod --ignore-scripts \
      --filter "@ecoshield/ingest..." --filter "@ecoshield/simulator..." --filter "@ecoshield/db..."

COPY packages packages
COPY services/ingest services/ingest
COPY services/simulator services/simulator

USER node
CMD ["node", "--version"]
