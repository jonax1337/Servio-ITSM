/**
 * Safety net for the demo seed: `prisma/seed.ts` starts by wiping every table,
 * so it must never run against a database that already holds real data. The
 * container entrypoint seeds when its marker file (`/data/.seeded`) is missing;
 * a deleted or lost marker, a fresh volume pointed at an existing database, or
 * `pnpm db:seed` / `pnpm setup` on a production database would otherwise erase
 * everything. The check looks at the data itself, independent of any marker.
 * `pnpm db:reset` (drop, migrate, seed) is the way to start over on purpose.
 */

export type ExistingData = { users: number; tickets: number };

type CountingClient = {
  user: { count: () => Promise<number> };
  ticket: { count: () => Promise<number> };
};

/** Why seeding must not run, or null for an empty database. */
export function seedRefusal(existing: ExistingData): string | null {
  if (existing.users === 0 && existing.tickets === 0) return null;
  return (
    `Refusing to seed: the database already holds ${existing.users} user(s) and ${existing.tickets} ticket(s), ` +
    "and seeding starts by deleting all data. Nothing was changed. To start over with demo data on purpose, " +
    "run `pnpm db:reset` (drops and recreates the database)."
  );
}

export async function countExistingData(db: CountingClient): Promise<ExistingData> {
  const [users, tickets] = await Promise.all([db.user.count(), db.ticket.count()]);
  return { users, tickets };
}

/**
 * Logs and returns false when the database already holds data (the caller then
 * skips seeding and exits successfully); true when it is empty.
 */
export async function mayWipeAndSeed(db: CountingClient, log: (line: string) => void = console.warn): Promise<boolean> {
  const refusal = seedRefusal(await countExistingData(db));
  if (refusal) log(`[seed] ${refusal}`);
  return refusal === null;
}
