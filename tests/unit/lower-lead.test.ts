import { describe, expect, it } from "vitest";
import { lowerLead } from "@/lib/utils";

describe("lowerLead", () => {
  it("lower-cases a leading verb", () => {
    expect(lowerLead("Cleared Major Incident")).toBe("cleared Major Incident");
    expect(lowerLead("Created via the Sable assistant")).toBe("created via the Sable assistant");
  });

  it("keeps refs and acronyms", () => {
    expect(lowerLead("PRB-0023 linked to INC-0001")).toBe("PRB-0023 linked to INC-0001");
    expect(lowerLead("SLA breached")).toBe("SLA breached");
  });

  it("keeps a leading full name", () => {
    expect(lowerLead("Liam Chen reported being affected")).toBe("Liam Chen reported being affected");
  });
});
