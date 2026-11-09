import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Catalog items restricted to groups: the rule (`lib/catalog-visibility.ts`) and the places that must
 * apply it on the server - ordering (`createCatalogRequestFor`, which the form, the re-request and the
 * assistant's order all go through) and the portal assistant's catalog tools.
 */

const db = vi.hoisted(() => ({
  catalogItem: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
  ticket: { create: vi.fn() },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/auth", () => ({ auth: async () => null, signIn: async () => undefined, signOut: async () => undefined, handlers: {} }));
vi.mock("@/lib/audit", () => ({ writeAudit: async () => {}, notify: async () => {} }));

import { catalogVisibleToWhere, canSeeCatalogItem, portalCatalogItemWhere } from "@/lib/catalog-visibility";
import { PORTAL_CATALOG_ITEM_WHERE } from "@/lib/categories";
import { createCatalogRequestFor } from "@/lib/portal-tickets";
import { buildPortalTools } from "@/lib/portal-assistant";

beforeEach(() => vi.resetAllMocks());

describe("catalogVisibleToWhere", () => {
  it("lets through unrestricted items and items listing a group the user belongs to - nothing else", () => {
    expect(catalogVisibleToWhere("u1")).toEqual({
      OR: [{ restrictToGroups: false }, { visibleTo: { some: { group: { members: { some: { userId: "u1" } } } } } }],
    });
  });
});

describe("portalCatalogItemWhere", () => {
  it("keeps the published / staff-only-category filter and adds the visibility rule under AND", () => {
    const where = portalCatalogItemWhere("u1");
    expect(where).toMatchObject(PORTAL_CATALOG_ITEM_WHERE);
    expect(where.AND).toEqual([catalogVisibleToWhere("u1")]);
  });

  it("cannot be overridden by the search terms callers add under OR", () => {
    const where = { ...portalCatalogItemWhere("u1"), OR: [{ name: { contains: "x" } }] };
    expect(where.AND).toEqual([catalogVisibleToWhere("u1")]);
  });
});

describe("canSeeCatalogItem", () => {
  it("asks the database with the user's visibility filter", async () => {
    db.catalogItem.findFirst.mockResolvedValue({ id: "c1" });
    expect(await canSeeCatalogItem("c1", "u1")).toBe(true);
    expect(db.catalogItem.findFirst).toHaveBeenCalledWith({ where: { id: "c1", ...catalogVisibleToWhere("u1") }, select: { id: true } });
  });

  it("is false when the item is hidden from the user or does not exist", async () => {
    db.catalogItem.findFirst.mockResolvedValue(null);
    expect(await canSeeCatalogItem("c1", "u2")).toBe(false);
  });
});

describe("ordering a restricted item", () => {
  const me = { id: "u2", email: "u2@example.test", name: "Two" };
  const item = { id: "c1", name: "New employee", isPublished: true, formSchema: "[]", requiresApproval: false };

  it("is refused as forbidden, before any ticket is created", async () => {
    db.catalogItem.findUnique.mockResolvedValue(item);
    db.catalogItem.findFirst.mockResolvedValue(null); // not in a listed group
    const result = await createCatalogRequestFor(me, "c1", {});
    expect(result).toEqual({ ok: false, error: "This item can't be requested.", forbidden: true });
    expect(db.ticket.create).not.toHaveBeenCalled();
  });

  it("answers an unknown or unpublished item with the same message but not as forbidden", async () => {
    db.catalogItem.findUnique.mockResolvedValue(null);
    expect(await createCatalogRequestFor(me, "nope", {})).toEqual({ ok: false, error: "This item can't be requested." });
    db.catalogItem.findUnique.mockResolvedValue({ ...item, isPublished: false });
    expect(await createCatalogRequestFor(me, "c1", {})).toEqual({ ok: false, error: "This item can't be requested." });
  });
});

describe("the portal assistant's catalog tools", () => {
  type Exec<T> = { execute: (input: T, opts: never) => Promise<unknown> };
  const tools = () => buildPortalTools("u2") as unknown as {
    search_catalog: Exec<{ query: string }>;
    get_service_form: Exec<{ itemId: string }>;
    propose_service_request: Exec<{ itemId: string; answers: { key: string; value: string }[] }>;
  };
  const run = <T>(t: Exec<T>, input: T) => t.execute(input, {} as never);

  it("search_catalog only searches what this user may see", async () => {
    db.catalogItem.findMany.mockResolvedValue([]);
    await run(tools().search_catalog, { query: "employee" });
    const { where } = db.catalogItem.findMany.mock.calls[0][0];
    expect(where.AND).toEqual([catalogVisibleToWhere("u2")]);
    expect(where.OR).toBeDefined();
  });

  it("describes a restricted item to nobody outside its groups: get_service_form reads as unavailable", async () => {
    db.catalogItem.findFirst.mockResolvedValue(null);
    expect(await run(tools().get_service_form, { itemId: "c1" })).toEqual({ ok: false, error: "That service isn't available." });
    expect(db.catalogItem.findFirst.mock.calls[0][0].where).toEqual({ id: "c1", ...catalogVisibleToWhere("u2") });
  });

  it("does not draft an order for a restricted item", async () => {
    db.catalogItem.findFirst.mockResolvedValue(null);
    const out = (await run(tools().propose_service_request, { itemId: "c1", answers: [] })) as { ok: boolean };
    expect(out.ok).toBe(false);
  });

  it("still describes a visible item", async () => {
    db.catalogItem.findFirst.mockResolvedValue({ name: "Laptop", formSchema: "[]", isPublished: true });
    expect(await run(tools().get_service_form, { itemId: "c2" })).toMatchObject({ ok: true, service: "Laptop" });
  });
});
