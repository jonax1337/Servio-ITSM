import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncSource } from "@prisma/client";

/**
 * A whole directory sync run with group mappings: users are imported, then the Servio group membership of the
 * imported users follows the directory group. The directory (ldapts) and the database are faked in memory.
 */

type Row = Record<string, unknown>;
const world = vi.hoisted(() => ({
  users: [] as Row[],
  groups: [] as Row[],
  members: [] as Row[],
  audits: [] as { userId?: string | null; entityId: string | number; summary?: string; meta?: Row }[],
  directory: { users: [] as { dn: string; mail: string; guid: string; memberOf: string[] }[], groups: [] as { dn: string; cn: string; hasMembers: boolean }[], failMembership: false },
  seq: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/audit", () => ({ writeAudit: async (a: { userId?: string | null; entityId: string | number; summary?: string; meta?: Row }) => { world.audits.push(a); } }));
vi.mock("ldapts", () => {
  const id = (guid: string) => Buffer.from(guid.padEnd(16, "0").slice(0, 16));
  class Client {
    async bind() {}
    async unbind() {}
    async search(base: string, o: { scope?: string; filter?: string; explicitBufferAttributes?: string[] }) {
      const filter = String(o.filter ?? "");
      const entry = (u: (typeof world.directory.users)[number]) => ({ dn: u.dn, mail: u.mail, displayName: u.mail.split("@")[0], objectGUID: id(u.guid) });
      if (o.scope === "base") {
        const g = world.directory.groups.find((x) => x.dn.toLowerCase() === base.toLowerCase());
        if (!g) throw new Error("No Such Object");
        return { searchEntries: [{ dn: g.dn, ...(g.hasMembers ? { member: ["CN=x"] } : {}) }] };
      }
      if (filter.includes("objectClass=group")) {
        const name = /cn=([^)]+)\)/.exec(filter)?.[1];
        const g = world.directory.groups.find((x) => x.cn === name);
        return { searchEntries: g ? [{ dn: g.dn, ...(g.hasMembers ? { member: ["CN=x"] } : {}) }] : [] };
      }
      const memberOf = /\(memberOf(?::[^=]*)?=([^)]+)\)/.exec(filter)?.[1];
      if (memberOf) {
        if (world.directory.failMembership) throw new Error("boom");
        return { searchEntries: world.directory.users.filter((u) => u.memberOf.some((m) => m.toLowerCase() === memberOf.toLowerCase())).map(entry) };
      }
      return { searchEntries: world.directory.users.map(entry) };
    }
  }
  return { Client };
});
vi.mock("@/lib/db", () => {
  const matches = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (k === "OR") return (v as Row[]).some((w) => matches(row, w));
      if (v && typeof v === "object" && "in" in v) return (v as { in: unknown[] }).in.includes(row[k]);
      if (v && typeof v === "object" && "not" in v) return row[k] !== (v as { not: unknown }).not;
      return row[k] === v;
    });
  const copy = (r: Row | undefined) => (r ? { ...r } : null);
  const tx = {
    userEmail: { findUnique: async () => null },
    user: {
      findUnique: async ({ where }: { where: { syncSourceId_externalId: Row } }) => copy(world.users.find((u) => matches(u, where.syncSourceId_externalId))),
      findFirst: async ({ where }: { where: Row }) => copy(world.users.find((u) => matches(u, where))),
      findMany: async ({ where }: { where: Row }) => world.users.filter((u) => matches(u, where)).map((u) => ({ ...u })),
      count: async () => 1,
      create: async ({ data }: { data: Row }) => { const row = { id: `u${++world.seq}`, name: null, ...data }; world.users.push(row); return row; },
      update: async ({ where, data }: { where: { id: string }; data: Row }) => { Object.assign(world.users.find((u) => u.id === where.id)!, data); },
      updateMany: async () => ({ count: 0 }),
    },
    group: {
      findMany: async ({ where }: { where: { OR: Row[] } }) => world.groups.filter((g) => matches(g, where)).map((g) => ({ ...g })),
    },
    groupMember: {
      findMany: async ({ where }: { where: Row }) => world.members.filter((m) => matches(m, where)).map((m) => ({ ...m })),
      findUnique: async ({ where }: { where: { groupId_userId: Row } }) => copy(world.members.find((m) => matches(m, where.groupId_userId))),
      create: async ({ data }: { data: Row }) => { world.members.push({ id: `m${++world.seq}`, ...data }); },
      deleteMany: async ({ where }: { where: Row }) => {
        const before = world.members.length;
        world.members = world.members.filter((m) => !matches(m, where));
        return { count: before - world.members.length };
      },
    },
  };
  return { db: { ...tx, $transaction: async (fn: (t: unknown) => unknown) => fn(tx) } };
});

