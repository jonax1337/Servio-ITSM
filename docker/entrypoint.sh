#!/bin/sh
# Boot the containerised app: apply committed migrations, seed once per volume,
# then start Next. Uses `prisma migrate deploy` (production-correct, matches
# docs/deployment.md — the committed baseline migration is kept current). Fails
# hard (set -e) if migrations cannot be applied rather than starting on a
# stale/wrong schema.
set -e

echo "[servio] applying migrations (prisma migrate deploy)…"
prisma migrate deploy

# Seed exactly once per data volume (guard file lives on the mounted /data).
if [ ! -f /data/.seeded ]; then
  echo "[servio] seeding initial data…"
  prisma db seed && touch /data/.seeded || echo "[servio] seed skipped/failed (continuing)"
fi

echo "[servio] starting Next…"
exec "$@"
