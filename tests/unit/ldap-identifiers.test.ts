// Directory sync identifiers: objectGUID / objectSid as canonical text, the
// migration of the hex form earlier releases stored, and matching both forms.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Entry } from "ldapts";
import type { SyncSource } from "@prisma/client";
import {
  binaryExternalId,
  guidFromBytes,
  guidFromLegacyHex,
  isBinaryAttr,
  isCanonicalGuid,
  legacyHexFromGuid,
  sidFromBytes,
} from "@/lib/connectors/ldap-identifiers";

// A known pair: the GUID and the bytes Active Directory stores for it (and the hex earlier releases kept).
const GUID = "35918bc9-196d-40ea-9779-889d79b753f0";
const GUID_BYTES = Buffer.from([0xc9, 0x8b, 0x91, 0x35, 0x6d, 0x19, 0xea, 0x40, 0x97, 0x79, 0x88, 0x9d, 0x79, 0xb7, 0x53, 0xf0]);
const LEGACY_HEX = "c98b91356d19ea409779889d79b753f0";

type UserRow = { id: string; email: string; syncSourceId: string | null; externalId: string | null; isActive: boolean; role: string; passwordHash: string | null };
const users = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, seq: 0, failUpdates: new Set<string>() }));

vi.mock("@/lib/db", () => {
  type Condition = unknown | { in: unknown[] } | { notIn: unknown[] };
  const matches = (row: Record<string, unknown>, where: Record<string, Condition>): boolean =>
    Object.entries(where).every(([key, condition]) => {
      if (condition && typeof condition === "object" && "in" in condition) return (condition as { in: unknown[] }).in.includes(row[key]);
      if (condition && typeof condition === "object" && "notIn" in condition) return !(condition as { notIn: unknown[] }).notIn.includes(row[key]);
      return row[key] === condition;
    });
  const copy = (row: Record<string, unknown> | undefined) => (row ? { ...row } : null);
  return {
    db: {
      user: {
        findUnique: async ({ where }: { where: { syncSourceId_externalId: { syncSourceId: string; externalId: string } } }) =>
          copy(users.rows.find((row) => matches(row, where.syncSourceId_externalId))),
        // Prisma hands out copies; a later update must not change a row read earlier.
        findFirst: async ({ where }: { where: Record<string, unknown> }) => copy(users.rows.find((row) => matches(row, where))),
        findMany: async ({ where }: { where: Record<string, unknown> }) => users.rows.filter((row) => matches(row, where)),
        count: async ({ where }: { where: Record<string, unknown> }) => users.rows.filter((row) => matches(row, where)).length,
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          if (users.failUpdates.has(where.id)) throw new Error("database is locked");
          const row = users.rows.find((candidate) => candidate.id === where.id)!;
          Object.assign(row, Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)));
          return row;
        },
        updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
          const hit = users.rows.filter((row) => matches(row, where));
          for (const row of hit) Object.assign(row, data);
          return { count: hit.length };
        },
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: `u${++users.seq}`, passwordHash: null, ...data };
          users.rows.push(row);
          return row;
        },
      },
    },
  };
});

const { importUsers } = await import("@/lib/connectors/import");
const { mapEntry } = await import("@/lib/connectors/ldap");
const { SyncLog } = await import("@/lib/connectors/types");

describe("objectGUID", () => {
  it("turns the stored bytes into the canonical text form (first three groups little-endian)", () => {
    expect(guidFromBytes(GUID_BYTES)).toBe(GUID);
    expect(isCanonicalGuid(GUID)).toBe(true);
  });

  it("converts the hex earlier releases stored, in either case", () => {
    expect(guidFromLegacyHex(LEGACY_HEX)).toBe(GUID);
    expect(guidFromLegacyHex(LEGACY_HEX.toUpperCase())).toBe(GUID);
    expect(guidFromLegacyHex("not-hex")).toBeNull();
    expect(legacyHexFromGuid(GUID)).toBe(LEGACY_HEX);
    expect(legacyHexFromGuid(LEGACY_HEX)).toBeNull();
    expect(guidFromLegacyHex(LEGACY_HEX.slice(2))).toBeNull();
  });

  it("refuses anything but 16 bytes", () => {
    expect(guidFromBytes(Buffer.alloc(15))).toBeNull();
    expect(guidFromBytes(Buffer.alloc(17))).toBeNull();
  });
});

