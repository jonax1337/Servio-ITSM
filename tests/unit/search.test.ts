import { describe, expect, it } from "vitest";
import { applyTicketSearch, ticketIdFromQuery, ticketSearchWhere } from "@/lib/search";
import type { Prisma } from "@prisma/client";

describe("ticketIdFromQuery", () => {
  it.each(["123", "#123", "INC-123", "REQ 42", "pbm-7"])("parses %s", (q) => {
    expect(ticketIdFromQuery(q)).not.toBeNull();
  });
  it.each(["openssl", "vpn broken", "", "12345678901234567890123"])("rejects %s", (q) => {
    expect(ticketIdFromQuery(q)).toBeNull();
  });
});

describe("ticketSearchWhere", () => {
  it("spans all cross-fields by default and matches the bare id", () => {
    const where = ticketSearchWhere("vpn")!;
    const or = where.OR as Prisma.TicketWhereInput[];
    expect(or.some((c) => "title" in c)).toBe(true);
    expect(or.some((c) => "description" in c)).toBe(true);
    expect(or.some((c) => "comments" in c)).toBe(true);
    expect(or.some((c) => "customFields" in c)).toBe(true);
    expect(or.some((c) => "id" in c)).toBe(false); // "vpn" isn't id-shaped
  });

  it("adds the id clause for a bare number", () => {
    const where = ticketSearchWhere("123")!;
    expect((where.OR as Prisma.TicketWhereInput[]).some((c) => "id" in c)).toBe(true);
  });

  it("can be restricted to specific fields", () => {
    const where = ticketSearchWhere("x", { fields: ["title"], matchId: false })!;
    const or = where.OR as Prisma.TicketWhereInput[];
    expect(or).toHaveLength(1);
    expect("title" in or[0]).toBe(true);
  });

  it("returns undefined for a blank query", () => {
    expect(ticketSearchWhere("")).toBeUndefined();
    expect(ticketSearchWhere("   ")).toBeUndefined();
    expect(ticketSearchWhere(null)).toBeUndefined();
  });
});

describe("applyTicketSearch", () => {
  it("narrows an existing where via AND instead of replacing it", () => {
    const where: Prisma.TicketWhereInput = { status: "OPEN" };
    const merged = applyTicketSearch(where, "vpn");
    expect(merged.status).toBe("OPEN");
    expect(Array.isArray(merged.AND)).toBe(true);
  });

  it("leaves the where untouched for a blank query", () => {
    const where: Prisma.TicketWhereInput = { status: "OPEN" };
    expect(applyTicketSearch(where, "  ")).toBe(where);
  });
});
