import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-level check of the MANAGER+ gate on the configuration endpoints and of the
 * pre-approval rule for STANDARD change templates. The database is replaced by a
 * proxy that throws, so a 403 proves the handler refused before touching any data.
 */

const guard = vi.hoisted(() => ({ role: "AGENT" }));

vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {
      changeTemplate: {
        findUnique: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => ({
          id: "t1", summary: null, description: "", reason: null, importRef: null, createdAt: new Date(0), updatedAt: new Date(0),
          categoryId: null, serviceId: null, groupId: null, isActive: true, priority: "MEDIUM", impact: "MEDIUM", ...data,
        }),
      },
    },
    { get: (target, key: string) => { if (key in target) return target[key as keyof typeof target]; throw new Error("database touched: " + key); } },
  ),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/audit", () => ({ writeAudit: async () => {} }));
vi.mock("@/app/api/v1/_itsm", async (importActual) => ({
  ...(await importActual<typeof import("@/app/api/v1/_itsm")>()),
  agentGuard: async () => ({ principal: { userId: "u1", role: guard.role, tokenId: "t1" } }),
}));

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

const ctx = { params: Promise.resolve({ id: "x", ref: "r:1" }) };
const call = (h: Handler, method: string, body: unknown = {}) =>
  h(new Request("http://localhost/api/v1/x", { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } }), ctx);

async function writeHandlers() {
  const [ci, cir, cii, ct, cti, ctr, co, coi, cor, v, vi_, vr, ca, cai] = await Promise.all([
    import("@/app/api/v1/catalog-items/route"),
    import("@/app/api/v1/catalog-items/ref/[ref]/route"),
    import("@/app/api/v1/catalog-items/[id]/route"),
    import("@/app/api/v1/change-templates/route"),
    import("@/app/api/v1/change-templates/[id]/route"),
    import("@/app/api/v1/change-templates/ref/[ref]/route"),
    import("@/app/api/v1/contracts/route"),
    import("@/app/api/v1/contracts/[id]/route"),
    import("@/app/api/v1/contracts/ref/[ref]/route"),
    import("@/app/api/v1/vendors/route"),
    import("@/app/api/v1/vendors/[id]/route"),
    import("@/app/api/v1/vendors/ref/[ref]/route"),
    import("@/app/api/v1/categories/route"),
    import("@/app/api/v1/categories/[id]/route"),
  ]);
  const h: Record<string, [Handler, string]> = {
    "POST /catalog-items": [ci.POST, "POST"],
    "PUT /catalog-items/ref": [cir.PUT, "PUT"],
    "PATCH /catalog-items/id": [cii.PATCH, "PATCH"],
    "DELETE /catalog-items/id": [cii.DELETE, "DELETE"],
    "POST /change-templates": [ct.POST, "POST"],
    "PATCH /change-templates/id": [cti.PATCH, "PATCH"],
    "DELETE /change-templates/id": [cti.DELETE, "DELETE"],
    "PUT /change-templates/ref": [ctr.PUT, "PUT"],
    "POST /contracts": [co.POST, "POST"],
    "PATCH /contracts/id": [coi.PATCH, "PATCH"],
    "DELETE /contracts/id": [coi.DELETE, "DELETE"],
    "PUT /contracts/ref": [cor.PUT, "PUT"],
    "POST /vendors": [v.POST, "POST"],
    "PATCH /vendors/id": [vi_.PATCH, "PATCH"],
    "DELETE /vendors/id": [vi_.DELETE, "DELETE"],
    "PUT /vendors/ref": [vr.PUT, "PUT"],
    "POST /categories": [ca.POST, "POST"],
    "PATCH /categories/id": [cai.PATCH, "PATCH"],
  } as unknown as Record<string, [Handler, string]>;
  return h;
}

beforeEach(() => {
  guard.role = "AGENT";
});

describe("manager-only configuration endpoints", () => {
  it("refuse a plain agent's token on every write, before reading any data", async () => {
    const handlers = await writeHandlers();
    for (const [name, [handler, method]] of Object.entries(handlers)) {
      const res = await call(handler, method);
      expect(res.status, name).toBe(403);
      expect(((await res.json()) as { error: { message: string } }).error.message, name).toMatch(/manager or admin/);
    }
  });
});

describe("pre-approved (STANDARD) change templates", () => {
  const template = {
    name: "Patch servers", title: "Patch servers", type: "STANDARD", risk: "HIGH",
    implementation_plan: "1. Patch", rollback_plan: "Restore",
  };

  it("cannot be created at HIGH risk by a manager", async () => {
    guard.role = "MANAGER";
    const { POST } = await import("@/app/api/v1/change-templates/route");
    const res = await call(POST as unknown as Handler, "POST", template);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/approve changes of this risk/);
  });

  it("cannot be created through the upsert at HIGH risk by a manager", async () => {
    guard.role = "MANAGER";
    const { PUT } = await import("@/app/api/v1/change-templates/ref/[ref]/route");
    const res = await call(PUT as unknown as Handler, "PUT", template);
    expect(res.status).toBe(403);
  });

  it("may be created at MEDIUM risk by a manager, and at HIGH risk by an admin", async () => {
    const { POST } = await import("@/app/api/v1/change-templates/route");
    guard.role = "MANAGER";
    expect((await call(POST as unknown as Handler, "POST", { ...template, risk: "MEDIUM" })).status).toBe(201);
    guard.role = "ADMIN";
    expect((await call(POST as unknown as Handler, "POST", template)).status).toBe(201);
  });

  it("needs the type on create", async () => {
    guard.role = "ADMIN";
    const { POST } = await import("@/app/api/v1/change-templates/route");
    const { type: _type, ...withoutType } = template;
    const res = await call(POST as unknown as Handler, "POST", withoutType);
    expect(res.status).toBe(422);
  });
});
