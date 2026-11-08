import { describe, expect, it } from "vitest";
import { categoryCreateSchema, categoryData, categoryPatchSchema } from "@/lib/api-category-input";
import { ticketCreateSchema } from "@/lib/api-ticket-input";
import { camelizeBody } from "@/lib/api-case";

describe("categoryCreateSchema", () => {
  it("accepts a staff-only category with a team", () => {
    const parsed = categoryCreateSchema.parse({ name: " Monitoring ", group_id: "g1", portal_hidden: true });
    expect(parsed).toEqual({ name: "Monitoring", group_id: "g1", portal_hidden: true });
  });

  it("rejects unknown keys, short names and bad colors", () => {
    expect(categoryCreateSchema.safeParse({ name: "Ok", groupId: "g1" }).success).toBe(false);
    expect(categoryCreateSchema.safeParse({ name: "A" }).success).toBe(false);
    expect(categoryCreateSchema.safeParse({ name: "Network", color: "red" }).success).toBe(false);
  });
});

describe("categoryPatchSchema", () => {
  it("refuses an empty update", () => {
    expect(categoryPatchSchema.safeParse({}).success).toBe(false);
  });

  it("allows clearing the parent and the group", () => {
    expect(categoryPatchSchema.parse({ parent_id: null, group_id: null })).toEqual({ parent_id: null, group_id: null });
  });
});

describe("categoryData", () => {
  it("maps only the fields that were sent", () => {
    expect(categoryData({ portal_hidden: true })).toEqual({ portalHidden: true });
  });

  it("maps every field to its column, clearing empty text", () => {
    expect(
      categoryData({ name: "Security", description: "", icon: "Shield", color: "#ff0000", parent_id: null, group_id: "g1", archived: false }),
    ).toEqual({ name: "Security", description: null, icon: "Shield", color: "#ff0000", parentId: null, groupId: "g1", archived: false });
  });
});

describe("ticketCreateSchema group", () => {
  it("accepts group_id in snake_case", () => {
    const normalized = camelizeBody({ title: "Disk full on db01", group_id: "g1" });
    if ("conflict" in normalized) throw new Error("unexpected key conflict");
    expect(ticketCreateSchema.parse(normalized.body).groupId).toBe("g1");
  });
});
