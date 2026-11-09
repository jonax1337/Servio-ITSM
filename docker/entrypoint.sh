#!/bin/sh
# Boot the containerised app: apply committed migrations, refuse a database
# that a newer Servio already migrated, seed once per volume, then start Next.
# Uses `prisma migrate deploy` (production-correct, matches docs/deployment.md —
# the committed baseline migration is kept current). Fails hard (set -e) if
# migrations cannot be applied rather than starting on a stale/wrong schema.
set -e

echo "[servio] applying migrations (prisma migrate deploy)…"
prisma migrate deploy

# `migrate deploy` succeeds silently when the database holds migrations this
# image does not ship (it was migrated by a newer version, e.g. a rolled-back
# update without a restore). Running old code on a newer schema corrupts data.
if [ "${ALLOW_UNKNOWN_MIGRATIONS:-false}" != "true" ]; then
  node -e '
    const { readdirSync } = require("node:fs");
    const { PrismaClient } = require("@prisma/client");
    const shipped = new Set(
      readdirSync("prisma/migrations", { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name),
    );
    const prisma = new PrismaClient();
    prisma
      .$queryRawUnsafe("SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL")
      .then((rows) => {
        const unknown = rows.map((row) => row.migration_name).filter((name) => !shipped.has(name));
        if (unknown.length === 0) return;
        console.error(
          `[servio] REFUSING TO START: the database has migrations this image does not contain (${unknown.join(", ")}). ` +
            "A newer Servio version migrated it: run that version, or restore the database backup taken before the update. " +
            "Set ALLOW_UNKNOWN_MIGRATIONS=true to start anyway.",
        );
        process.exitCode = 1;
      })
      .catch((error) => {
        console.error(`[servio] could not compare applied migrations with this image: ${error.message}`);
        process.exitCode = 1;
      })
      .finally(() => prisma.$disconnect());
  '
fi

# Seed exactly once per data volume (guard file lives on the mounted /data).
# The marker only saves the work: the seed itself refuses (logs, skips, exits 0)
# whenever the database already holds users or tickets, so a deleted or lost
# marker never wipes or reseeds a database with data (prisma/seed-guard.ts).
if [ ! -f /data/.seeded ]; then
  echo "[servio] seeding initial data…"
  prisma db seed && touch /data/.seeded || echo "[servio] seed skipped/failed (continuing)"
fi

echo "[servio] starting Next…"
exec "$@"
