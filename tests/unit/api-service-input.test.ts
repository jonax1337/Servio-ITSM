import { describe, expect, it } from "vitest";
import {
  changedServiceColumns,
  duplicates,
  serviceCreateSchema,
  serviceData,
  servicePatchSchema,
  serviceUpsertSchema,
} from "@/lib/api-service-input";
import { serviceLabel } from "@/lib/service-label";

describe("serviceCreateSchema", () => {
  it("accepts a full service with links", () => {
    const parsed = serviceCreateSchema.parse({
      name: " Email ",
      code: "S-01",
      status: "OPERATIONAL",
      criticality: "HIGH",
      asset_ids: ["a1", "a2"],
      depends_on: [{ service_id: "s2" }, { service_ref: "catalog:dns", note: "name resolution" }],
      import_ref: "catalog:mail",
    });
    expect(parsed.name).toBe("Email");
    expect(parsed.depends_on).toEqual([{ service_id: "s2" }, { service_ref: "catalog:dns", note: "name resolution" }]);
  });

  it("rejects unknown fields (strict snake_case)", () => {
    expect(serviceCreateSchema.safeParse({ name: "Email", categoryId: "c1" }).success).toBe(false);
    expect(serviceCreateSchema.safeParse({ name: "Email", owner: "u1" }).success).toBe(false);
  });

  it("requires a name and validates the enums", () => {
    expect(serviceCreateSchema.safeParse({ code: "S-01" }).success).toBe(false);
    expect(serviceCreateSchema.safeParse({ name: "E" }).success).toBe(false);
    expect(serviceCreateSchema.safeParse({ name: "Email", status: "BROKEN" }).success).toBe(false);
    expect(serviceCreateSchema.safeParse({ name: "Email", criticality: "EXTREME" }).success).toBe(false);
  });

  it("validates the service number format", () => {
    expect(serviceCreateSchema.safeParse({ name: "Email", code: "S-01" }).success).toBe(true);
    expect(serviceCreateSchema.safeParse({ name: "Email", code: "IT/NET.2" }).success).toBe(true);
    expect(serviceCreateSchema.safeParse({ name: "Email", code: "-01" }).success).toBe(false);
    expect(serviceCreateSchema.safeParse({ name: "Email", code: "S 01" }).success).toBe(false);
    expect(serviceCreateSchema.safeParse({ name: "Email", code: "x".repeat(33) }).success).toBe(false);
  });

  it("validates the import ref like the other origin keys", () => {
    expect(serviceCreateSchema.safeParse({ name: "Email", import_ref: "catalog/mail" }).success).toBe(false);
    expect(serviceCreateSchema.safeParse({ name: "Email", import_ref: "catalog:mail" }).success).toBe(true);
  });

  it("needs exactly one of service_id or service_ref per dependency", () => {
    expect(serviceCreateSchema.safeParse({ name: "Email", depends_on: [{}] }).success).toBe(false);
    expect(serviceCreateSchema.safeParse({ name: "Email", depends_on: [{ service_id: "s1", service_ref: "x:y" }] }).success).toBe(false);
    expect(serviceCreateSchema.safeParse({ name: "Email", depends_on: [{ service_id: "s1", kind: "hard" }] }).success).toBe(false);
  });
});

describe("servicePatchSchema / serviceUpsertSchema", () => {
  it("refuses an empty body", () => {
    expect(servicePatchSchema.safeParse({}).success).toBe(false);
    expect(serviceUpsertSchema.safeParse({}).success).toBe(false);
  });

  it("allows clearing the optional fields and the link sets", () => {
    expect(servicePatchSchema.parse({ code: null, owner_id: null, asset_ids: [], depends_on: [] })).toEqual({
      code: null, owner_id: null, asset_ids: [], depends_on: [],
    });
  });

  it("does not accept import_ref in an update (the ref is the path)", () => {
    expect(servicePatchSchema.safeParse({ import_ref: "x:y" }).success).toBe(false);
    expect(serviceUpsertSchema.safeParse({ name: "Email", import_ref: "x:y" }).success).toBe(false);
  });
});

describe("serviceData / changedServiceColumns", () => {
  it("maps only the fields sent to their columns", () => {
    expect(serviceData({ code: "", category_id: "c1", description: "" })).toEqual({ code: null, categoryId: "c1", description: null });
  });

  it("reports nothing changed for the same facts (idempotent upsert)", () => {
    const before = { name: "Email", code: "S-01", description: null, status: "OPERATIONAL", categoryId: null };
    expect(changedServiceColumns(before, serviceData({ name: "Email", code: "S-01", description: "", status: "OPERATIONAL", category_id: null }))).toEqual([]);
    expect(changedServiceColumns(before, serviceData({ name: "Email", status: "DEGRADED" }))).toEqual(["status"]);
  });
});

describe("duplicates", () => {
  it("names each repeated id once", () => {
    expect(duplicates(["a", "b", "a", "a", "c", "b"])).toEqual(["a", "b"]);
    expect(duplicates(["a", "b"])).toEqual([]);
  });
});

describe("serviceLabel", () => {
  it("puts the service number in front when there is one", () => {
    expect(serviceLabel({ name: "Email", code: "S-01" })).toBe("S-01 · Email");
    expect(serviceLabel({ name: "Email", code: null })).toBe("Email");
  });
});
