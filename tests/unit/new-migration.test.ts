import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { nextMigrationName, stampOf } from "../../scripts/new-migration.mjs";

const existing = ["20261110000000_import_refs", "20261124000000_contract_start_date_optional", "migration_lock.toml"];

describe("nextMigrationName", () => {
  it("uses today's stamp when it is later than every migration", () => {
    const now = new Date("2026-12-01T08:30:15Z");
    expect(nextMigrationName(existing, "add_thing", now)).toBe("20261201083015_add_thing");
  });

  it("sorts after the newest migration even when the clock is behind it", () => {
    // The scenario that broke `migrate dev`: the repo's newest migration is dated after the contributor's clock.
    const now = new Date("2026-11-09T18:47:00Z");
    expect(nextMigrationName(existing, "add_thing", now)).toBe("20261124000100_add_thing");
  });

  it("also moves past a migration stamped in the same second", () => {
    expect(nextMigrationName(existing, "x", new Date("2026-11-24T00:00:00Z"))).toBe("20261124000100_x");
  });

  it("works for an empty history and ignores the lock file", () => {
    expect(nextMigrationName(["migration_lock.toml"], "init", new Date("2026-01-02T03:04:05Z"))).toBe("20260102030405_init");
  });

  it("formats stamps like Prisma does (UTC, 14 digits)", () => {
    expect(stampOf(new Date("2026-11-25T00:00:00Z"))).toBe("20261125000000");
  });
});

describe("the migrations folder", () => {
  it("has strictly increasing, unique stamps (the replay order is the name order)", () => {
    const dir = fileURLToPath(new URL("../../prisma/migrations/", import.meta.url));
    const stamps = readdirSync(dir).map((e) => /^(\d{14})_/.exec(e)?.[1]).filter(Boolean) as string[];
    expect(new Set(stamps).size).toBe(stamps.length);
  });
});
