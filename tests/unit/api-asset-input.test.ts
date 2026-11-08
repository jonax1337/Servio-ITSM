import { describe, expect, it } from "vitest";
import {
  assetCreateSchema,
  assetData,
  assetPatchSchema,
  assetReferences,
  assetUpsertSchema,
  changedAssetFields,
  licenseAssignSchema,
  licenseCreateSchema,
  licenseForm,
  licensePatchSchema,
  relationCreateSchema,
  vendorPatchSchema,
} from "@/lib/api-asset-input";

describe("asset bodies", () => {
  it("accept every asset field on create, with POST's defaults", () => {
    const b = assetCreateSchema.parse({ name: "pc-042", serial: "SN1", macAddress: "aa:bb", ramGb: 16, purchaseDate: "2024-05-01", importRef: "inventory:host:pc-042" });
    expect(b).toMatchObject({ type: "SERVER", status: "IN_USE", serial: "SN1", ramGb: 16, importRef: "inventory:host:pc-042" });
  });

  it("treat an empty string as no value", () => {
    expect(assetPatchSchema.parse({ serial: "  " }).serial).toBeNull();
  });

  it("let PATCH clear nullable fields but not the name", () => {
    expect(assetPatchSchema.parse({ warrantyEnd: null, ownerId: null })).toEqual({ warrantyEnd: null, ownerId: null });
    expect(assetPatchSchema.safeParse({ name: null }).success).toBe(false);
    expect(assetPatchSchema.safeParse({}).success).toBe(false);
  });

  it("reject negative sizes and bad dates", () => {
    expect(assetPatchSchema.safeParse({ ramGb: -1 }).success).toBe(false);
    expect(assetPatchSchema.safeParse({ purchaseDate: "05/01/2024" }).success).toBe(false);
    expect(assetPatchSchema.safeParse({ lastSeenAt: "2026-11-07T21:00:00+01:00" }).success).toBe(true);
  });

  it("make the sync upsert strict, so a typo fails instead of being dropped", () => {
    expect(assetUpsertSchema.safeParse({ name: "pc-042", ram: 16 }).success).toBe(false);
    expect(assetUpsertSchema.safeParse({ ramGb: 16 }).success).toBe(true);
  });
});

describe("asset helpers", () => {
  it("turn ISO strings into Dates and leave the rest", () => {
    const d = assetData({ purchaseDate: "2024-05-01", lastSeenAt: null, name: "x" });
    expect(d.purchaseDate).toBeInstanceOf(Date);
    expect(d.lastSeenAt).toBeNull();
    expect(d.name).toBe("x");
  });

  it("report only the fields whose value changes (dates compared by instant)", () => {
    const before = { ramGb: 16, purchaseDate: new Date("2024-05-01"), notes: null };
    expect(changedAssetFields(before, assetData({ ramGb: 16, purchaseDate: "2024-05-01", notes: null }))).toEqual([]);
    expect(changedAssetFields(before, assetData({ ramGb: 32, notes: "x" }))).toEqual(["ramGb", "notes"]);
  });

  it("pick the referenced ids to check", () => {
    expect(assetReferences({ ownerId: "u1", groupId: null, locationId: "" })).toEqual({ ownerId: "u1", groupId: null, locationId: null });
  });
});

describe("relation, vendor and license bodies", () => {
  it("default a relation to DEPENDS_ON and know the types", () => {
    expect(relationCreateSchema.parse({ target_id: "a2" }).type).toBe("DEPENDS_ON");
    expect(relationCreateSchema.safeParse({ target_id: "a2", type: "LIKES" }).success).toBe(false);
  });

  it("validate vendor email and refuse an empty PATCH", () => {
    expect(vendorPatchSchema.safeParse({ email: "no-mail" }).success).toBe(false);
    expect(vendorPatchSchema.safeParse({}).success).toBe(false);
  });

  it("default a license to one per-user seat", () => {
    expect(licenseCreateSchema.parse({ name: "opsi Basic" })).toMatchObject({ license_type: "PER_USER", seats: 1 });
  });

  it("need a target for a seat", () => {
    expect(licenseAssignSchema.safeParse({}).success).toBe(false);
    expect(licenseAssignSchema.safeParse({ asset_id: "a1" }).success).toBe(true);
  });

  it("build the full license form from the current row plus the PATCH", () => {
    const current = { name: "opsi", vendorId: "v1", contractId: null, ownerId: null, licenseType: "PER_DEVICE", seats: 1, expiresAt: new Date("2027-01-31"), cost: 0, notes: null };
    const form = licenseForm(current, licensePatchSchema.parse({ seats: 25, notes: null }));
    expect(form).toEqual({ name: "opsi", vendorId: "v1", contractId: "", ownerId: "", licenseType: "PER_DEVICE", seats: "25", expiresAt: "2027-01-31", cost: "0", notes: "" });
  });
});
