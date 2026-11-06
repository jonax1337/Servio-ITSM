import { describe, expect, it } from "vitest";
import {
  DEFAULT_NUDGE_PERCENT,
  normalizeNudgePercent,
  nudgeMessage,
  shouldNudge,
  type NudgeCandidate,
} from "@/lib/sla-nudge-rules";

const active: NudgeCandidate = {
  status: "IN_PROGRESS",
  resolvedAt: null,
  pendingSince: null,
  assigneeId: "u1",
  slaNudgedAt: null,
};

describe("normalizeNudgePercent", () => {
  it("keeps a sane value", () => {
    expect(normalizeNudgePercent(60)).toBe(60);
  });

  it("clamps into 1..100", () => {
    expect(normalizeNudgePercent(0)).toBe(1);
    expect(normalizeNudgePercent(-20)).toBe(1);
    expect(normalizeNudgePercent(250)).toBe(100);
  });

  it("falls back to the default for NaN or infinity", () => {
    expect(normalizeNudgePercent(Number.NaN)).toBe(DEFAULT_NUDGE_PERCENT);
    expect(normalizeNudgePercent(Number.POSITIVE_INFINITY)).toBe(DEFAULT_NUDGE_PERCENT);
  });
});

describe("shouldNudge", () => {
  it("fires exactly at the threshold and above, not below", () => {
    expect(shouldNudge(active, 74.9, 75)).toBe(false);
    expect(shouldNudge(active, 75, 75)).toBe(true);
    expect(shouldNudge(active, 130, 75)).toBe(true);
  });

  it("stays silent once nudged", () => {
    expect(shouldNudge({ ...active, slaNudgedAt: new Date() }, 90, 75)).toBe(false);
  });

  it("skips paused tickets by status or by pause anchor", () => {
    expect(shouldNudge({ ...active, status: "PENDING" }, 90, 75)).toBe(false);
    expect(shouldNudge({ ...active, status: "ON_HOLD" }, 90, 75)).toBe(false);
    expect(shouldNudge({ ...active, pendingSince: new Date() }, 90, 75)).toBe(false);
  });

  it("skips resolved tickets", () => {
    expect(shouldNudge({ ...active, resolvedAt: new Date() }, 90, 75)).toBe(false);
  });

  it("skips tickets nobody owns yet", () => {
    expect(shouldNudge({ ...active, assigneeId: null }, 90, 75)).toBe(false);
  });

  it("skips tickets without an SLA deadline", () => {
    expect(shouldNudge(active, null, 75)).toBe(false);
  });
});

describe("nudgeMessage", () => {
  const ticket = { id: 42, prefix: "INC", title: "VPN down" };

  it("quotes the used share while time is left", () => {
    expect(nudgeMessage(ticket, 78.6)).toEqual({
      title: "INC-0042 is running out of SLA time",
      body: "VPN down: 78% of the resolve time is used.",
    });
  });

  it("says overdue once the deadline passed", () => {
    expect(nudgeMessage(ticket, 100)).toEqual({
      title: "INC-0042 is past its SLA",
      body: "VPN down: the resolve deadline has passed.",
    });
  });
});
