import { beforeEach, describe, expect, it, vi } from "vitest";
import { TICKET_INCLUDE, serializeTicket } from "@/app/api/v1/_serializers";

/**
 * The catalog item a ticket was ordered from (`catalog_item`) and the `catalog_item_ref` filter of GET /tickets.
 */

const seen = vi.hoisted(() => ({ where: undefined as unknown, include: undefined as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    ticket: {
      count: async () => 0,
      findMany: async (args: { where: unknown; include: unknown }) => {
        seen.where = args.where;
        seen.include = args.include;
        return [];
      },
    },
  },
}));
vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  guard: async () => ({ principal: { userId: "u1", role: "AGENT", tokenId: "t1" } }),
}));

const row = {
  id: 7, title: "New laptop request", description: "", type: "REQUEST", prefix: "REQ", status: "NEW", priority: "MEDIUM", impact: "MEDIUM",
  urgency: "MEDIUM", source: "PORTAL", categoryId: null, serviceId: null, dueAt: null, resolvedAt: null, createdAt: new Date(0), updatedAt: new Date(0),
};

beforeEach(() => {
  seen.where = undefined;
  seen.include = undefined;
});

describe("catalog_item on a ticket", () => {
  it("names the item the ticket was ordered from, with its origin key", () => {
    const out = serializeTicket({ ...row, catalogItem: { id: "c1", name: "New laptop", importRef: "catalog:new-laptop" } });
    expect(out.catalog_item).toEqual({ id: "c1", name: "New laptop", import_ref: "catalog:new-laptop" });
  });

  it("has a null import_ref for an item without an origin key", () => {
    expect(serializeTicket({ ...row, catalogItem: { id: "c1", name: "New laptop", importRef: null } }).catalog_item).toEqual({
      id: "c1", name: "New laptop", import_ref: null,
    });
  });

  it("is null for a ticket that did not come from the catalog", () => {
    expect(serializeTicket({ ...row, catalogItem: null }).catalog_item).toBeNull();
  });

  it("is loaded by the include every ticket endpoint shares, and only the three fields are read", () => {
    expect(TICKET_INCLUDE.catalogItem).toEqual({ select: { id: true, name: true, importRef: true } });
  });
});

describe("GET /tickets?catalog_item_ref=", () => {
  async function list(query: string) {
    const { GET } = await import("@/app/api/v1/tickets/route");
    const res = await GET(new Request(`http://localhost/api/v1/tickets${query}`));
    return res.status;
  }

  it("filters by the origin key of the catalog item", async () => {
    expect(await list("?catalog_item_ref=catalog:new-laptop")).toBe(200);
    expect(seen.where).toEqual({ catalogItem: { is: { importRef: "catalog:new-laptop" } } });
    expect(seen.include).toBe(TICKET_INCLUDE);
  });

  it("adds no filter when the parameter is absent or empty", async () => {
    await list("");
    expect(seen.where).toEqual({});
    await list("?catalog_item_ref=");
    expect(seen.where).toEqual({});
  });

  it("combines with the other filters", async () => {
    await list("?status=open&catalog_item_ref=catalog:new-laptop");
    expect(seen.where).toMatchObject({ catalogItem: { is: { importRef: "catalog:new-laptop" } }, status: { in: expect.any(Array) } });
  });
});