import { ldapConnector } from "@/lib/connectors/ldap";

const SOURCE_ID = "src1";
const DN_IT = "CN=IT,OU=Groups,DC=corp,DC=local";
const config = (over: Row = {}) =>
  JSON.stringify({
    url: "ldap://x", baseDN: "DC=corp,DC=local", bindDN: "CN=svc", bindPassword: "", userFilter: "(objectCategory=person)",
    externalId: "objectGUID", email: "mail", name: "displayName",
    groupMappings: [{ directoryGroup: DN_IT, group: "service-desk" }],
    ...over,
  });
const source = (over: Row = {}) => ({ id: SOURCE_ID, name: "Corporate directory", type: "ACTIVE_DIRECTORY", config: config(over) }) as unknown as SyncSource;
const dirUser = (n: number, memberOf: string[]) => ({ dn: `CN=user${n},DC=corp,DC=local`, mail: `user${n}@example.test`, guid: `guid${n}`, memberOf });
const membersOf = (groupId: string) => world.members.filter((m) => m.groupId === groupId).map((m) => m.userId).sort();
const idOf = (email: string) => world.users.find((u) => u.email === email)?.id;

beforeEach(() => {
  world.seq = 0;
  world.audits = [];
  world.users = [];
  world.members = [];
  world.groups = [{ id: "g-desk", name: "Service Desk", importRef: "service-desk" }, { id: "g-other", name: "Other", importRef: null }];
  world.directory = { users: [], groups: [{ dn: DN_IT, cn: "IT", hasMembers: true }], failMembership: false };
});

