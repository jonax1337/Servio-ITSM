# Servio — production image (true multi-stage).
#
# CI builds this image and boots it on every PR; tagged releases are pushed to
# GHCR (see docs/releasing.md). The runner ships production dependencies
# only, runs as the unprivileged `node` user, self-reports health on /login,
# and carries NO baked-in DATABASE_URL (provide one at runtime; the compose
# file defaults to SQLite on the /data volume). Migrations are applied at boot
# via `prisma migrate deploy` — see docker/entrypoint.sh.

# ── deps ─────────────────────────────────────────────────────────────────────
# Full dependency tree (dev deps included) — required to build the app.
FROM node:22-slim AS deps
RUN corepack enable \
 && apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Install deps first (cached until the lockfile changes).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

# ── builder ──────────────────────────────────────────────────────────────────
FROM deps AS builder
COPY . .
ARG APP_URL=http://localhost:3000
ENV NEXT_TELEMETRY_DISABLED=1 \
    APP_URL=$APP_URL
RUN pnpm prisma generate && pnpm build

# ── prod-deps ────────────────────────────────────────────────────────────────
# Production-only node_modules, built in its own stage so the runner never sees
# devDependencies, source or build cache. The Prisma CLI and tsx are
# devDependencies upstream but are needed at boot (`prisma migrate deploy` /
# `prisma db seed`, see docker/entrypoint.sh) — they are vendored standalone in
# /opt/boot-tools instead of shipping the whole devDependency tree.
FROM node:22-slim AS prod-deps
RUN corepack enable \
 && apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile --prod

# Pin to the versions declared in package.json (prisma ^6.19.3, tsx ^4.23.10).
RUN mkdir -p /opt/boot-tools \
 && cd /opt/boot-tools \
 && echo '{"name":"servio-boot-tools","private":true}' > package.json \
 && npm install --no-audit --no-fund prisma@6.19.3 tsx@4.23.10

# Generate the Prisma client explicitly against this prod-only tree rather than
# relying on the @prisma/client postinstall heuristic.
RUN PATH="/opt/boot-tools/node_modules/.bin:$PATH" prisma generate

# ── runner ───────────────────────────────────────────────────────────────────
FROM node:22-slim AS runner
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    SERVIO_STATE_DIR=/data/state \
    PATH="/opt/boot-tools/node_modules/.bin:${PATH}"

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /opt/boot-tools /opt/boot-tools
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
# Sable's agent charter + ITSM skills, synced into its isolated SABLE_HOME at runtime.
COPY sable ./sable
COPY docker/entrypoint.sh ./docker/entrypoint.sh
RUN chmod +x ./docker/entrypoint.sh \
 && mkdir -p /data \
 && chown -R node:node /data

VOLUME /data
EXPOSE 3000
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/login').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

ENTRYPOINT ["/app/docker/entrypoint.sh"]
# Start Next directly: `pnpm start` would run pnpm's dependency check, which
# tries to `pnpm install` into the read-only /app as the `node` user.
CMD ["node", "node_modules/next/dist/bin/next", "start"]
