FROM node:22-alpine

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/domain/package.json packages/domain/package.json
RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
COPY packages/domain packages/domain

CMD ["pnpm", "--filter", "@flowcontext/api", "start"]
