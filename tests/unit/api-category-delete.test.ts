import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * DELETE /categories/{id}: the MANAGER+ gate, the refusal to delete a referenced category (counts by
 * kind and a hint), audit and idempotence.
 */

type Row = Record<string, unknown>;
const world = vi.hoisted(() => ({
  categories: [] as Record<string, unknown>[],
  counts: {} as Record<string, number>,
  countWheres: [] as { kind: string; where: Record<string, unknown> }[],
  audits: [] as { action: string; entity: string; entityId: string; summary?: string }[],
  role: "MANAGER",
  scope: "",
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => undefined, signOut: async () => undefined, handlers: {} }));
vi.mock("@/lib/audit", () => ({
  writeAudit: async (a: { action: string; entity: string; entityId: string; summary?: string }) => { world.audits.push(a); },
}));
vi.mock("@/app/api/v1/_itsm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/api/v1/_itsm")>()),
  agentGuard: async (_req: Request, scope: string) => {
    world.scope = scope;
    return { principal: { userId: "mgr", role: world.role, tokenId: "t", scopes: ["write"] } };
  },
}));

vi.mock("@/lib/db", () => {
  const countOf = (kind: string) => async ({ where }: { where: Row }) => {
    world.countWheres.push({ kind, where });
    return world.counts[kind] ?? 0;
  };
  const db = {
    category: {
      findUnique: async ({ where }: { where: Row }) => world.categories.find((c) => c.id === where.id) ?? null,
      count: countOf("subcategories"),
      deleteMany: async ({ where }: { where: Row }) => {
        const before = world.categories.length;
        world.categories = world.categories.filter((c) => c.id !== where.id);
        return { count: before - world.categories.length };
      },
    },
    ticket: { count: countOf("tickets") },
    problem: { count: countOf("problems") },
    change: { count: countOf("changes") },
    service: { count: countOf("services") },
    article: { count: countOf("articles") },
    catalogItem: { count: countOf("catalog_items") },
    changeTemplate: { count: countOf("change_templates") },
    recurringTicket: { count: countOf("recurring_tickets") },
    automationRule: { count: countOf("automation_rules") },
  };
  return { db };
});

import { DELETE } from "@/app/api/v1/categories/[id]/route";
import { categoryInUseRefusal } from "@/lib/category-rules";
import { nonEmptyReferences } from "@/lib/group-rules";

const del = (id: string) => DELETE(new Request("http://x/api/v1/categories/" + id, { method: "DELETE" }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  world.categories = [{ id: "c1", name: "Hardware" }];
  world.counts = {};
  world.countWheres = [];
  world.audits = [];
  world.role = "MANAGER";
  world.scope = "";
});

describe("the delete refusal", () => {
  it("is null for a category nothing points at and lists only the kinds that count", () => {
    expect(categoryInUseRefusal(nonEmptyReferences({ tickets: 0, services: 0 }))).toBeNull();
    const refusal = categoryInUseRefusal(nonEmptyReferences({ tickets: 4, services: 0, subcategories: 1 }));
    expect(refusal).toMatchObject({ code: "CATEGORY_IN_USE", references: { tickets: 4, subcategories: 1 } });
    expect(refusal?.hint).toMatch(/archive it/);
  });
});

describe("DELETE /categories/{id}", () => {
  it("deletes an unreferenced category with the catalog:write scope and audits it", async () => {
    const res = await del("c1");
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ id: "c1", deleted: true });
    expect(world.scope).toBe("catalog:write");
    expect(world.categories).toEqual([]);
    expect(world.audits).toEqual([expect.objectContaining({ action: "DELETE", entity: "Category", entityId: "c1" })]);
  });

  it.each([
    ["subcategories"], ["tickets"], ["problems"], ["changes"], ["services"], ["articles"], ["catalog_items"],
    ["change_templates"], ["recurring_tickets"], ["automation_rules"],
  ])("409 with counts and a hint while %s still point at the category, and nothing is deleted", async (kind) => {
    world.counts[kind] = 3;
    const res = await del("c1");
    expect(res.status).toBe(409);
    const { error } = await res.json();
    expect(error.details).toMatchObject({ code: "CATEGORY_IN_USE", references: { [kind]: 3 } });
    expect(error.details.hint).toBeTruthy();
    expect(world.categories).toHaveLength(1);
    expect(world.audits).toEqual([]);
  });

  it("counts tickets, problems and changes of every status (they keep their category for reporting)", async () => {
    await del("c1");
    for (const kind of ["tickets", "problems", "changes"]) {
      expect(world.countWheres.find((c) => c.kind === kind)?.where).toEqual({ categoryId: "c1" });
    }
    expect(world.countWheres.find((c) => c.kind === "subcategories")?.where).toEqual({ parentId: "c1" });
  });

  it("404 for an unknown category; a token whose owner is no manager is refused", async () => {
    expect((await del("nope")).status).toBe(404);
    world.role = "AGENT";
    expect((await del("c1")).status).toBe(403);
    expect(world.categories).toHaveLength(1);
  });

});