describe("a directory sync run with group mappings", () => {
  it("imports the users, adds the ones in the directory group and leaves hand-added members alone", async () => {
    world.directory.users = [dirUser(1, [DN_IT]), dirUser(2, [DN_IT]), dirUser(3, [])];
    // A local account somebody added by hand: not a directory-sourced user, so it stays.
    world.users.push({ id: "local", email: "local@example.test", syncSourceId: null, externalId: null, role: "AGENT", isActive: true });
    world.members.push({ id: "m0", groupId: "g-desk", userId: "local", role: "LEAD" });

    const result = await ldapConnector.run(source(), { trigger: "MANUAL", actorId: "admin1" });
    expect(result.status).toBe("SUCCESS");
    expect(result.created).toBe(3);
    expect(membersOf("g-desk")).toEqual([idOf("user1@example.test"), idOf("user2@example.test"), "local"].sort());
    expect(world.members.find((m) => m.userId === "local")?.role).toBe("LEAD");
    expect(world.members.find((m) => m.userId === idOf("user1@example.test"))?.role).toBe("MEMBER");
    expect(result.log).toContain('Group "Service Desk": 2 added, 0 removed.');
    expect(world.audits).toHaveLength(1);
    expect(world.audits[0]).toMatchObject({ userId: "admin1", entityId: "g-desk" });
    expect(world.audits[0].meta).toMatchObject({ syncSourceId: SOURCE_ID, added: ["user1@example.test", "user2@example.test"], removed: [] });
  });

  it("removes a directory-sourced user who left the directory group, whoever added the membership", async () => {
    world.directory.users = [dirUser(1, [DN_IT]), dirUser(2, [])];
    await ldapConnector.run(source(), { trigger: "SCHEDULED" });
    const u2 = idOf("user2@example.test")!;
    world.members.push({ id: "mx", groupId: "g-desk", userId: u2, role: "MEMBER" }); // added by hand afterwards
    world.audits = [];

    const result = await ldapConnector.run(source(), { trigger: "SCHEDULED" });
    expect(membersOf("g-desk")).toEqual([idOf("user1@example.test")]);
    expect(result.log).toContain('Group "Service Desk": 0 added, 1 removed.');
    expect(world.audits[0]).toMatchObject({ userId: null });
    expect(world.audits[0].meta).toMatchObject({ removed: ["user2@example.test"] });
  });

  it("is idempotent: a second run over an unchanged directory writes and audits nothing", async () => {
    world.directory.users = [dirUser(1, [DN_IT])];
    await ldapConnector.run(source(), { trigger: "MANUAL" });
    world.audits = [];
    const before = JSON.stringify(world.members);
    const result = await ldapConnector.run(source(), { trigger: "MANUAL" });
    expect(JSON.stringify(world.members)).toBe(before);
    expect(world.audits).toEqual([]);
    expect(result.log).toContain("Group membership: 0 added, 0 removed.");
  });

  it("does not touch memberships when the directory returns no users at all", async () => {
    world.directory.users = [dirUser(1, [DN_IT])];
    await ldapConnector.run(source(), { trigger: "MANUAL" });
    world.directory.users = [];
    const result = await ldapConnector.run(source(), { trigger: "MANUAL" });
    expect(membersOf("g-desk")).toHaveLength(1);
    expect(result.log).toContain("Skipped group membership");
  });

  it("keeps the memberships and reports a directory group it cannot read", async () => {
    world.directory.users = [dirUser(1, [DN_IT])];
    await ldapConnector.run(source(), { trigger: "MANUAL" });
    world.directory.groups = []; // the group was renamed or deleted in the directory
    const result = await ldapConnector.run(source(), { trigger: "MANUAL" });
    expect(membersOf("g-desk")).toHaveLength(1);
    expect(result.log).toContain("Group mapping skipped");
    expect(result.status).toBe("PARTIAL");
  });

  it("reports a mapping to a Servio group that does not exist and changes nothing", async () => {
    world.directory.users = [dirUser(1, [DN_IT])];
    const result = await ldapConnector.run(source({ groupMappings: [{ directoryGroup: DN_IT, group: "no-such-group" }] }), { trigger: "MANUAL" });
    expect(world.members).toEqual([]);
    expect(result.log).toContain('Servio group "no-such-group"');
    expect(result.created).toBe(1);
  });

  it("resolves a Servio group by id as well as by import ref, and a group by name", async () => {
    world.directory.users = [dirUser(1, [DN_IT])];
    await ldapConnector.run(source({ groupMappings: [{ directoryGroup: "IT", group: "g-other" }] }), { trigger: "MANUAL" });
    expect(membersOf("g-other")).toEqual([idOf("user1@example.test")]);
  });

  it("a source without mappings behaves as before: no group is touched", async () => {
    world.directory.users = [dirUser(1, [DN_IT])];
    const result = await ldapConnector.run(source({ groupMappings: [] }), { trigger: "MANUAL" });
    expect(result.created).toBe(1);
    expect(world.members).toEqual([]);
    expect(result.log).not.toContain("Group");
  });

  it("flags a directory that does not answer memberOf instead of emptying the group", async () => {
    world.directory.users = [dirUser(1, [DN_IT])];
    await ldapConnector.run(source(), { trigger: "MANUAL" });
    world.directory.users = [dirUser(1, [])]; // memberOf no longer matches, but the group still lists members
    const result = await ldapConnector.run(source(), { trigger: "MANUAL" });
    expect(membersOf("g-desk")).toHaveLength(1);
    expect(result.log).toContain("has members but none of them matched");
  });
});

describe("previewGroups", () => {
  it("reports the planned adds and removes and writes nothing", async () => {
    world.directory.users = [dirUser(1, [DN_IT]), dirUser(2, [])];
    await ldapConnector.run(source(), { trigger: "MANUAL" });
    world.directory.users = [dirUser(1, []), dirUser(2, [DN_IT]), dirUser(9, [DN_IT])];
    const snapshot = JSON.stringify([world.members, world.users]);
    world.audits = [];

    const preview = await ldapConnector.previewGroups!(source());
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.report.groups).toHaveLength(1);
    const [g] = preview.report.groups;
    expect(g.groupName).toBe("Service Desk");
    expect(g.adds.map((u) => u.email)).toEqual(["user2@example.test"]);
    expect(g.removes.map((u) => u.email)).toEqual(["user1@example.test"]);
    expect(g.pendingNew).toBe(1); // user9 is not imported yet
    expect(JSON.stringify([world.members, world.users])).toBe(snapshot);
    expect(world.audits).toEqual([]);
  });

  it("says so when the source has no mappings", async () => {
    expect(await ldapConnector.previewGroups!(source({ groupMappings: [] }))).toEqual({ ok: false, message: "This source has no group mappings." });
  });
});