describe("objectSid", () => {
  it("turns a well-known SID into its string form", () => {
    // BUILTIN\\Administrators
    expect(sidFromBytes(Buffer.from("01020000000000052000000020020000", "hex"))).toBe("S-1-5-32-544");
  });

  it("reads domain SIDs with little-endian sub-authorities", () => {
    const bytes = Buffer.alloc(8 + 5 * 4);
    bytes[0] = 1;
    bytes[1] = 5;
    bytes[7] = 5;
    [21, 3623811015, 3361044348, 30300820, 1013].forEach((value, i) => bytes.writeUInt32LE(value, 8 + i * 4));
    expect(sidFromBytes(bytes)).toBe("S-1-5-21-3623811015-3361044348-30300820-1013");
  });

  it("refuses malformed bytes", () => {
    expect(sidFromBytes(Buffer.from("0102000000000005200000", "hex"))).toBeNull();
    expect(sidFromBytes(Buffer.from("02010000000000052000000", "hex"))).toBeNull();
  });
});

describe("binaryExternalId", () => {
  it("uses the canonical form and remembers the legacy hex", () => {
    expect(binaryExternalId("objectGUID", GUID_BYTES)).toEqual({ externalId: GUID, legacy: [LEGACY_HEX] });
    expect(binaryExternalId("msDS-ConsistencyGuid", GUID_BYTES)).toEqual({ externalId: GUID, legacy: [LEGACY_HEX] });
    const sid = Buffer.from("01020000000000052000000020020000", "hex");
    expect(binaryExternalId("objectSid", sid)).toEqual({ externalId: "S-1-5-32-544", legacy: ["01020000000000052000000020020000"] });
  });

  it("keeps hex for bytes that do not fit the attribute", () => {
    expect(binaryExternalId("objectGUID", Buffer.from([1, 2, 3, 4]))).toEqual({ externalId: "01020304", legacy: [] });
  });

  it("knows which attributes are binary", () => {
    expect(isBinaryAttr("objectGUID")).toBe(true);
    expect(isBinaryAttr("objectSid")).toBe(true);
    expect(isBinaryAttr("mail")).toBe(false);
  });
});

describe("mapEntry", () => {
  const map = { externalId: "objectGUID", email: "mail", name: "displayName", jobTitle: "", phone: "", department: "" };

  it("maps a binary objectGUID to the canonical id with the legacy hex as fallback", () => {
    const user = mapEntry({ dn: "CN=Alice", objectGUID: GUID_BYTES, mail: "Alice@Example.org", displayName: "Alice" } as unknown as Entry, map);
    expect(user).toEqual({ externalId: GUID, legacyExternalIds: [LEGACY_HEX], email: "alice@example.org", name: "Alice" });
  });

  it("keeps a text id as it is", () => {
    const user = mapEntry({ dn: "CN=Bob", uid: "bob", mail: "bob@example.org" } as unknown as Entry, { ...map, externalId: "uid" });
    expect(user).toMatchObject({ externalId: "bob" });
    expect(user).not.toHaveProperty("legacyExternalIds");
  });
});

