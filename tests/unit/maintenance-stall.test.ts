// A running update whose updater stopped reporting must not keep the
// maintenance window (and the access block) open until its planned end.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_UPDATER_STALE_MINUTES,
  STEP_RESULTS,
  maintenanceGate,
  nextWindowStep,
  parseUpdaterHeartbeat,
  parseUpdaterStatus,
  updaterStaleMs,
  type TickWindow,
  type UpdaterHeartbeat,
  type UpdaterStatus,
} from "@/lib/maintenance-rules";
import { healthResponse } from "@/lib/health-rules";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const STALE = 10 * MINUTE;
const now = new Date("2026-11-06T12:00:00Z");
const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);
const iso = (offsetMs: number) => at(offsetMs).toISOString();

const running: TickWindow = {
  id: "w1",
  kind: "UPDATE",
  status: "IN_PROGRESS",
  startsAt: at(-HOUR),
  startedAt: at(-30 * MINUTE),
  endsAt: at(3 * HOUR),
  result: "now PULLING",
  targetVersion: "0.3.0",
  log: "[]",
};

const status = (state: string, updatedAgoMs: number): UpdaterStatus | null =>
  parseUpdaterStatus({ id: "w1", state, targetVersion: "0.3.0", message: `now ${state}`, updatedAt: iso(-updatedAgoMs), log: [] });

const beat = (agoMs: number, activeRequestId?: string | null): UpdaterHeartbeat => ({
  updaterVersion: "0.3.0",
  at: iso(-agoMs),
  dockerOk: true,
  container: "servio-web",
  image: "ghcr.io/x/servio:0.2.0",
  ...(activeRequestId === undefined ? {} : { activeRequestId }),
});

const input = (updaterStatus: UpdaterStatus | null, updaterHeartbeat: UpdaterHeartbeat | null) => ({
  now,
  heartbeatFresh: true,
  updaterStatus,
  currentVersion: "0.2.0",
  updaterHeartbeat,
  staleAfterMs: STALE,
});

describe("stalled update detection", () => {
  it("fails a window whose updater stopped sending heartbeats (e.g. a full disk)", () => {
    const step = nextWindowStep(running, input(status("PULLING", 25 * MINUTE), beat(20 * MINUTE, "w1")));
    expect(step).toEqual({ kind: "fail", result: STEP_RESULTS.updaterSilent(10, "PULLING") });
    if (step.kind === "fail") expect(step.result).toContain("no heartbeat for more than 10 minutes while the update was PULLING");
  });

  it("fails when heartbeat.json is gone as well", () => {
    expect(nextWindowStep(running, input(status("SWITCHING", 15 * MINUTE), null))).toEqual({
      kind: "fail",
      result: STEP_RESULTS.updaterSilent(10, "SWITCHING"),
    });
  });

  it("fails when the updater is alive but no longer works on this window (its status write failed)", () => {
    const step = nextWindowStep(running, input(status("PULLING", 15 * MINUTE), beat(10_000, null)));
    expect(step).toEqual({ kind: "fail", result: STEP_RESULTS.updaterLostTrack(10, "PULLING") });
  });

  it("fails when the updater never picked the request up", () => {
    const step = nextWindowStep(running, input(null, beat(10_000, null)));
    expect(step).toEqual({ kind: "fail", result: STEP_RESULTS.updaterLostTrack(10, "not yet started") });
  });

  it("waits for a busy updater however long its pull takes", () => {
    expect(nextWindowStep(running, input(status("PULLING", 25 * MINUTE), beat(10_000, "w1")))).toEqual({ kind: "none" });
  });

  it("waits while there was progress within the limit", () => {
    expect(nextWindowStep(running, input(status("PULLING", 5 * MINUTE), beat(20 * MINUTE, "w1")))).toEqual({ kind: "none" });
    const justStarted = { ...running, startedAt: at(-5 * MINUTE) };
    expect(nextWindowStep(justStarted, input(null, null))).toEqual({ kind: "none" });
  });

  it("cannot tell idle from busy with an older updater, so only a stopped heartbeat fails the window", () => {
    expect(nextWindowStep(running, input(status("PULLING", 15 * MINUTE), beat(10_000)))).toEqual({ kind: "none" });
    expect(nextWindowStep(running, input(status("PULLING", 15 * MINUTE), beat(15 * MINUTE)))).toMatchObject({ kind: "fail" });
  });

  it("still takes a terminal result first", () => {
    const done = status("SUCCEEDED", 30 * MINUTE);
    expect(nextWindowStep(running, input(done, null))).toMatchObject({ kind: "sync", status: "COMPLETED" });
  });

  it("falls back to the planned start for windows without a start time and skips detection without heartbeat input", () => {
    const legacy = { ...running, startedAt: undefined, startsAt: at(-20 * MINUTE) };
    expect(nextWindowStep(legacy, input(null, null))).toMatchObject({ kind: "fail" });
    const { updaterHeartbeat: _skip, ...withoutHeartbeat } = input(null, null);
    expect(nextWindowStep(legacy, withoutHeartbeat)).toEqual({ kind: "none" });
  });
});

describe("updaterStaleMs", () => {
  it("reads whole minutes from 1 to 1440 and falls back to the default otherwise", () => {
    expect(updaterStaleMs("15")).toBe(15 * MINUTE);
    expect(updaterStaleMs("1440")).toBe(1440 * MINUTE);
    for (const raw of [undefined, "", "0", "-5", "1.5", "abc", "1441"]) {
      expect(updaterStaleMs(raw)).toBe(DEFAULT_UPDATER_STALE_MINUTES * MINUTE);
    }
  });
});

describe("parseUpdaterHeartbeat: active request", () => {
  const raw = { updaterVersion: "0.6.0", at: iso(0), dockerOk: true, container: "c", image: "i" };

  it("reads the active request id, null when idle", () => {
    expect(parseUpdaterHeartbeat({ ...raw, activeRequestId: "w1" })?.activeRequestId).toBe("w1");
    expect(parseUpdaterHeartbeat({ ...raw, activeRequestId: null })?.activeRequestId).toBeNull();
  });

  it("leaves it undefined for an updater that does not report it", () => {
    expect(parseUpdaterHeartbeat(raw)).not.toHaveProperty("activeRequestId");
  });
});

describe("health endpoint", () => {
  it("stays reachable during maintenance", () => {
    const flag = { active: true as const, windowId: "w1", title: "Update", message: null, endsAt: iso(HOUR), kind: "UPDATE" as const };
    expect(maintenanceGate({ path: "/api/v1/health", role: "USER", state: flag })).toBe("allow");
    expect(maintenanceGate({ path: "/api/v1/healthz", role: "USER", state: flag })).toBe("maintenance-api");
  });

  it("answers ok with the version only for an authenticated caller", () => {
    expect(healthResponse({ databaseOk: true, maintenance: false, version: null })).toEqual({
      httpStatus: 200,
      body: { status: "ok", maintenance: false },
    });
    expect(healthResponse({ databaseOk: true, maintenance: true, version: "0.6.0" })).toEqual({
      httpStatus: 200,
      body: { status: "ok", maintenance: true, version: "0.6.0" },
    });
  });

  it("answers 503 when the database is unreachable", () => {
    expect(healthResponse({ databaseOk: false, maintenance: false, version: null })).toEqual({
      httpStatus: 503,
      body: { status: "unavailable", maintenance: false },
    });
  });
});
