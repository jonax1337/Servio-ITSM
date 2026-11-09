import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  ticket: { findFirst: vi.fn() },
  article: { findUnique: vi.fn() },
  catalogItem: { findUnique: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ db }));

import { isPortalArticle, portalArticleTitle, portalCatalogItemName, portalTicketTitle, portalTicketWhere } from "@/lib/portal-access";

beforeEach(() => vi.resetAllMocks());

describe("portalTicketWhere", () => {
  it("limits a ticket to its requester and its participants", () => {
    expect(portalTicketWhere(7, "u1")).toEqual({
      id: 7,
      OR: [{ requesterId: "u1" }, { participants: { some: { userId: "u1" } } }],
    });
  });
});

describe("portalTicketTitle (page title of /portal/tickets/<id>)", () => {
  it("returns the title through the same access rule as the page", async () => {
    db.ticket.findFirst.mockResolvedValue({ title: "My printer" });
    expect(await portalTicketTitle("7", "u1")).toBe("My printer");
    expect(db.ticket.findFirst).toHaveBeenCalledWith({ where: portalTicketWhere(7, "u1"), select: { title: true } });
  });

  it("gives nothing away for a ticket of someone else (the lookup finds no row)", async () => {
    db.ticket.findFirst.mockResolvedValue(null);
    expect(await portalTicketTitle("8", "u1")).toBeNull();
  });

  it("never queries without a signed-in user or with a malformed id", async () => {
    expect(await portalTicketTitle("7", null)).toBeNull();
    expect(await portalTicketTitle("abc", "u1")).toBeNull();
    expect(await portalTicketTitle("1.5", "u1")).toBeNull();
    expect(db.ticket.findFirst).not.toHaveBeenCalled();
  });
});

describe("portal articles and catalog items", () => {
  it("shows only published public articles", () => {
    expect(isPortalArticle({ status: "PUBLISHED", visibility: "PUBLIC" })).toBe(true);
    expect(isPortalArticle({ status: "DRAFT", visibility: "PUBLIC" })).toBe(false);
    expect(isPortalArticle({ status: "PUBLISHED", visibility: "INTERNAL" })).toBe(false);
  });

  it("does not leak the title of a draft or internal article", async () => {
    db.article.findUnique.mockResolvedValue({ title: "Secret runbook", status: "DRAFT", visibility: "INTERNAL" });
    expect(await portalArticleTitle("secret")).toBeNull();
    db.article.findUnique.mockResolvedValue({ title: "VPN", status: "PUBLISHED", visibility: "PUBLIC" });
    expect(await portalArticleTitle("vpn")).toBe("VPN");
  });

  it("does not leak the name of an unpublished catalog item", async () => {
    db.catalogItem.findUnique.mockResolvedValue({ name: "Staff exit", isPublished: false });
    expect(await portalCatalogItemName("c1")).toBeNull();
    db.catalogItem.findUnique.mockResolvedValue({ name: "New laptop", isPublished: true });
    expect(await portalCatalogItemName("c2")).toBe("New laptop");
  });
});
