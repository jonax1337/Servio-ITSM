import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `visible_to_group_ids` on the /catalog-items endpoints: create, edit, upsert (idempotent) and read,
 * against an in-memory stand-in for the three tables involved.
 */

type Row = Record<string, unknown>;
const world = vi.hoisted(() => ({
  items: new Map<string, Row>(),
  links: [] as { catalogItemId: string; groupId: string }[],
  groups: new Set(["g1", "g2", "g3"]),
  audits: [] as string[],
  seq: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/audit", () => ({ writeAudit: async (a: { summary?: string }) => { world.audits.push(a.summary ?? ""); } }));
vi.mock("@/app/api/v1/_itsm", async (importActual) => ({
  ...(await importActual<typeof import("@/app/api/v1/_itsm")>()),
  agentGuard: async () => ({ principal: { userId: "u1", role: "MANAGER", tokenId: "t1" } }),
}));
vi.mock("@/lib/db", () => {
  const withGroups = (row: Row | undefined) =>
    row && { ...row, visibleTo: world.links.filter((l) => l.catalogItemId === row.id).map((l) => ({ groupId: l.groupId })) };
  const find = (where: Row) => [...world.items.values()].find((r) => Object.entries(where).every(([k, v]) => r[k] === v));
  const db: Record<string, unknown> = {
    catalogItem: {
      findUnique: async ({ where }: { where: Row }) => withGroups(find(where)) ?? null,
      findUniqueOrThrow: async ({ where }: { where: Row }) => withGroups(find(where))!,
      count: async () => world.items.size,
      create: async ({ data }: { data: Row }) => {
        const row = {
          id: `c${++world.seq}`, description: null, shortDescription: null, icon: null, categoryId: null, serviceId: null, groupId: null,
          ticketType: "REQUEST", titleTemplate: null, estimatedDays: null, isPublished: true, order: 0, requiresApproval: false, approverId: null,
          approvalStages: null, formSchema: "[]", importRef: null, restrictToGroups: false, createdAt: new Date(0), updatedAt: new Date(0), ...data,
        };
        world.items.set(row.id as string, row);
        return row;
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = find(where)!;
        Object.assign(row, data);
        return row;
      },
    },
    catalogItemGroup: {
      deleteMany: async ({ where }: { where: { catalogItemId: string } }) => {
        world.links = world.links.filter((l) => l.catalogItemId !== where.catalogItemId);
      },
      createMany: async ({ data }: { data: { catalogItemId: string; groupId: string }[] }) => { world.links.push(...data); },
    },
    group: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.filter((id) => world.groups.has(id)).map((id) => ({ id })),
    },
  };
  db.$transaction = async (fn: (tx: unknown) => unknown) => fn(db);
  return { db };
});

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
type Json = { data?: Row & { visible_to_group_ids: string[]; restricted: boolean }; meta?: { changed: string[] }; error?: { details?: Record<string, string[]> } };

async function call(method: string, body?: unknown, params: Record<string, string> = {}, route: "list" | "id" | "ref" = "list") {
  const mod =
    route === "ref" ? await import("@/app/api/v1/catalog-items/ref/[ref]/route")
      : route === "id" ? await import("@/app/api/v1/catalog-items/[id]/route")
        : await import("@/app/api/v1/catalog-items/route");
  const handler = (mod as unknown as Record<string, Handler>)[method];
  const res = await handler(
    new Request("http://localhost/api/v1/catalog-items", { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } }),
    { params: Promise.resolve(params) },
  );
  return { status: res.status, json: (await res.json()) as Json };
}

beforeEach(() => {
  world.items.clear();
  world.links = [];
  world.audits = [];
  world.seq = 0;
});

describe("create with visible_to_group_ids", () => {
  it("restricts the item to the (deduplicated) groups and reports them sorted", async () => {
    const { status, json } = await call("POST", { name: "New employee", visible_to_group_ids: ["g2", "g1", "g2"] });
    expect(status).toBe(201);
    expect(json.data).toMatchObject({ restricted: true, visible_to_group_ids: ["g1", "g2"] });
    expect(world.links).toHaveLength(2);
  });

  it("is visible to everyone without the field, or with an empty list", async () => {
    for (const body of [{ name: "A item" }, { name: "B item", visible_to_group_ids: [] }]) {
      const { status, json } = await call("POST", body);
      expect(status).toBe(201);
      expect(json.data).toMatchObject({ restricted: false, visible_to_group_ids: [] });
    }
    expect(world.links).toHaveLength(0);
  });

  it("refuses an unknown group with a 422 naming the field, and creates nothing", async () => {
    const { status, json } = await call("POST", { name: "New employee", visible_to_group_ids: ["g1", "nope"] });
    expect(status).toBe(422);
    expect(json.error?.details).toHaveProperty("visible_to_group_ids");
    expect(world.items.size).toBe(0);
  });

  it("rejects a non-array value and unknown sibling fields as before", async () => {
    expect((await call("POST", { name: "New employee", visible_to_group_ids: "g1" })).status).toBe(422);
    expect((await call("POST", { name: "New employee", visible_to: ["g1"] })).status).toBe(422);
  });
});

describe("edit", () => {
  async function restrictedItem() {
    const { json } = await call("POST", { name: "Staff exit", visible_to_group_ids: ["g1"] });
    return json.data!.id as string;
  }

  it("replaces the set of groups and says so in meta.changed", async () => {
    const id = await restrictedItem();
    const { status, json } = await call("PATCH", { visible_to_group_ids: ["g2", "g3"] }, { id }, "id");
    expect(status).toBe(200);
    expect(json.data!.visible_to_group_ids).toEqual(["g2", "g3"]);
    expect(json.meta!.changed).toEqual(["visible_to_group_ids"]);
  });

  it("lifts the restriction with an empty list", async () => {
    const id = await restrictedItem();
    const { json } = await call("PATCH", { visible_to_group_ids: [] }, { id }, "id");
    expect(json.data).toMatchObject({ restricted: false, visible_to_group_ids: [] });
    expect(world.links).toHaveLength(0);
  });

  it("leaves the restriction alone when the body does not mention it", async () => {
    const id = await restrictedItem();
    const { json } = await call("PATCH", { name: "Staff exit (new)" }, { id }, "id");
    expect(json.data).toMatchObject({ restricted: true, visible_to_group_ids: ["g1"] });
  });

  it("keeps a restricted item whose groups were all deleted hidden, until groups are set again", async () => {
    const id = await restrictedItem();
    world.links = []; // the group was deleted: the join rows cascade away, the flag stays
    const { json: renamed } = await call("PATCH", { name: "Staff exit v2" }, { id }, "id");
    expect(renamed.data).toMatchObject({ restricted: true, visible_to_group_ids: [] });
    const { json: lifted } = await call("PATCH", { visible_to_group_ids: [] }, { id }, "id");
    expect(lifted.data!.restricted).toBe(false);
  });

  it("refuses an unknown group and changes nothing", async () => {
    const id = await restrictedItem();
    const { status } = await call("PATCH", { visible_to_group_ids: ["nope"] }, { id }, "id");
    expect(status).toBe(422);
    expect(world.links).toEqual([{ catalogItemId: id, groupId: "g1" }]);
  });
});

describe("upsert by reference", () => {
  it("is idempotent: the same list a second time writes nothing and leaves no audit row", async () => {
    const body = { name: "New employee", visible_to_group_ids: ["g1", "g2"] };
    const first = await call("PUT", body, { ref: "catalog:new-employee" }, "ref");
    expect(first.status).toBe(201);
    const audits = world.audits.length;
    const second = await call("PUT", { visible_to_group_ids: ["g2", "g1"] }, { ref: "catalog:new-employee" }, "ref");
    expect(second.status).toBe(200);
    expect(second.json.meta!.changed).toEqual([]);
    expect(world.audits).toHaveLength(audits);
    expect(second.json.data!.visible_to_group_ids).toEqual(["g1", "g2"]);
  });

  it("changes the set when it differs and reports it", async () => {
    await call("PUT", { name: "New employee", visible_to_group_ids: ["g1"] }, { ref: "catalog:ne" }, "ref");
    const { json } = await call("PUT", { visible_to_group_ids: ["g1", "g3"] }, { ref: "catalog:ne" }, "ref");
    expect(json.meta!.changed).toEqual(["visible_to_group_ids"]);
    expect(json.data!.visible_to_group_ids).toEqual(["g1", "g3"]);
  });
});

describe("reading", () => {
  it("GET /catalog-items/{id} carries the groups", async () => {
    const { json: created } = await call("POST", { name: "New employee", visible_to_group_ids: ["g3"] });
    const { json } = await call("GET", undefined, { id: created.data!.id as string }, "id");
    expect(json.data).toMatchObject({ restricted: true, visible_to_group_ids: ["g3"] });
  });
});
