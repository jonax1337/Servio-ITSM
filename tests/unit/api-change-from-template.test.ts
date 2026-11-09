import bcrypt from "bcryptjs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /changes with `template_id` / `template_ref`, end to end through the real handler,
 * createChangeFromTemplate and the console's submitChangeForApproval, on an in-memory database:
 * a STANDARD template's change is pre-approved by exactly the path the console uses, an inactive
 * template is refused, only what the console lets a requester override is overridable, and the
 * endpoint keeps the scope and agent gate of POST /changes.
 */

type Row = Record<string, unknown>;

const world = vi.hoisted(() => ({
  token: { raw: "servio_pat_templatetest_0123456789abcdef", hash: "", scopes: "changes:write" },
  role: "AGENT",
  templates: [] as Row[],
  changes: [] as Row[],
  freezes: [] as Row[],
  audits: [] as string[],
  knownGroups: new Set<string>(),
  knownCategories: new Set<string>(),
  knownUsers: new Set<string>(),
  knownAssets: new Set<string>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); } }));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => undefined, signOut: async () => undefined, handlers: {} }));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  checkApiRate: () => null,
  checkUploadRate: () => null,
}));
vi.mock("@/lib/audit", () => ({
  writeAudit: async (a: { summary?: string }) => { world.audits.push(a.summary ?? ""); },
  notify: async () => {},
}));
vi.mock("@/lib/db", () => {
  const nothing = async () => null;
  const model = (impl: Record<string, unknown> = {}) =>
    new Proxy(impl, { get: (target, key) => (key in target ? target[key as string] : nothing) });
  const owner = () => ({ id: "u1", email: "agent@example.test", name: "Agent", image: null, isActive: true, role: world.role });
  const full = (c: Row): Row => ({
    description: "", reason: null, implementationPlan: null, rollbackPlan: null, outcome: null, closureNotes: null, cancelReason: null,
    customFields: "{}", problemId: null, releaseId: null, plannedStart: null, plannedEnd: null, actualStart: null, actualEnd: null,
    createdAt: new Date(0), updatedAt: new Date(0), assignee: null, createdBy: null, group: null, category: null,
    approvals: [], assets: [], _count: { comments: 0 }, ...c,
  });
  const byTemplate = (where: Row) => world.templates.find((t) => (where.id ? t.id === where.id : t.importRef === where.importRef)) ?? null;
  const tables: Record<string, unknown> = {
    apiToken: model({
      findMany: async () => [{ id: "tok", userId: "u1", tokenHash: world.token.hash, scopes: world.token.scopes, expiresAt: null }],
    }),
    user: model({
      findUnique: async () => owner(),
      findFirst: async ({ where }: { where: { id: string } }) => (world.knownUsers.has(where.id) ? { id: where.id } : null),
    }),
    changeTemplate: model({ findUnique: async ({ where }: { where: Row }) => byTemplate(where) }),
    group: model({ findUnique: async ({ where }: { where: { id: string } }) => (world.knownGroups.has(where.id) ? { id: where.id } : null) }),
    category: model({ findUnique: async ({ where }: { where: { id: string } }) => (world.knownCategories.has(where.id) ? { id: where.id } : null) }),
    customFieldDef: model({ findMany: async () => [] }),
    asset: model({ count: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.filter((id) => world.knownAssets.has(id)).length }),
    changeAsset: model({ findMany: async () => [] }),
    serviceAsset: model({ findMany: async () => [] }),
    changeFreezeWindow: model({ findMany: async () => world.freezes.map((f) => ({ ...f, service: null, group: null })) }),
    change: model({
      create: async ({ data }: { data: Row }) => {
        const { assets: _assets, ...columns } = data;
        const row = full({ id: 7, ...columns });
        world.changes.push(row);
        return { id: 7, title: row.title };
      },
      findUnique: async ({ where }: { where: { id: number } }) => {
        const c = world.changes.find((r) => r.id === where.id);
        return c ? { ...c, template: c.templateId ? byTemplate({ id: c.templateId }) : null } : null;
      },
      findUniqueOrThrow: async ({ where }: { where: { id: number } }) => world.changes.find((r) => r.id === where.id),
      updateMany: async ({ where, data }: { where: { id: number; status: string }; data: Row }) => {
        const c = world.changes.find((r) => r.id === where.id && r.status === where.status);
        if (!c) return { count: 0 };
        Object.assign(c, data);
        return { count: 1 };
      },
    }),
  };
  const db: Record<string, unknown> = new Proxy(tables, {
    get: (target, key) => {
      if (typeof key !== "string" || key === "then") return undefined;
      return (target[key] ??= model());
    },
  });
  return { db };
});

