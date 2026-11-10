import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST / PATCH / DELETE /groups and PUT /groups/ref/{ref}: the input contract, the MANAGER+ gate,
 * name and import_ref conflicts, the refusal to delete a referenced group, audit and idempotence.
 */

type Row = Record<string, unknown>;
const world = vi.hoisted(() => ({
  groups: [] as Row[],
  users: new Map<string, Row>(),
  counts: {} as Record<string, number>,
  nextId: 1,
  audits: [] as { action: string; entityId: string; summary?: string }[],
  role: "MANAGER",
}));
const helpers = vi.hoisted(() => ({
  find: (groups: Record<string, unknown>[], where: Record<string, unknown>) =>
    groups.find((g) => Object.entries(where).every(([k, v]) => g[k] === v)) ?? null,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => undefined, signOut: async () => undefined, handlers: {} }));
vi.mock("@/lib/audit", () => ({
  writeAudit: async (a: { action: string; entityId: string; summary?: string }) => { world.audits.push(a); },
}));
vi.mock("@/app/api/v1/_itsm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/api/v1/_itsm")>()),
  agentGuard: async () => ({ principal: { userId: "mgr", role: world.role, tokenId: "t", scopes: ["write"] } }),
}));

vi.mock("@/lib/db", () => {
  const find = (where: Row) => helpers.find(world.groups, where);
  const countOf = (kind: string) => async () => world.counts[kind] ?? 0;
  const withMembers = (g: Row | null) => (g ? { members: [], ...g } : null);
  const db = {
    group: {
      findUnique: async ({ where }: { where: Row }) => withMembers(find(where)),
      findMany: async () => world.groups.map((g) => ({ members: [], ...g })),
      create: async ({ data }: { data: Row }) => {
        const clash = world.groups.find((g) => g.name === data.name);
        if (clash) throw Object.assign(new Error("unique"), { code: "P2002", meta: { target: ["name"] } });
        const row = { id: `g${world.nextId++}`, description: null, type: "TEAM", email: null, color: "#6366f1", managerId: null, autoAssign: "OFF", importRef: null, ...data };
        world.groups.push(row);
        return row;
      },
      update: async ({ where, data }: { where: Row; data: Row }) => {
        const row = find(where)!;
        Object.assign(row, data);
        return row;
      },
      deleteMany: async ({ where }: { where: Row }) => {
        const before = world.groups.length;
        world.groups = world.groups.filter((g) => g.id !== where.id);
        return { count: before - world.groups.length };
      },
    },
    user: { findUnique: async ({ where }: { where: { id: string } }) => world.users.get(where.id) ?? null },
    category: { count: countOf("categories") },
    service: { count: countOf("services") },
    catalogItem: { count: async (args: { where: Row }) => world.counts[args.where.approvalStages ? "stages" : "catalog_items"] ?? 0 },
    catalogItemGroup: { count: countOf("visibility") },
    ticket: { count: countOf("tickets") },
    problem: { count: countOf("problems") },
    change: { count: countOf("changes") },
    asset: { count: countOf("assets") },
    release: { count: countOf("releases") },
    changeTemplate: { count: countOf("change_templates") },
    recurringTicket: { count: countOf("recurring_tickets") },
    onCallSchedule: { count: countOf("on_call_schedules") },
    changeFreezeWindow: { count: countOf("freeze_windows") },
    automationRule: { count: countOf("automation_rules") },
  };
  return { db };
});

import { POST } from "@/app/api/v1/groups/route";
import { DELETE, PATCH } from "@/app/api/v1/groups/[id]/route";
import { PUT } from "@/app/api/v1/groups/ref/[ref]/route";
import { groupCreateSchema, groupData, groupPatchSchema, groupUpsertSchema } from "@/lib/api-group-input";
import { groupInUseRefusal, nonEmptyReferences } from "@/lib/group-rules";

const req = (method: string, body?: unknown) =>
  new Request("http://x/api/v1/groups", { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { "content-type": "application/json" } });
const post = (body: unknown) => POST(req("POST", body));
const patch = (id: string, body: unknown) => PATCH(req("PATCH", body), { params: Promise.resolve({ id }) });
const del = (id: string) => DELETE(req("DELETE"), { params: Promise.resolve({ id }) });
const put = (ref: string, body: unknown) => PUT(req("PUT", body), { params: Promise.resolve({ ref }) });

