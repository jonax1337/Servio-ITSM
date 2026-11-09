import { describe, expect, it } from "vitest";
import {
  assetSetDiff,
  contractCreateSchema,
  contractData,
  contractDateProblem,
  contractPatchSchema,
  contractUpsertSchema,
  serializeContract,
} from "@/lib/api-contract-input";
import { CONTRACT_END_BEFORE_START } from "@/lib/contract-rules";
import { vendorCreateSchema, vendorData, vendorPatchSchema, vendorUpsertSchema } from "@/lib/api-asset-input";

describe("contractCreateSchema", () => {
  it("accepts a full contract", () => {
    const parsed = contractCreateSchema.parse({
      name: "Printer maintenance",
      number: "MA-2026-17",
      type: "MAINTENANCE",
      status: "ACTIVE",
      vendor_id: "v1",
      owner_id: "u1",
      start_date: "2026-01-01",
      end_date: "2026-12-31",
      cost: 1200.5,
      renewal_notice_days: 60,
      auto_renew: true,
      notes: "Includes toner",
      asset_ids: ["a1", "a2"],
      import_ref: "erp:contract:4711",
    });
    expect(parsed.asset_ids).toEqual(["a1", "a2"]);
  });

  it("needs a name; the start day is optional, may be null, and must be a calendar day", () => {
    expect(contractCreateSchema.safeParse({}).success).toBe(false);
    expect(contractCreateSchema.safeParse({ name: "Support" }).success).toBe(true);
    expect(contractCreateSchema.parse({ name: "Support", start_date: null }).start_date).toBeNull();
    expect(contractCreateSchema.safeParse({ name: "Support", start_date: "01.01.2026" }).success).toBe(false);
    expect(contractCreateSchema.safeParse({ name: "Support", start_date: "2026-01-01", vendorId: "v1" }).success).toBe(false);
    expect(contractCreateSchema.safeParse({ name: "Support", start_date: "2026-01-01", cost: -1 }).success).toBe(false);
    expect(contractCreateSchema.safeParse({ name: "Support", start_date: "2026-01-01", status: "PAUSED" }).success).toBe(false);
  });

  it("refuses an empty patch and a body import_ref on upsert", () => {
    expect(contractPatchSchema.safeParse({}).success).toBe(false);
    expect(contractUpsertSchema.safeParse({ import_ref: "x" }).success).toBe(false);
  });
});

describe("contractData / contractDateProblem", () => {
  it("stores days as UTC midnight and clears blanks", () => {
    expect(contractData({ start_date: "2026-03-01", end_date: null, number: " ", notes: "" })).toEqual({
      startDate: new Date("2026-03-01T00:00:00.000Z"), endDate: null, number: null, notes: null,
    });
  });

  it("checks the merged dates", () => {
    const current = { startDate: new Date("2026-03-01"), endDate: new Date("2026-12-31") };
    expect(contractDateProblem(current, contractData({ end_date: "2026-02-01" }))).toEqual({ end_date: [CONTRACT_END_BEFORE_START] });
    expect(contractDateProblem(current, contractData({ start_date: "2027-01-01" }))).toEqual({ end_date: [CONTRACT_END_BEFORE_START] });
    expect(contractDateProblem(current, contractData({ end_date: null }))).toBeNull();
    expect(contractDateProblem(null, contractData({ start_date: "2026-01-01" }))).toBeNull();
  });

  it("clears the start date with null and has no date conflict while it is unknown", () => {
    expect(contractData({ start_date: null })).toEqual({ startDate: null });
    const current = { startDate: new Date("2026-03-01"), endDate: new Date("2026-12-31") };
    expect(contractDateProblem(current, contractData({ start_date: null, end_date: "2026-02-01" }))).toBeNull();
    // A contract that never had a start accepts any end date, and a later start is still checked.
    expect(contractDateProblem({ startDate: null, endDate: null }, contractData({ end_date: "2020-01-01" }))).toBeNull();
    expect(contractDateProblem({ startDate: null, endDate: new Date("2026-12-31") }, contractData({ start_date: "2027-01-01" }))).toEqual({ end_date: [CONTRACT_END_BEFORE_START] });
  });
});

describe("assetSetDiff", () => {
  it("links and unlinks to reach the wanted set", () => {
    expect(assetSetDiff(["a", "b"], ["b", "c", "c"])).toEqual({ add: ["c"], remove: ["a"] });
    expect(assetSetDiff(["a"], ["a"])).toEqual({ add: [], remove: [] });
    expect(assetSetDiff(["a"], [])).toEqual({ add: [], remove: ["a"] });
  });
});

describe("serializeContract", () => {
  it("returns days, the expiry state and the covered assets", () => {
    const at = new Date("2026-11-21T10:00:00Z");
    const out = serializeContract(
      {
        id: "k1", name: "Support", number: null, type: "SUPPORT", status: "ACTIVE", vendorId: "v1", ownerId: null,
        startDate: new Date("2026-01-01"), endDate: new Date("2026-12-01"), cost: null, renewalNoticeDays: 30, autoRenew: false,
        notes: null, importRef: "erp:contract:1", createdAt: at, updatedAt: at,
        vendor: { id: "v1", name: "Acme" }, owner: null, assets: [{ asset: { id: "a1", name: "Printer" } }],
      },
      at,
    );
    expect(out).toMatchObject({
      start_date: "2026-01-01", end_date: "2026-12-01", expiry: "EXPIRING", vendor: { id: "v1", name: "Acme" },
      asset_ids: ["a1"], assets: [{ id: "a1", name: "Printer" }], import_ref: "erp:contract:1",
    });
  });
});

describe("serializeContract without a start date", () => {
  it("answers start_date null and still reports the expiry from the end date", () => {
    const at = new Date("2026-11-21T10:00:00Z");
    const out = serializeContract(
      {
        id: "k2", name: "Legacy", number: null, type: "SUPPORT", status: "ACTIVE", vendorId: null, ownerId: null,
        startDate: null, endDate: new Date("2026-12-01"), cost: null, renewalNoticeDays: 30, autoRenew: false,
        notes: null, importRef: null, createdAt: at, updatedAt: at,
      },
      at,
    );
    expect(out).toMatchObject({ start_date: null, end_date: "2026-12-01", expiry: "EXPIRING" });
  });
});

describe("vendor bodies", () => {
  it("take an import_ref on create, none in an upsert body, and map to columns", () => {
    expect(vendorCreateSchema.parse({ name: "Acme", import_ref: "erp:supplier:1", active: false })).toEqual({ name: "Acme", import_ref: "erp:supplier:1", active: false });
    expect(vendorUpsertSchema.safeParse({ name: "Acme", import_ref: "x" }).success).toBe(false);
    expect(vendorPatchSchema.parse({ import_ref: null })).toEqual({ import_ref: null });
    expect(vendorData({ website: "", active: true, import_ref: null })).toEqual({ website: null, isActive: true, importRef: null });
  });
});