const standardTemplate = (over: Row = {}): Row => ({
  id: "tpl-std", name: "Rotate certificate", isActive: true, type: "STANDARD", title: "Rotate the certificate", description: "Replace the expiring certificate.",
  reason: "Certificate expires soon", implementationPlan: "Install the new certificate", rollbackPlan: "Reinstall the old certificate",
  risk: "LOW", priority: "MEDIUM", impact: "LOW", categoryId: null, groupId: null, serviceId: null, importRef: "tpl:rotate-cert", ...over,
});

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
let POST: Handler;

async function create(body: unknown) {
  const res = await POST(
    new Request("http://localhost/api/v1/changes", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { authorization: `Bearer ${world.token.raw}`, "content-type": "application/json" },
    }),
    { params: Promise.resolve({}) },
  );
  return { status: res.status, json: (await res.json()) as { data?: Row; meta?: Row; error?: { message: string; details?: Record<string, string[]> } } };
}

beforeAll(async () => {
  world.token.hash = bcrypt.hashSync(world.token.raw, 4);
  POST = (await import("@/app/api/v1/changes/route")).POST as Handler;
}, 60_000);

beforeEach(() => {
  world.role = "AGENT";
  world.token.scopes = "changes:write";
  world.templates = [standardTemplate(), standardTemplate({ id: "tpl-off", importRef: "tpl:off", isActive: false }), standardTemplate({
    id: "tpl-normal", importRef: "tpl:normal", type: "NORMAL", risk: "MEDIUM", impact: "MEDIUM", title: "Upgrade the platform",
  })];
  world.changes = [];
  world.freezes = [];
  world.audits = [];
  world.knownGroups = new Set(["g1"]);
  world.knownCategories = new Set(["c1"]);
  world.knownUsers = new Set(["u2"]);
  world.knownAssets = new Set(["a1"]);
});

describe("a STANDARD template through the API", () => {
  it("creates a STANDARD change that is pre-approved by the console's own path", async () => {
    const { status, json } = await create({ template_id: "tpl-std" });
    expect(status).toBe(201);
    expect(json.data).toMatchObject({
      type: "STANDARD", status: "APPROVED", template_id: "tpl-std", title: "Rotate the certificate", risk: "LOW", impact: "LOW",
      implementation_plan: "Install the new certificate", rollback_plan: "Reinstall the old certificate", approvals: [],
    });
    expect(json.meta).toEqual({ template_id: "tpl-std", pre_approved: true });
    expect(world.audits).toContain("Standard change auto-approved (pre-authorized)");
    expect(world.changes[0]).toMatchObject({ templateId: "tpl-std", createdById: "u1", status: "APPROVED" });
  });

  it("finds the template by its import_ref as well", async () => {
    const { status, json } = await create({ template_ref: "tpl:rotate-cert" });
    expect(status).toBe(201);
    expect(json.data).toMatchObject({ template_id: "tpl-std", status: "APPROVED" });
  });

  it("keeps a change that falls into a freeze window as a draft and says why", async () => {
    world.freezes = [{ id: "f1", name: "Year-end freeze", startsAt: new Date("2026-12-20T00:00:00Z"), endsAt: new Date("2027-01-02T00:00:00Z"), serviceId: null, groupId: null }];
    const { status, json } = await create({ template_id: "tpl-std", planned_start: "2026-12-24T10:00:00Z", planned_end: "2026-12-24T11:00:00Z" });
    expect(status).toBe(201);
    expect(json.data).toMatchObject({ status: "DRAFT", template_id: "tpl-std" });
    expect(json.meta).toMatchObject({ pre_approved: false });
    expect(String(json.meta?.approval_error)).toMatch(/Year-end freeze/);
    expect(world.audits).not.toContain("Standard change auto-approved (pre-authorized)");
  });

  it("refuses an inactive template and creates nothing", async () => {
    const { status, json } = await create({ template_id: "tpl-off" });
    expect(status).toBe(409);
    expect(json.error?.message).toMatch(/switched off/);
    expect(world.changes).toEqual([]);
  });

  it("refuses an unknown template and both references at once", async () => {
    expect((await create({ template_id: "nope" })).json.error?.details).toEqual({ template_id: ["Unknown change template."] });
    expect((await create({ template_ref: "nope" })).json.error?.details).toEqual({ template_ref: ["Unknown change template."] });
    const both = await create({ template_id: "tpl-std", template_ref: "tpl:rotate-cert" });
    expect(both.status).toBe(422);
    expect(world.changes).toEqual([]);
  });

  it("is not a way to get a STANDARD change without a template", async () => {
    const { status, json } = await create({ title: "Hand-made standard", type: "STANDARD" });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(json.error?.message ?? JSON.stringify(json.error)).toMatch(/approved template|type/i);
    expect(world.changes).toEqual([]);
  });
});