beforeEach(() => {
  world.groups = [];
  world.users = new Map([["lead", { role: "AGENT", isActive: true, email: "lead@example.test" }]]);
  world.counts = {};
  world.nextId = 1;
  world.audits = [];
  world.role = "MANAGER";
});

describe("input schemas", () => {
  it("require a name on create and reject unknown fields", () => {
    expect(groupCreateSchema.safeParse({}).success).toBe(false);
    expect(groupCreateSchema.safeParse({ name: "Service Desk" }).success).toBe(true);
    expect(groupCreateSchema.safeParse({ name: "Service Desk", nope: 1 }).success).toBe(false);
  });

  it("validate type, auto_assign, colour, email and import_ref", () => {
    const ok = { name: "Service Desk", type: "DEPARTMENT", auto_assign: "LEAST_BUSY", color: "#0a0B0c", email: "desk@example.test", import_ref: "dir:desk" };
    expect(groupCreateSchema.safeParse(ok).success).toBe(true);
    for (const bad of [{ type: "CLUB" }, { auto_assign: "RANDOM" }, { color: "red" }, { email: "not-an-address" }, { import_ref: "has space" }]) {
      expect(groupCreateSchema.safeParse({ name: "Service Desk", ...bad }).success).toBe(false);
    }
  });

  it("patch and upsert need at least one field; null clears the nullable ones", () => {
    expect(groupPatchSchema.safeParse({}).success).toBe(false);
    expect(groupUpsertSchema.safeParse({}).success).toBe(false);
    expect(groupPatchSchema.safeParse({ description: null, email: null, manager_id: null, import_ref: null }).success).toBe(true);
    // the reference of an upsert is in the path, not the body
    expect(groupUpsertSchema.safeParse({ import_ref: "x" }).success).toBe(false);
  });

  it("maps the API fields to columns and leaves absent fields alone", () => {
    expect(groupData({ manager_id: "u1", auto_assign: "ROUND_ROBIN", description: "" })).toEqual({ managerId: "u1", autoAssign: "ROUND_ROBIN", description: null });
    expect(groupData({})).toEqual({});
  });
});

describe("the delete refusal", () => {
  it("is null for a group nothing points at and lists only the kinds that count", () => {
    expect(groupInUseRefusal(nonEmptyReferences({ categories: 0, services: 0 }))).toBeNull();
    const refusal = groupInUseRefusal(nonEmptyReferences({ categories: 2, services: 0, open_tickets: 1 }));
    expect(refusal).toMatchObject({ code: "GROUP_IN_USE", references: { categories: 2, open_tickets: 1 } });
    expect(refusal?.hint).toMatch(/Nothing is removed automatically/);
  });
});

describe("POST /groups", () => {
  it("creates a group (201), returns it with defaults and audits the creation", async () => {
    const res = await post({ name: "Service Desk", type: "DEPARTMENT", manager_id: "lead", import_ref: "dir:desk" });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data).toMatchObject({ name: "Service Desk", type: "DEPARTMENT", manager_id: "lead", import_ref: "dir:desk", auto_assign: "OFF", members: [] });
    expect(world.audits).toEqual([expect.objectContaining({ action: "CREATE", entityId: data.id })]);
  });

  it("is refused for an agent token (MANAGER+ only) and touches nothing", async () => {
    world.role = "AGENT";
    expect((await post({ name: "Service Desk" })).status).toBe(403);
    expect(world.groups).toEqual([]);
  });

  it("409 for a duplicate name (with the existing id) or import_ref, 422 for a manager who is not an active agent", async () => {
    await post({ name: "Service Desk", import_ref: "dir:desk" });
    const dupName = await post({ name: "Service Desk" });
    expect(dupName.status).toBe(409);
    expect((await dupName.json()).error.details).toEqual({ id: "g1" });
    expect((await post({ name: "Other", import_ref: "dir:desk" })).status).toBe(409);
    world.users.set("portal", { role: "USER", isActive: true, email: "p@example.test" });
    world.users.set("gone", { role: "AGENT", isActive: false, email: "g@example.test" });
    for (const manager_id of ["portal", "gone", "nobody"]) {
      expect((await post({ name: `Team ${manager_id}`, manager_id })).status).toBe(422);
    }
  });
});