describe("importUsers: transition from hex to canonical ids", () => {
  const source = { id: "src-ad" } as SyncSource;
  const legacyUser = (overrides: Partial<UserRow> = {}): UserRow => ({
    id: "u-legacy",
    email: "alice@example.org",
    syncSourceId: "src-ad",
    externalId: LEGACY_HEX,
    isActive: true,
    role: "USER",
    passwordHash: null,
    ...overrides,
  });

  beforeEach(() => {
    users.rows = [];
    users.seq = 0;
    users.failUpdates.clear();
  });

  it("matches a user stored with the hex form and moves it to the canonical id", async () => {
    users.rows.push(legacyUser());
    const log = new SyncLog();
    await importUsers(source, [{ externalId: GUID, legacyExternalIds: [LEGACY_HEX], email: "alice@example.org", name: "Alice" }], true, log);

    expect(users.rows).toHaveLength(1);
    expect(users.rows[0]).toMatchObject({ id: "u-legacy", externalId: GUID, isActive: true, name: "Alice" });
    expect(log.updated).toBe(1);
    expect(log.created).toBe(0);
    expect(log.toString()).toContain(`Moved alice@example.org from external id "${LEGACY_HEX}" to "${GUID}".`);
  });

  it("matches the canonical form directly once it is stored", async () => {
    users.rows.push(legacyUser({ externalId: GUID }));
    const log = new SyncLog();
    await importUsers(source, [{ externalId: GUID, legacyExternalIds: [LEGACY_HEX], email: "alice@example.org", name: "Alice" }], false, log);

    expect(users.rows[0]).toMatchObject({ externalId: GUID });
    expect(log.updated).toBe(1);
  });

  it("never deactivates a user whose move to the canonical id failed", async () => {
    users.rows.push(legacyUser());
    users.failUpdates.add("u-legacy");
    const log = new SyncLog();
    await importUsers(source, [{ externalId: GUID, legacyExternalIds: [LEGACY_HEX], email: "alice@example.org", name: "Alice" }], true, log);

    expect(log.failed).toBe(1);
    expect(users.rows[0]).toMatchObject({ externalId: LEGACY_HEX, isActive: true });
  });

  it("does not take over a user of another source by its legacy id", async () => {
    users.rows.push(legacyUser({ syncSourceId: "src-other" }));
    const log = new SyncLog();
    await importUsers(source, [{ externalId: GUID, legacyExternalIds: [LEGACY_HEX], email: "new@example.org", name: "New" }], false, log);

    expect(users.rows.find((row) => row.id === "u-legacy")).toMatchObject({ syncSourceId: "src-other", externalId: LEGACY_HEX });
    expect(users.rows.find((row) => row.email === "new@example.org")).toMatchObject({ externalId: GUID, syncSourceId: "src-ad" });
  });
});

describe("migration 20261118000000_ldap_guid_external_ids", () => {
  const sql = readFileSync(join(__dirname, "../../prisma/migrations/20261118000000_ldap_guid_external_ids/migration.sql"), "utf8");

  function database() {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE "SyncSource" ("id" TEXT PRIMARY KEY, "type" TEXT NOT NULL, "config" TEXT NOT NULL DEFAULT '{}');
      CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "syncSourceId" TEXT, "externalId" TEXT, UNIQUE ("syncSourceId", "externalId"));
      INSERT INTO "SyncSource" VALUES
        ('ad', 'ACTIVE_DIRECTORY', '{"externalId":"objectGUID","email":"mail"}'),
        ('ldap', 'LDAP', '{"externalId":"objectGUID"}'),
        ('uid', 'LDAP', '{"externalId":"uid"}'),
        ('csv', 'CSV', '{"externalId":"objectGUID"}'),
        ('broken', 'LDAP', 'not json');
      INSERT INTO "User" VALUES
        ('a', 'ad', '${LEGACY_HEX}'),
        ('b', 'ldap', '${LEGACY_HEX.toUpperCase()}'),
        ('c', 'ad', '00000000-0000-0000-0000-000000000001'),
        ('d', 'ad', 'short'),
        ('e', 'uid', '${LEGACY_HEX}'),
        ('f', 'csv', '${LEGACY_HEX}'),
        ('g', 'broken', '${LEGACY_HEX}'),
        ('h', NULL, '${LEGACY_HEX}'),
        ('i', 'ad', 'zz8b91356d19ea409779889d79b753f0');
    `);
    return db;
  }

  it("converts GUID hex ids of directory sources to the canonical form and leaves everything else alone", () => {
    const db = database();
    db.exec(sql);
    const ids = Object.fromEntries(
      (db.prepare(`SELECT "id", "externalId" FROM "User" ORDER BY "id"`).all() as Array<{ id: string; externalId: string }>).map(
        (row) => [row.id, row.externalId],
      ),
    );
    expect(ids).toEqual({
      a: GUID,
      b: GUID,
      c: "00000000-0000-0000-0000-000000000001",
      d: "short",
      e: LEGACY_HEX,
      f: LEGACY_HEX,
      g: LEGACY_HEX,
      h: LEGACY_HEX,
      i: "zz8b91356d19ea409779889d79b753f0",
    });
  });

  it("is a no-op when run again", () => {
    const db = database();
    db.exec(sql);
    const once = db.prepare(`SELECT "id", "externalId" FROM "User" ORDER BY "id"`).all();
    db.exec(sql);
    expect(db.prepare(`SELECT "id", "externalId" FROM "User" ORDER BY "id"`).all()).toEqual(once);
  });
});