describe("overrides", () => {
  it("accepts what the console lets a requester change", async () => {
    const { status, json } = await create({
      template_id: "tpl-std",
      title: "Rotate the certificate of the portal",
      description: "Portal only",
      reason: "Planned renewal",
      priority: "HIGH",
      group_id: "g1",
      category_id: "c1",
      assignee_id: "u2",
      planned_start: "2026-12-01T10:00:00Z",
      planned_end: "2026-12-01T11:00:00Z",
      asset_ids: ["a1"],
      custom_fields: { ticket: 42 },
    });
    expect(status).toBe(201);
    expect(world.changes[0]).toMatchObject({
      title: "Rotate the certificate of the portal", description: "Portal only", reason: "Planned renewal", priority: "HIGH",
      groupId: "g1", categoryId: "c1", assigneeId: "u2", customFields: JSON.stringify({ ticket: "42" }),
    });
    expect(json.data).toMatchObject({ status: "APPROVED", planned_start: "2026-12-01T10:00:00.000Z" });
  });

  it("can clear the template's team with null", async () => {
    world.templates = [standardTemplate({ groupId: "g1" })];
    await create({ template_id: "tpl-std", group_id: null });
    expect(world.changes[0]).toMatchObject({ groupId: null });
  });

  it("refuses to edit the procedure a STANDARD template fixes, instead of dropping the edit silently", async () => {
    for (const field of [{ risk: "HIGH" }, { impact: "HIGH" }, { implementation_plan: "Do it differently" }, { rollback_plan: "Skip" }, { type: "NORMAL" }]) {
      const { status, json } = await create({ template_id: "tpl-std", ...field });
      expect(status).toBe(422);
      expect(Object.keys(json.error?.details ?? {})).toEqual(Object.keys(field));
    }
    expect(world.changes).toEqual([]);
  });

  it("accepts the template's own values for those fields", async () => {
    const { status } = await create({ template_id: "tpl-std", risk: "LOW", impact: "LOW", type: "STANDARD", implementation_plan: "Install the new certificate" });
    expect(status).toBe(201);
  });

  it("lets a NORMAL template's change differ in risk, impact and plans, and leaves it a draft for the CAB", async () => {
    const { status, json } = await create({ template_id: "tpl-normal", risk: "HIGH", impact: "HIGH", rollback_plan: "Restore the snapshot" });
    expect(status).toBe(201);
    expect(json.data).toMatchObject({ type: "NORMAL", status: "DRAFT", risk: "HIGH", impact: "HIGH", rollback_plan: "Restore the snapshot", template_id: "tpl-normal" });
    expect(json.meta).toEqual({ template_id: "tpl-normal", pre_approved: false });
    expect((await create({ template_id: "tpl-normal", type: "STANDARD" })).status).toBe(422);
  });

  it("answers unknown references with a 422 before creating anything", async () => {
    const { status, json } = await create({ template_id: "tpl-std", assignee_id: "ghost", group_id: "nogroup", category_id: "nocat" });
    expect(status).toBe(422);
    expect(Object.keys(json.error?.details ?? {}).sort()).toEqual(["assignee_id", "category_id", "group_id"]);
    expect((await create({ template_id: "tpl-std", asset_ids: ["missing"] })).json.error?.details).toEqual({ asset_ids: ["One of the affected configuration items does not exist."] });
    expect(world.changes).toEqual([]);
  });

  it("needs a title only without a template and rejects unknown fields as before", async () => {
    expect((await create({})).status).toBe(422);
    expect((await create({ template_id: "tpl-std", rollback_plna: "x" })).status).toBe(422);
  });
});

describe("who may do it", () => {
  it("needs the changes:write scope, like POST /changes", async () => {
    for (const scopes of ["tickets:write", "changes:read", "catalog:read", "catalog:write"]) {
      world.token.scopes = scopes;
      const { status, json } = await create({ template_id: "tpl-std" });
      expect(status).toBe(403);
      expect(json.error?.details).toEqual({ required_scope: "changes:write" });
    }
    expect(world.changes).toEqual([]);
  });

  it("needs no catalog scope to use a template (the server reads it itself)", async () => {
    world.token.scopes = "changes:write";
    expect((await create({ template_ref: "tpl:rotate-cert" })).status).toBe(201);
  });

  it("is open to the legacy write scope and to nothing weaker", async () => {
    world.token.scopes = "write";
    expect((await create({ template_id: "tpl-std" })).status).toBe(201);
    world.token.scopes = "read";
    expect((await create({ template_id: "tpl-std" })).status).toBe(403);
  });

  it("refuses a token whose owner is not an agent, even with the scope", async () => {
    world.role = "USER";
    const { status } = await create({ template_id: "tpl-std" });
    expect(status).toBe(403);
    expect(world.changes).toEqual([]);
  });
});
