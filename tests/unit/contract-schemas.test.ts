import { describe, expect, it } from "vitest";
import { contractSchema, licenseSchema, optionalId, vendorSchema } from "@/lib/contract-schemas";

const contractForm = {
  name: "Acme support",
  type: "SUPPORT",
  status: "ACTIVE",
  startDate: "2026-01-01",
};

const licenseForm = { name: "Office", licenseType: "PER_USER" };

function issue(result: { success: boolean; error?: { issues: { message: string }[] } }) {
  return result.success ? null : result.error?.issues[0]?.message;
}

describe("contractSchema", () => {
  it("applies defaults for the optional fields", () => {
    const parsed = contractSchema.parse(contractForm);
    expect(parsed).toMatchObject({
      number: null,
      vendorId: null,
      ownerId: null,
      endDate: null,
      cost: null,
      renewalNoticeDays: 30,
      autoRenew: false,
      notes: null,
    });
    expect(parsed.startDate).toEqual(new Date("2026-01-01T00:00:00.000Z"));
  });

  it("takes a contract without a known start date", () => {
    expect(contractSchema.parse({ ...contractForm, startDate: "" }).startDate).toBeNull();
    const { startDate: _omitted, ...withoutStart } = contractForm;
    expect(contractSchema.parse(withoutStart).startDate).toBeNull();
  });

  it("treats blank form values as unset and 'none' as no relation", () => {
    const parsed = contractSchema.parse({ ...contractForm, endDate: "", cost: " ", vendorId: "none", ownerId: "", renewalNoticeDays: "" });
    expect(parsed).toMatchObject({ endDate: null, cost: null, vendorId: null, ownerId: null, renewalNoticeDays: 30 });
  });

  it("parses typed values from their text form", () => {
    const parsed = contractSchema.parse({
      ...contractForm,
      endDate: "2026-12-31",
      cost: "1999.5",
      renewalNoticeDays: "60",
      autoRenew: "on",
      vendorId: "v1",
    });
    expect(parsed).toMatchObject({ cost: 1999.5, renewalNoticeDays: 60, autoRenew: true, vendorId: "v1" });
    expect(parsed.endDate).toEqual(new Date("2026-12-31T00:00:00.000Z"));
  });

  it("names the field in every rejection", () => {
    expect(issue(contractSchema.safeParse({ ...contractForm, name: "A" }))).toBe("Name must be at least 2 characters");
    expect(issue(contractSchema.safeParse({ ...contractForm, startDate: "someday" }))).toBe("Start date is not a valid date");
    expect(issue(contractSchema.safeParse({ ...contractForm, endDate: "soon" }))).toBe("End date is not a valid date");
    expect(issue(contractSchema.safeParse({ ...contractForm, cost: "abc" }))).toBe("Cost must be a number");
    expect(issue(contractSchema.safeParse({ ...contractForm, cost: "-1" }))).toBe("Cost can't be negative");
    expect(issue(contractSchema.safeParse({ ...contractForm, renewalNoticeDays: "1.5" }))).toBe("Renewal notice must be a whole number");
    expect(issue(contractSchema.safeParse({ ...contractForm, renewalNoticeDays: "-3" }))).toBe("Renewal notice must be at least 0");
  });

  it("rejects values outside the contract enums", () => {
    expect(contractSchema.safeParse({ ...contractForm, type: "BOGUS" }).success).toBe(false);
    expect(contractSchema.safeParse({ ...contractForm, status: "BOGUS" }).success).toBe(false);
  });
});

describe("licenseSchema", () => {
  it("defaults to a single seat", () => {
    expect(licenseSchema.parse(licenseForm)).toMatchObject({ seats: 1, expiresAt: null, cost: null, contractId: null });
  });

  it("requires at least one seat, as a whole number", () => {
    expect(issue(licenseSchema.safeParse({ ...licenseForm, seats: "0" }))).toBe("Seats must be at least 1");
    expect(issue(licenseSchema.safeParse({ ...licenseForm, seats: "2.5" }))).toBe("Seats must be a whole number");
    expect(licenseSchema.parse({ ...licenseForm, seats: "25" }).seats).toBe(25);
  });

  it("rejects an unknown license type", () => {
    expect(licenseSchema.safeParse({ ...licenseForm, licenseType: "BOGUS" }).success).toBe(false);
  });
});

describe("vendorSchema", () => {
  it("trims the name and stores blank contact fields as null", () => {
    const parsed = vendorSchema.parse({ name: "  Acme  ", website: "", email: " ", isActive: "on" });
    expect(parsed).toMatchObject({ name: "Acme", website: null, email: null, phone: null, isActive: true });
  });

  it("validates the contact email only when one is given", () => {
    expect(issue(vendorSchema.safeParse({ name: "Acme", email: "nope" }))).toBe("Enter a valid email address");
    expect(vendorSchema.parse({ name: "Acme", email: "sales@acme.test" }).email).toBe("sales@acme.test");
  });

  it("is inactive unless the switch was on", () => {
    expect(vendorSchema.parse({ name: "Acme" }).isActive).toBe(false);
  });
});

describe("optionalId", () => {
  it("maps empty and 'none' to null", () => {
    expect(optionalId.parse(undefined)).toBeNull();
    expect(optionalId.parse("")).toBeNull();
    expect(optionalId.parse("none")).toBeNull();
    expect(optionalId.parse("abc")).toBe("abc");
  });
});
