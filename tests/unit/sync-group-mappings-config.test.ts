import { beforeEach, describe, expect, it, vi } from "vitest";

/** The group mappings in the source configuration: form text <-> stored list, validation when a source is saved. */

type Row = Record<string, unknown>;
const world = vi.hoisted(() => ({ role: "ADMIN", created: [] as Row[], updated: [] as Row[], groups: [{ id: "g1", importRef: "service-desk" }] as Row[], existing: null as Row | null }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {} }));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => undefined, signOut: async () => undefined, handlers: {} }));
vi.mock("@/lib/audit", () => ({ writeAudit: async () => {} }));
vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session")>()),
  getCurrentUser: async () => ({ id: "adm", role: world.role, isActive: true }),
}));
vi.mock("@/lib/db", () => ({
  db: {
    group: {
      findMany: async ({ where }: { where: { OR: { importRef?: { in: string[] }; id?: { in: string[] } }[] } }) =>
        world.groups.filter((g) => where.OR.some((w) => w.importRef?.in.includes(g.importRef as string) || w.id?.in.includes(g.id as string))),
    },
    syncSource: {
      create: async ({ data }: { data: Row }) => { world.created.push(data); return { id: "s1", ...data }; },
      findUnique: async () => world.existing,
      update: async ({ data }: { data: Row }) => { world.updated.push(data); },
    },
  },
}));

import { createSyncSource, updateSyncSource } from "@/lib/actions/syncs";
import { configToFormValues } from "@/lib/connectors/spec";
import { ldapConfigSchema } from "@/lib/connectors/ldap";

const form = (o: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) fd.set(k, v);
  return fd;
};
const base = {
  name: "Corporate directory", type: "ACTIVE_DIRECTORY", scope: "USERS",
  url: "ldaps://dc:636", bindDN: "CN=svc", baseDN: "DC=corp,DC=local", userFilter: "(objectCategory=person)", searchScope: "sub", pageSize: "500",
  externalId: "objectGUID", email: "mail",
};

beforeEach(() => {
  world.role = "ADMIN";
  world.created = [];
  world.updated = [];
  world.existing = null;
});

describe("saving a directory source with group mappings", () => {
  it("stores the lines as a list of mappings and the options next to them", async () => {
    const state = await createSyncSource(undefined, form({
      ...base,
      groupMappings: "CN=IT,OU=Groups,DC=corp,DC=local => service-desk\n# comment\n",
      groupBaseDN: "OU=Groups,DC=corp,DC=local",
      groupNested: "on",
    }));
    expect(state).toBeUndefined();
    const config = JSON.parse(world.created[0].config as string);
    expect(config.groupMappings).toEqual([{ directoryGroup: "CN=IT,OU=Groups,DC=corp,DC=local", group: "service-desk" }]);
    expect(config.groupBaseDN).toBe("OU=Groups,DC=corp,DC=local");
    expect(config.groupNested).toBe(true);
    expect(ldapConfigSchema.safeParse(config).success).toBe(true);
  });

  it("refuses a line that is not a mapping, without saving", async () => {
    const state = await createSyncSource(undefined, form({ ...base, groupMappings: "just a name" }));
    expect(state?.error).toMatch(/^Line 1: expected/);
    expect(world.created).toEqual([]);
  });

  it("refuses a Servio group that does not exist (by id or import ref), without saving", async () => {
    const state = await createSyncSource(undefined, form({ ...base, groupMappings: "IT => service-desk\nOps => typo-group" }));
    expect(state?.error).toBe("Unknown Servio group in the group mappings: typo-group. Use a group id or an import ref.");
    expect(world.created).toEqual([]);
    const byId = await createSyncSource(undefined, form({ ...base, groupMappings: "IT => g1" }));
    expect(byId).toBeUndefined();
    expect(world.created).toHaveLength(1);
  });

  it("a source without mappings stores an empty list", async () => {
    await createSyncSource(undefined, form(base));
    expect(JSON.parse(world.created[0].config as string).groupMappings).toEqual([]);
  });

  it("only an admin can save the mappings", async () => {
    world.role = "MANAGER";
    expect(await createSyncSource(undefined, form({ ...base, groupMappings: "IT => g1" }))).toEqual({ error: "Not authorised." });
    world.existing = { id: "s1", type: "ACTIVE_DIRECTORY", scope: "USERS", config: "{}" };
    expect(await updateSyncSource(undefined, form({ id: "s1", name: "x", groupMappings: "IT => g1" }))).toEqual({ error: "Not authorised." });
    expect(world.created).toEqual([]);
    expect(world.updated).toEqual([]);
  });

  it("editing validates the mappings too", async () => {
    world.existing = { id: "s1", type: "ACTIVE_DIRECTORY", scope: "USERS", config: "{}" };
    const state = await updateSyncSource(undefined, form({ ...base, id: "s1", groupMappings: "IT => nope" }));
    expect(state?.error).toContain("Unknown Servio group");
    expect(world.updated).toEqual([]);
  });
});

describe("the edit form values", () => {
  it("shows a stored list as one line per mapping, and old configs without the field as empty", () => {
    const stored = JSON.stringify({ groupMappings: [{ directoryGroup: "CN=IT,DC=x", group: "desk" }, { directoryGroup: "Ops", group: "ops" }], groupNested: true });
    const { values } = configToFormValues("ACTIVE_DIRECTORY", "USERS", stored);
    expect(values.groupMappings).toBe("CN=IT,DC=x => desk\nOps => ops");
    expect(values.groupNested).toBe(true);
    expect(configToFormValues("LDAP", "USERS", "{}").values.groupMappings).toBe("");
  });

  it("an old stored configuration without group fields still parses", () => {
    const parsed = ldapConfigSchema.parse({ url: "ldap://x", baseDN: "dc=x", bindDN: "cn=a", userFilter: "(a=b)" });
    expect(parsed.groupMappings).toEqual([]);
    expect(parsed.groupNested).toBe(false);
  });
});
