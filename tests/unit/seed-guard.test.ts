// The demo seed wipes every table first; it must never run on a database with
// data, whatever the state of the entrypoint's `/data/.seeded` marker.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { countExistingData, mayWipeAndSeed, seedRefusal } from "../../prisma/seed-guard";

const client = (users: number, tickets: number) => ({
  user: { count: async () => users },
  ticket: { count: async () => tickets },
});

describe("seed guard", () => {
  it("lets the seed run on an empty database", async () => {
    expect(seedRefusal({ users: 0, tickets: 0 })).toBeNull();
    const lines: string[] = [];
    expect(await mayWipeAndSeed(client(0, 0), (line) => lines.push(line))).toBe(true);
    expect(lines).toEqual([]);
  });

  it.each([
    [1, 0],
    [0, 1],
    [250, 4000],
  ])("refuses, logs and skips with %i user(s) and %i ticket(s), marker or not", async (users, tickets) => {
    const lines: string[] = [];
    expect(await mayWipeAndSeed(client(users, tickets), (line) => lines.push(line))).toBe(false);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`already holds ${users} user(s) and ${tickets} ticket(s)`);
    expect(lines[0]).toContain("Nothing was changed");
  });

  it("counts users and tickets", async () => {
    expect(await countExistingData(client(3, 7))).toEqual({ users: 3, tickets: 7 });
  });

  it("is checked before the seed deletes anything, and the extras only run from the guarded seed", () => {
    const seed = readFileSync(join(__dirname, "../../prisma/seed.ts"), "utf8");
    const guard = seed.indexOf("await mayWipeAndSeed(db)");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(seed.indexOf("deleteMany"));
    expect(seed.indexOf("await seedExtras(db)")).toBeGreaterThan(guard);

    const extras = readFileSync(join(__dirname, "../../prisma/seed-extras.ts"), "utf8");
    expect(extras).not.toMatch(/^main\(\)/m);
    expect(extras).not.toContain("new PrismaClient");
    const manifest = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf8"));
    expect(manifest.prisma.seed).toBe("tsx prisma/seed.ts");
  });
});
