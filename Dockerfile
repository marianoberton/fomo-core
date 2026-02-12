# ─── Stage 1: Install dependencies ───────────────────────────────
FROM node:22-alpine AS deps

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma/

RUN pnpm install --frozen-lockfile
RUN pnpm db:generate

# ─── Stage 2: Build ──────────────────────────────────────────────
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY package.json pnpm-lock.yaml tsconfig.json tsconfig.build.json ./
COPY src ./src

RUN pnpm tsc -p tsconfig.build.json && pnpm tsc-alias -p tsconfig.build.json

# ─── Stage 3: Production ─────────────────────────────────────────
FROM node:22-alpine AS runner

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY --from=builder /app/dist ./dist
COPY package.json ./

EXPOSE 3002

# Run migrations then start
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
