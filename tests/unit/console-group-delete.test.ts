import { beforeEach, describe, expect, it, vi } from "vitest";
import { groupInUseRefusal, groupInUseText } from "@/lib/group-rules";
import { translateServerMessage } from "@/lib/i18n/translate";

/**
 * The console's delete button reuses the API's reference check: a group that is still referenced is
 * refused with the API's counts and hint (a result the confirm dialog toasts) instead of silently
 * clearing the links; a free group is deleted, audited and redirects to the list.
 */

const world = vi.hoisted(() => ({
  role: "MANAGER",
  active: true,
  groups: new Map<string, { name: string }>(),
  counts: {} as Record<string, number>,
  deleted: [] as string[],
  audits: [] as { action: string; entityId: string; summary?: string }[],
  redirected: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    world.redirected.push(to);
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => undefined, signOut: async () => undefined, handlers: {} }));
vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/session")>()),
  getCurrentUser: async () => ({ id: "u1", role: world.role, isActive: world.active }),
}));
vi.mock("@/lib/audit", () => ({
  writeAudit: async (a: { action: string; entityId: string; summary?: string }) => {
    world.audits.push(a);
  },
}));
vi.mock("@/lib/db", () => {
  const countOf = (kind: string) => async () => world.counts[kind] ?? 0;
  const db = {
    group: {
      findUnique: async ({ where }: { where: { id: string } }) => world.groups.get(where.id) ?? null,
      delete: async ({ where }: { where: { id: string } }) => {
        world.groups.delete(where.id);
        world.deleted.push(where.id);
      },
    },
    category: { count: countOf("categories") },
    service: { count: countOf("services") },
    catalogItem: { count: async (args: { where: Record<string, unknown> }) => ("groupId" in args.where ? (world.counts.catalog_items ?? 0) : 0) },
    catalogItemGroup: { count: countOf("catalog_visibility") },
    ticket: { count: countOf("open_tickets") },
    problem: { count: countOf("open_problems") },
    change: { count: countOf("open_changes") },
    asset: { count: countOf("active_assets") },
    release: { count: countOf("open_releases") },
    changeTemplate: { count: countOf("change_templates") },
    recurringTicket: { count: countOf("recurring_tickets") },
    onCallSchedule: { count: countOf("on_call_schedules") },
    changeFreezeWindow: { count: countOf("freeze_windows") },
    automationRule: { count: countOf("automation_rules") },
  };
  return { db };
});

import { deleteGroup } from "@/lib/actions/groups";

const form = (id: string) => {
  const fd = new FormData();
  fd.set("id", id);
  return fd;
};

beforeEach(() => {
  world.role = "MANAGER";
  world.active = true;
  world.groups = new Map([["g1", { name: "Network" }]]);
  world.counts = {};
  world.deleted = [];
  world.audits = [];
  world.redirected = [];
});

describe("console group delete", () => {
  it("refuses a referenced group with the API's counts and hint, and changes nothing", async () => {
    world.counts = { categories: 2, open_tickets: 5 };

    const result = await deleteGroup(form("g1"));

    expect(result).toEqual({ ok: false, error: expect.stringContaining("The group is still referenced (categories: 2, open_tickets: 5).") });
    const refusal = groupInUseRefusal({ categories: 2, open_tickets: 5 })!;
    expect((result as { error: string }).error).toContain(refusal.hint);
    expect((result as { error: string }).error).toBe(groupInUseText(refusal));
    expect(world.deleted).toEqual([]);
    expect(world.audits).toEqual([]);
    expect(world.redirected).toEqual([]);
  });

  it("applies the same rule as the API to every kind of reference", async () => {
    for (const kind of ["services", "catalog_items", "catalog_visibility", "open_problems", "open_changes", "active_assets", "automation_rules", "on_call_schedules"]) {
      world.counts = { [kind]: 1 };
      const result = await deleteGroup(form("g1"));
      expect(result, kind).toMatchObject({ ok: false, error: expect.stringContaining(`${kind}: 1`) });
    }
    expect(world.deleted).toEqual([]);
  });

  it("deletes a group nothing points at, audits it and redirects to the list", async () => {
    await expect(deleteGroup(form("g1"))).rejects.toThrow("NEXT_REDIRECT");

    expect(world.deleted).toEqual(["g1"]);
    expect(world.audits).toEqual([expect.objectContaining({ action: "DELETE", entityId: "g1", summary: 'Deleted group "Network"' })]);
    expect(world.redirected).toEqual(["/groups"]);
  });

  it("does nothing for a non-manager or an unknown group", async () => {
    world.role = "AGENT";
    expect(await deleteGroup(form("g1"))).toBeUndefined();
    world.role = "MANAGER";
    expect(await deleteGroup(form("nope"))).toBeUndefined();
    expect(world.deleted).toEqual([]);
  });
});

describe("group refusal text", () => {
  it("is translated as a whole, keeping the counts", () => {
    const text = groupInUseText(groupInUseRefusal({ categories: 2, open_tickets: 5 })!);
    const german = translateServerMessage("de", text);
    expect(german).not.toBe(text);
    expect(german).toContain("Die Gruppe wird noch referenziert (categories: 2, open_tickets: 5).");
    expect(german).not.toContain("still referenced");
  });
});
