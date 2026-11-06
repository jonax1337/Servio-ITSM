import { describe, expect, it } from "vitest";
import { compactDuration, slaCell } from "@/lib/sla-column";
import { compareSlaUrgency, type SlaClock } from "@/lib/sla-views";

const MIN = 60_000;
const HOUR = 60 * MIN;
const now = new Date("2026-03-02T10:00:00Z");
const clock = (state: SlaClock["state"], offsetMs: number): SlaClock => ({ state, dueAt: new Date(now.getTime() + offsetMs) });

describe("compactDuration", () => {
  it.each([
    [30_000, "1m"],
    [45 * MIN, "45m"],
    [HOUR, "1h"],
    [2 * HOUR + 10 * MIN, "2h 10m"],
    [9 * HOUR + 59 * MIN, "9h 59m"],
    [10 * HOUR + 30 * MIN, "10h"],
    [47 * HOUR, "47h"],
    [48 * HOUR, "2d"],
    [100 * HOUR, "4d"],
  ])("writes %i ms as %s", (ms, text) => {
    expect(compactDuration(ms)).toBe(text);
  });
});

describe("slaCell", () => {
  it("shows how long a breached ticket is overdue", () => {
    expect(slaCell(clock("BREACHED", -3 * HOUR), now)).toEqual({ state: "BREACHED", detail: "overdue 3h" });
  });

  it("shows the time left for at-risk and on-track tickets", () => {
    expect(slaCell(clock("AT_RISK", 20 * MIN), now)).toEqual({ state: "AT_RISK", detail: "20m left" });
    expect(slaCell(clock("ON_TRACK", 30 * HOUR), now)).toEqual({ state: "ON_TRACK", detail: "30h left" });
  });

  it("shows no time for a paused ticket, whose clock is stopped", () => {
    expect(slaCell(clock("PAUSED", 5 * HOUR), now)).toEqual({ state: "PAUSED", detail: null });
  });

  it("is empty without a clock", () => {
    expect(slaCell(null, now)).toBeNull();
  });
});

describe("compareSlaUrgency", () => {
  const order = (clocks: (SlaClock | null)[]) => [...clocks].sort(compareSlaUrgency);

  it("puts breached first, then at risk, on track, paused, and tickets without a clock last", () => {
    const paused = clock("PAUSED", HOUR);
    const onTrack = clock("ON_TRACK", 5 * HOUR);
    const atRisk = clock("AT_RISK", 20 * MIN);
    const breached = clock("BREACHED", -HOUR);
    expect(order([null, paused, onTrack, atRisk, breached])).toEqual([breached, atRisk, onTrack, paused, null]);
  });

  it("orders breached tickets by the longest overdue first", () => {
    const recent = clock("BREACHED", -HOUR);
    const old = clock("BREACHED", -5 * HOUR);
    expect(order([recent, old])).toEqual([old, recent]);
  });

  it("orders the others by the nearest deadline first", () => {
    const soon = clock("AT_RISK", 10 * MIN);
    const later = clock("AT_RISK", 30 * MIN);
    expect(order([later, soon])).toEqual([soon, later]);
  });

  it("treats two tickets without a clock as equal", () => {
    expect(compareSlaUrgency(null, null)).toBe(0);
  });
});

describe("sortBySlaUrgency", () => {
  const created = new Date("2026-03-02T00:00:00Z");
  const row = (id: number, over: Partial<Record<string, unknown>> = {}) => ({
    id, status: "OPEN", createdAt: created, updatedAt: new Date(created.getTime() + id), resolvedAt: null,
    resolveBreached: false, responseDueAt: null, resolveDueAt: new Date(now.getTime() + 5 * HOUR), dueAt: new Date(now.getTime() + 5 * HOUR),
    pendingSince: null, pausedMs: 0, sla: null, ...over,
  });
  const dueIn = (ms: number) => ({ resolveDueAt: new Date(now.getTime() + ms), dueAt: new Date(now.getTime() + ms) });
  const rows = () => [
    row(1, { resolveDueAt: null, dueAt: null }),
    row(2, dueIn(9 * HOUR)),
    row(3, dueIn(-2 * HOUR)),
    row(4, { status: "PENDING", pendingSince: now, ...dueIn(HOUR) }),
    row(5, dueIn(-HOUR)),
    row(6, { status: "CLOSED", resolvedAt: now }),
  ];

  it("lists breached tickets first, the longest overdue first, and tickets without a clock last", async () => {
    const { sortBySlaUrgency } = await import("@/lib/sla-views");
    const sorted = await sortBySlaUrgency(rows(), "asc", now);
    // 3 and 5 breached; 2 on track; 4 paused; 6 (finished) and 1 (no deadline) have no clock, newest activity first.
    expect(sorted.map((r) => r.id)).toEqual([3, 5, 2, 4, 6, 1]);
  });

  it("reverses the urgency order for a descending sort, keeping newest activity first among ties", async () => {
    const { sortBySlaUrgency } = await import("@/lib/sla-views");
    const sorted = await sortBySlaUrgency(rows(), "desc", now);
    expect(sorted.map((r) => r.id)).toEqual([6, 1, 4, 2, 5, 3]);
  });
});