describe("PATCH /groups/{id}", () => {
  beforeEach(async () => { await post({ name: "Service Desk", import_ref: "dir:desk" }); world.audits = []; });

  it("writes only what changed, reports it, and clears with null", async () => {
    const res = await patch("g1", { description: "First line", email: "desk@example.test" });
    expect(res.status).toBe(200);
    expect((await res.json()).meta.changed).toEqual(["description", "email"]);
    expect(world.audits).toHaveLength(1);
    const cleared = await patch("g1", { description: null, import_ref: null });
    expect((await cleared.json()).data).toMatchObject({ description: null, import_ref: null });
  });

  it("an unchanged body writes nothing and no audit row", async () => {
    const res = await patch("g1", { name: "Service Desk", type: "TEAM" });
    expect((await res.json()).meta.changed).toEqual([]);
    expect(world.audits).toEqual([]);
  });

  it("404 for an unknown group, 409 when the name is another group's, 403 for an agent", async () => {
    expect((await patch("nope", { name: "X Team" })).status).toBe(404);
    await post({ name: "Network" });
    expect((await patch("g1", { name: "Network" })).status).toBe(409);
    world.role = "AGENT";
    expect((await patch("g1", { name: "Renamed" })).status).toBe(403);
  });
});

describe("DELETE /groups/{id}", () => {
  beforeEach(async () => { await post({ name: "Service Desk" }); world.audits = []; });

  it("deletes an unreferenced group and audits it", async () => {
    const res = await del("g1");
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ id: "g1", deleted: true });
    expect(world.groups).toEqual([]);
    expect(world.audits).toEqual([expect.objectContaining({ action: "DELETE", entityId: "g1" })]);
  });

  it.each([
    ["categories"], ["services"], ["catalog_items"], ["stages"], ["visibility"], ["tickets"], ["problems"], ["changes"], ["assets"],
    ["releases"], ["change_templates"], ["recurring_tickets"], ["on_call_schedules"], ["freeze_windows"], ["automation_rules"],
  ])("409 with a hint while %s still point at the group, and nothing is deleted", async (kind) => {
    world.counts[kind] = 3;
    const res = await del("g1");
    expect(res.status).toBe(409);
    const { error } = await res.json();
    expect(error.details.code).toBe("GROUP_IN_USE");
    expect(Object.values(error.details.references)).toEqual([3]);
    expect(error.details.hint).toBeTruthy();
    expect(world.groups).toHaveLength(1);
    expect(world.audits).toEqual([]);
  });

  it("404 for an unknown group; an agent token is refused", async () => {
    expect((await del("nope")).status).toBe(404);
    world.role = "AGENT";
    expect((await del("g1")).status).toBe(403);
    expect(world.groups).toHaveLength(1);
  });
});

describe("PUT /groups/ref/{ref}", () => {
  it("creates (201) on a new reference, needs a name then, and is idempotent afterwards", async () => {
    expect((await put("dir:desk", { description: "x" })).status).toBe(422);
    const created = await put("dir:desk", { name: "Service Desk", type: "DEPARTMENT" });
    expect(created.status).toBe(201);
    expect((await created.json()).meta).toMatchObject({ created: true });
    expect(world.audits).toHaveLength(1);
    const again = await put("dir:desk", { name: "Service Desk", type: "DEPARTMENT" });
    expect(again.status).toBe(200);
    expect((await again.json()).meta).toEqual({ created: false, changed: [] });
    expect(world.audits).toHaveLength(1);
    const changed = await put("dir:desk", { description: "First line" });
    expect((await changed.json()).meta.changed).toEqual(["description"]);
  });

  it("409 when the name belongs to another group, 422 for an invalid reference, 403 for an agent", async () => {
    await post({ name: "Service Desk" });
    const taken = await put("dir:other", { name: "Service Desk" });
    expect(taken.status).toBe(409);
    expect((await taken.json()).error.details).toEqual({ id: "g1" });
    expect((await put("has space", { name: "Whatever" })).status).toBe(422);
    world.role = "AGENT";
    expect((await put("dir:x", { name: "Whatever" })).status).toBe(403);
  });
});
