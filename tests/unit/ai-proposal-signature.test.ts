import { describe, expect, it } from "vitest";
import { signOperation, stableStringify } from "@/lib/ai-proposal-signature";

describe("stableStringify", () => {
  it("serialises equal objects identically whatever their key order", () => {
    expect(stableStringify({ b: 1, a: { d: [2, { y: 1, x: 0 }], c: "z" } })).toBe(
      stableStringify({ a: { c: "z", d: [2, { x: 0, y: 1 }] }, b: 1 }),
    );
  });

  it("drops undefined fields like JSON does", () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
  });

  it("keeps array order, which is meaningful", () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });
});

describe("signOperation", () => {
  const create = { title: "Swap core switch PSU", type: "NORMAL", plannedStart: "2026-11-19 06:00" };

  it("is the same for the same args in another key order", () => {
    const reordered = { plannedStart: "2026-11-19 06:00", type: "NORMAL", title: "Swap core switch PSU" };
    expect(signOperation("change.create", create)).toBe(signOperation("change.create", reordered));
  });

  it("differs when the args differ", () => {
    expect(signOperation("change.create", create)).not.toBe(
      signOperation("change.create", { ...create, type: "EMERGENCY" }),
    );
  });

  it("differs per operation for the same args", () => {
    const args = { ref: "INC-0142", text: "Looking into it" };
    expect(signOperation("ticket.comment", args)).not.toBe(signOperation("change.comment", args));
  });
});
