import { describe, expect, it } from "vitest";
import {
  ageLabel,
  briefingIsEmpty,
  briefingToText,
  changeStartWindow,
  customerRepliedLast,
  untilLabel,
} from "@/lib/dashboard/briefing-rules";
import type { BriefingSection } from "@/lib/dashboard/types";

const NOW = new Date("2026-11-05T09:00:00Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

const section = (overrides: Partial<BriefingSection>): BriefingSection => ({
  key: "sla",
  title: "SLA at risk",
  total: 0,
  items: [],
  ...overrides,
});

describe("changeStartWindow", () => {
  it("spans from now to exactly 24 hours ahead", () => {
    const { from, to } = changeStartWindow(NOW);
    expect(from).toEqual(NOW);
    expect(to).toEqual(new Date("2026-11-06T09:00:00Z"));
  });
});

describe("customerRepliedLast", () => {
  it("is true only when the latest public author is the requester", () => {
    expect(customerRepliedLast("req", "req")).toBe(true);
    expect(customerRepliedLast("agent", "req")).toBe(false);
    expect(customerRepliedLast(null, "req")).toBe(false);
  });
});

describe("ageLabel", () => {
  it("counts hours below a day and days above", () => {
    expect(ageLabel(minutes(-30), NOW)).toBe("0h");
    expect(ageLabel(minutes(-5 * 60), NOW)).toBe("5h");
    expect(ageLabel(minutes(-24 * 60), NOW)).toBe("1d");
    expect(ageLabel(minutes(-50 * 60), NOW)).toBe("2d");
  });

  it("never goes negative for a timestamp in the future", () => {
    expect(ageLabel(minutes(120), NOW)).toBe("0h");
  });
});

describe("untilLabel", () => {
  it("counts minutes below an hour and hours above", () => {
    expect(untilLabel(minutes(25), NOW)).toBe("in 25m");
    expect(untilLabel(minutes(60), NOW)).toBe("in 1h");
    expect(untilLabel(minutes(5 * 60 + 40), NOW)).toBe("in 5h");
  });

  it("is zero for a moment in the past", () => {
    expect(untilLabel(minutes(-10), NOW)).toBe("in 0m");
  });
});

describe("briefingIsEmpty", () => {
  it("is true only when every section has no matches", () => {
    expect(briefingIsEmpty([section({}), section({ key: "changes" })])).toBe(true);
    expect(briefingIsEmpty([section({}), section({ key: "changes", total: 1 })])).toBe(false);
  });
});

describe("briefingToText", () => {
  it("lists items per non-empty section and counts the rest", () => {
    const text = briefingToText([
      section({
        total: 7,
        items: [{ label: "INC-0001 VPN down", detail: "SLA breached", href: "/tickets/1" }],
      }),
      section({ key: "approvals", title: "Approvals for you" }),
    ]);
    expect(text).toBe("SLA at risk (7):\n- INC-0001 VPN down: SLA breached\n- and 6 more");
  });

  it("is empty for an empty briefing", () => {
    expect(briefingToText([section({})])).toBe("");
  });
});
