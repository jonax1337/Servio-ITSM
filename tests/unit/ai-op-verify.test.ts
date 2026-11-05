import { describe, expect, it } from "vitest";
import { verifyFieldWrite } from "@/lib/ai-operations/helpers";

// The record actions Sable reuses return silently when a rule refuses a change
// (workflow, role, approval gate). Sable must never report such a write as applied.
describe("verifyFieldWrite", () => {
  it("reports success when the stored value matches the requested one", () => {
    expect(verifyFieldWrite("CLOSED", "CLOSED", "Updated status on PRB-0020")).toEqual({
      ok: true,
      summary: "Updated status on PRB-0020",
      data: undefined,
    });
  });

  it("reports a refusal when the write did not land", () => {
    const res = verifyFieldWrite("NEW", "CLOSED", "Updated status on PRB-0020");
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/not applied/i) });
  });

  it("treats 'none' as clearing the field", () => {
    expect(verifyFieldWrite(null, "none", "Unassigned").ok).toBe(true);
    expect(verifyFieldWrite("user-1", "none", "Unassigned").ok).toBe(false);
  });
});
