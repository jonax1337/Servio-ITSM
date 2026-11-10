import { describe, expect, it } from "vitest";
import {
  HEARTBEAT_MAX_AGE_MS,
  MAX_WINDOW_HOURS,
  STEP_RESULTS,
  UPDATER_RESULT_GRACE_MS,
  WINDOW_ERRORS,
  abortResult,
  bannerFor,
  flagForWindows,
  heartbeatFresh,
  isAbortable,
  isTerminalUpdaterState,
  maintenanceGate,
  nextWindowStep,
  outcomeNotice,
  parseMaintenanceFlag,
  parseUpdaterHeartbeat,
  parseUpdaterStatus,
  parseWindowLog,
  retryAfterSeconds,
  statusForWindow,
  toPublicMaintenance,
  updaterStateToWindowStatus,
  validateWindow,
  UPDATER_STATES,
  type BannerWindow,
  type MaintenanceFlag,
  type TickWindow,
  type UpdaterStatus,
  type WindowDraft,
} from "@/lib/maintenance-rules";
import { MAINTENANCE_STATUSES } from "@/lib/constants";

const HOUR = 3_600_000;
const MINUTE = 60_000;
const now = new Date("2026-11-06T12:00:00Z");
const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);

// ── validateWindow ────────────────────────────────────────────────────────────

describe("validateWindow", () => {
  const context = { now, existing: [], currentVersion: "0.2.0", updaterConnected: true };
  const general = (startOffset: number, endOffset: number): WindowDraft => ({
    kind: "GENERAL",
    startsAt: at(startOffset),
    endsAt: at(endOffset),
    targetVersion: null,
  });

  it("accepts a general window in the future", () => {
    expect(validateWindow(general(HOUR, 2 * HOUR), context)).toBeNull();
  });

  it("refuses an end that is not after the start", () => {
    expect(validateWindow(general(HOUR, HOUR), context)).toBe(WINDOW_ERRORS.endBeforeStart);
    expect(validateWindow(general(2 * HOUR, HOUR), context)).toBe(WINDOW_ERRORS.endBeforeStart);
  });

  it("allows a start up to a minute in the past and refuses anything earlier", () => {
    expect(validateWindow(general(-MINUTE, HOUR), context)).toBeNull();
    expect(validateWindow(general(-MINUTE - 1, HOUR), context)).toBe(WINDOW_ERRORS.startInPast);
  });

  it("allows exactly 24 hours and refuses a millisecond more", () => {
    expect(validateWindow(general(HOUR, HOUR + MAX_WINDOW_HOURS * HOUR), context)).toBeNull();
    expect(validateWindow(general(HOUR, HOUR + MAX_WINDOW_HOURS * HOUR + 1), context)).toBe(WINDOW_ERRORS.tooLong);
  });

  describe("overlap", () => {
    const existing = [{ id: "w1", title: "Database upgrade", startsAt: at(2 * HOUR), endsAt: at(3 * HOUR) }];

    it("refuses a window that overlaps an open one and names it", () => {
      expect(validateWindow(general(HOUR, 2.5 * HOUR), { ...context, existing })).toBe(
        WINDOW_ERRORS.overlap("Database upgrade"),
      );
      expect(validateWindow(general(2.5 * HOUR, 5 * HOUR), { ...context, existing })).toBe(
        WINDOW_ERRORS.overlap("Database upgrade"),
      );
      expect(validateWindow(general(HOUR, 5 * HOUR), { ...context, existing })).toBe(
        WINDOW_ERRORS.overlap("Database upgrade"),
      );
    });

    it("allows windows that merely touch", () => {
      expect(validateWindow(general(HOUR, 2 * HOUR), { ...context, existing })).toBeNull();
      expect(validateWindow(general(3 * HOUR, 4 * HOUR), { ...context, existing })).toBeNull();
    });
  });

  describe("update windows", () => {
    const update = (targetVersion: string | null): WindowDraft => ({
      kind: "UPDATE",
      startsAt: at(HOUR),
      endsAt: at(2 * HOUR),
      targetVersion,
    });

    it("accepts a newer target version", () => {
      expect(validateWindow(update("0.3.0"), context)).toBeNull();
      expect(validateWindow(update("v0.2.1"), context)).toBeNull();
    });

    it("needs a valid target version", () => {
      expect(validateWindow(update(null), context)).toBe(WINDOW_ERRORS.noTarget);
      expect(validateWindow(update("latest"), context)).toBe(WINDOW_ERRORS.noTarget);
    });

    it("refuses the installed or an older version", () => {
      expect(validateWindow(update("0.2.0"), context)).toBe(WINDOW_ERRORS.notNewer("0.2.0", "0.2.0"));
      expect(validateWindow(update("0.1.9"), context)).toBe(WINDOW_ERRORS.notNewer("0.1.9", "0.2.0"));
    });

    it("refuses a prerelease of the installed version", () => {
      expect(validateWindow(update("0.2.0-rc.1"), context)).toBe(WINDOW_ERRORS.notNewer("0.2.0-rc.1", "0.2.0"));
    });

    it("refuses an update while the updater is not connected, but not a general window", () => {
      const offline = { ...context, updaterConnected: false };
      expect(validateWindow(update("0.3.0"), offline)).toBe(WINDOW_ERRORS.updaterOffline);
      expect(validateWindow(general(HOUR, 2 * HOUR), offline)).toBeNull();
    });
  });
});

// ── heartbeat, updater files ──────────────────────────────────────────────────

describe("heartbeatFresh", () => {
  const heartbeat = (ageMs: number, dockerOk = true) =>
    parseUpdaterHeartbeat({ updaterVersion: "0.1.0", at: at(-ageMs).toISOString(), dockerOk, container: "web", image: "img" });

  it("is connected below a minute and not at a minute", () => {
    expect(heartbeatFresh(heartbeat(HEARTBEAT_MAX_AGE_MS - 1), now)).toBe(true);
    expect(heartbeatFresh(heartbeat(HEARTBEAT_MAX_AGE_MS), now)).toBe(false);
  });

  it("needs Docker to be reachable", () => {
    expect(heartbeatFresh(heartbeat(1000, false), now)).toBe(false);
  });

  it("is not connected without a heartbeat", () => {
    expect(heartbeatFresh(null, now)).toBe(false);
  });
});

describe("parseUpdaterHeartbeat", () => {
  it("rejects junk and a missing or unparsable timestamp", () => {
    expect(parseUpdaterHeartbeat(null)).toBeNull();
    expect(parseUpdaterHeartbeat("x")).toBeNull();
    expect(parseUpdaterHeartbeat({ dockerOk: true })).toBeNull();
    expect(parseUpdaterHeartbeat({ at: "not a date", dockerOk: true })).toBeNull();
  });

  it("treats anything but dockerOk:true as Docker unreachable", () => {
    expect(parseUpdaterHeartbeat({ at: now.toISOString(), dockerOk: "yes" })?.dockerOk).toBe(false);
  });

  it("reads the outcome of the last self-update", () => {
    const selfUpdate = { state: "ROLLED_BACK", fromVersion: "0.2.0", targetVersion: "0.3.0", message: "rolled back", at: now.toISOString() };
    expect(parseUpdaterHeartbeat({ at: now.toISOString(), dockerOk: true, selfUpdate })?.selfUpdate).toEqual(selfUpdate);
  });

  it("drops a self-update outcome that is missing, of an unknown state or incomplete", () => {
    const beat = (selfUpdate: unknown) => parseUpdaterHeartbeat({ at: now.toISOString(), dockerOk: true, selfUpdate })?.selfUpdate;
    const valid = { state: "SUCCEEDED", fromVersion: "0.2.0", targetVersion: "0.3.0", message: "ok", at: now.toISOString() };
    expect(beat(undefined)).toBeNull();
    expect(beat({ ...valid, state: "PULLING" })).toBeNull();
    expect(beat({ ...valid, targetVersion: 3 })).toBeNull();
    expect(beat({ ...valid, at: "yesterday" })).toBeNull();
  });
});

describe("parseUpdaterStatus", () => {
  const valid = {
    id: "w1",
    state: "PULLING",
    fromVersion: "0.2.0",
    targetVersion: "0.3.0",
    message: "Pulling",
    updatedAt: "2026-11-06T12:00:00Z",
    log: [{ at: "2026-11-06T12:00:00Z", state: "PENDING", message: "Queued" }, { state: "BOGUS" }, "junk"],
  };

  it("reads the documented shape and drops malformed log entries", () => {
    const status = parseUpdaterStatus(valid);
    expect(status).toMatchObject({ id: "w1", state: "PULLING", fromVersion: "0.2.0", targetVersion: "0.3.0" });
    expect(status?.log).toEqual([{ at: "2026-11-06T12:00:00Z", state: "PENDING", message: "Queued" }]);
  });

  it("rejects an unknown state, a missing id or target, and non-objects", () => {
    expect(parseUpdaterStatus({ ...valid, state: "RUNNING" })).toBeNull();
    expect(parseUpdaterStatus({ ...valid, id: undefined })).toBeNull();
    expect(parseUpdaterStatus({ ...valid, targetVersion: undefined })).toBeNull();
    expect(parseUpdaterStatus(null)).toBeNull();
    expect(parseUpdaterStatus([])).toBeNull();
  });

  it("allows a null fromVersion and a missing log", () => {
    const status = parseUpdaterStatus({ ...valid, fromVersion: null, log: undefined });
    expect(status?.fromVersion).toBeNull();
    expect(status?.log).toEqual([]);
  });
});

describe("parseWindowLog", () => {
  it("reads a stored JSON array and falls back to empty", () => {
    expect(parseWindowLog('[{"at":"t","state":"FAILED","message":"boom"}]')).toEqual([{ at: "t", state: "FAILED", message: "boom" }]);
    expect(parseWindowLog("[]")).toEqual([]);
    expect(parseWindowLog("not json")).toEqual([]);
    expect(parseWindowLog('{"a":1}')).toEqual([]);
  });
});

describe("updater states", () => {
  it("marks exactly SUCCEEDED, FAILED and ROLLED_BACK as terminal", () => {
    const terminal = UPDATER_STATES.filter(isTerminalUpdaterState);
    expect(terminal).toEqual(["SUCCEEDED", "FAILED", "ROLLED_BACK"]);
  });

  it("maps every state to a window status", () => {
    expect(updaterStateToWindowStatus("SUCCEEDED")).toBe("COMPLETED");
    expect(updaterStateToWindowStatus("FAILED")).toBe("FAILED");
    expect(updaterStateToWindowStatus("ROLLED_BACK")).toBe("ROLLED_BACK");
    for (const state of ["PENDING", "PULLING", "BACKING_UP", "SWITCHING", "HEALTH_CHECK"] as const) {
      expect(updaterStateToWindowStatus(state)).toBe("IN_PROGRESS");
    }
    for (const state of UPDATER_STATES) expect(MAINTENANCE_STATUSES).toContain(updaterStateToWindowStatus(state));
  });
});

describe("statusForWindow", () => {
  const status = parseUpdaterStatus({ id: "w1", state: "PULLING", targetVersion: "0.3.0" });

  it("returns the status only for its own window", () => {
    expect(statusForWindow(status, "w1")).toBe(status);
    expect(statusForWindow(status, "w2")).toBeNull();
    expect(statusForWindow(null, "w1")).toBeNull();
  });
});

// ── banners ───────────────────────────────────────────────────────────────────

describe("bannerFor", () => {
  const window = (overrides: Partial<BannerWindow>): BannerWindow => ({
    id: "w1",
    title: "Upgrade",
    message: null,
    kind: "GENERAL",
    status: "SCHEDULED",
    startsAt: at(10 * HOUR),
    endsAt: at(11 * HOUR),
    announceHours: 24,
    blockAccess: true,
    ...overrides,
  });

  it("is empty without windows", () => {
    expect(bannerFor([], now, "USER")).toBeNull();
  });

  describe("announce period", () => {
    it("shows once the announce period has begun, not before", () => {
      const starts24hAhead = window({ startsAt: at(24 * HOUR), endsAt: at(25 * HOUR) });
      expect(bannerFor([starts24hAhead], now, "USER")).not.toBeNull();
      const starts24hAnd1msAhead = window({ startsAt: at(24 * HOUR + 1), endsAt: at(25 * HOUR) });
      expect(bannerFor([starts24hAnd1msAhead], now, "USER")).toBeNull();
    });

    it("honours the window's own announce lead time", () => {
      expect(bannerFor([window({ announceHours: 2 })], now, "USER")).toBeNull();
      expect(bannerFor([window({ announceHours: 10 })], now, "USER")).not.toBeNull();
    });

    it("hides a scheduled window whose start has passed (the tick will start it)", () => {
      expect(bannerFor([window({ startsAt: at(-1), endsAt: at(HOUR) })], now, "USER")).toBeNull();
    });

    it("ignores finished and cancelled windows", () => {
      for (const status of ["COMPLETED", "FAILED", "ROLLED_BACK", "CANCELLED"]) {
        expect(bannerFor([window({ status })], now, "USER")).toBeNull();
      }
    });

    it("shows the soonest announced window", () => {
      const later = window({ id: "later", title: "Later", startsAt: at(20 * HOUR), endsAt: at(21 * HOUR) });
      const sooner = window({ id: "sooner", title: "Sooner", startsAt: at(5 * HOUR), endsAt: at(6 * HOUR) });
      expect(bannerFor([later, sooner], now, "USER")?.title).toContain("Sooner");
    });

    it("uses the fixed unavailable sentence only when the window has no message and blocks access", () => {
      expect(bannerFor([window({})], now, "USER")?.text).toBe("Servio will be unavailable.");
      expect(bannerFor([window({ blockAccess: false })], now, "USER")?.text).toBe("");
    });

    it("shows the window's message instead of the fixed sentence, never both", () => {
      const banner = bannerFor([window({ message: "Servio is being updated to 0.3.0." })], now, "USER");
      expect(banner?.text).toBe("Servio is being updated to 0.3.0.");
      expect(banner?.text).not.toContain("will be unavailable");
    });

    it("hands the period over as ISO instants for the browser to format", () => {
      const banner = bannerFor([window({})], now, "USER");
      expect(banner?.period).toEqual({ startsAt: at(10 * HOUR).toISOString(), endsAt: at(11 * HOUR).toISOString() });
      expect(banner?.text).not.toMatch(/\d{4}/);
    });

    it("tells admins of a blocking run and gives only the planned end of a running window", () => {
      const running = window({ status: "IN_PROGRESS", startsAt: at(-HOUR), endsAt: at(HOUR) });
      expect(bannerFor([running], now, "ADMIN")?.period).toEqual({ startsAt: null, endsAt: at(HOUR).toISOString() });
    });
  });

  describe("running window", () => {
    const running = window({ status: "IN_PROGRESS", startsAt: at(-HOUR), endsAt: at(HOUR) });

    it("wins over a scheduled one", () => {
      const banner = bannerFor([window({ title: "Next" }), running], now, "USER");
      expect(banner?.title).toContain("Maintenance in progress");
      expect(banner?.tone).toBe("warning");
    });

    it("tells admins that maintenance mode is on when users are blocked", () => {
      const banner = bannerFor([running], now, "ADMIN");
      expect(banner?.title).toBe("Maintenance mode is on");
      expect(banner?.text).toContain("Users see the maintenance page");
    });

    it("shows admins the plain banner when access is not blocked", () => {
      const banner = bannerFor([{ ...running, blockAccess: false }], now, "ADMIN");
      expect(banner?.title).toContain("Maintenance in progress");
    });

    it("includes the message for agents and users", () => {
      expect(bannerFor([{ ...running, message: "Almost done" }], now, "AGENT")?.text).toContain("Almost done");
    });
  });

  describe("link target by role", () => {
    const scheduled = window({});
    it.each([
      ["ADMIN", "/settings/updates"],
      ["MANAGER", "/status"],
      ["AGENT", "/status"],
      ["USER", "/portal/status"],
    ])("%s links to %s", (role, href) => {
      expect(bannerFor([scheduled], now, role)?.href).toBe(href);
    });
  });
});

// ── maintenance flag and the gate ─────────────────────────────────────────────

describe("flagForWindows", () => {
  const running = {
    id: "w1",
    title: "Upgrade",
    message: "Back soon",
    kind: "UPDATE",
    status: "IN_PROGRESS",
    endsAt: at(HOUR),
    blockAccess: true,
  };

  it("describes the running blocking window", () => {
    expect(flagForWindows([running])).toEqual({
      active: true,
      windowId: "w1",
      title: "Upgrade",
      message: "Back soon",
      endsAt: at(HOUR).toISOString(),
      kind: "UPDATE",
    });
  });

  it("is null when nothing runs, the run does not block, or the window only is scheduled", () => {
    expect(flagForWindows([])).toBeNull();
    expect(flagForWindows([{ ...running, blockAccess: false }])).toBeNull();
    expect(flagForWindows([{ ...running, status: "SCHEDULED" }])).toBeNull();
    expect(flagForWindows([{ ...running, status: "COMPLETED" }])).toBeNull();
  });
});

describe("parseMaintenanceFlag", () => {
  const raw = { active: true, windowId: "w1", title: "Upgrade", message: null, endsAt: "2026-11-06T13:00:00Z", kind: "GENERAL" };

  it("reads an active flag", () => {
    expect(parseMaintenanceFlag(raw)).toEqual(raw);
  });

  it("treats inactive, absent, half-written and malformed content as no maintenance", () => {
    expect(parseMaintenanceFlag({ active: false })).toBeNull();
    expect(parseMaintenanceFlag(null)).toBeNull();
    expect(parseMaintenanceFlag({ ...raw, title: undefined })).toBeNull();
    expect(parseMaintenanceFlag({ ...raw, endsAt: undefined })).toBeNull();
    expect(parseMaintenanceFlag("active")).toBeNull();
    expect(parseMaintenanceFlag({ ...raw, active: "true" })).toBeNull();
  });

  it("falls back to GENERAL for an unknown kind", () => {
    expect(parseMaintenanceFlag({ ...raw, kind: "WEIRD" })?.kind).toBe("GENERAL");
  });
});

describe("toPublicMaintenance", () => {
  it("drops the internal window id", () => {
    const flag = parseMaintenanceFlag({ active: true, windowId: "secret", title: "T", endsAt: "2026-11-06T13:00:00Z" });
    expect(toPublicMaintenance(flag)).toEqual({ active: true, title: "T", message: null, endsAt: "2026-11-06T13:00:00Z", kind: "GENERAL" });
    expect(toPublicMaintenance(null)).toBeNull();
  });
});

describe("retryAfterSeconds", () => {
  const flag = (endsAt: Date): MaintenanceFlag => ({ active: true, windowId: "w", title: "T", message: null, endsAt: endsAt.toISOString(), kind: "GENERAL" });

  it("counts down to the planned end, rounded up", () => {
    expect(retryAfterSeconds(flag(at(10 * MINUTE + 500)), now)).toBe(601);
  });

  it("never asks clients to retry sooner than 30 seconds, also after the planned end", () => {
    expect(retryAfterSeconds(flag(at(5_000)), now)).toBe(30);
    expect(retryAfterSeconds(flag(at(-HOUR)), now)).toBe(30);
  });

  it("copes with an unparsable end", () => {
    expect(retryAfterSeconds({ ...flag(now), endsAt: "garbage" }, now)).toBe(30);
  });
});

describe("maintenanceGate", () => {
  const state: MaintenanceFlag = { active: true, windowId: "w", title: "T", message: null, endsAt: "2026-11-06T13:00:00Z", kind: "GENERAL" };
  const gate = (path: string, role: string, active: MaintenanceFlag | null = state) => maintenanceGate({ path, role, state: active });

  it("allows everything when maintenance mode is off", () => {
    expect(gate("/tickets", "USER", null)).toBe("allow");
    expect(gate("/api/v1/tickets", "USER", null)).toBe("allow");
  });

  it("lets admins use everything", () => {
    for (const path of ["/", "/tickets", "/settings/updates", "/api/search", "/portal"]) {
      expect(gate(path, "ADMIN")).toBe("allow");
    }
  });

  it.each(["USER", "AGENT", "MANAGER"])("sends %s to the maintenance page", (role) => {
    for (const path of ["/", "/tickets", "/tickets/12", "/portal", "/portal/new", "/settings", "/survey/abc"]) {
      expect(gate(path, role)).toBe("maintenance-page");
    }
  });

  it("answers API calls of non-admins with a JSON 503", () => {
    for (const path of ["/api/search", "/api/v1/tickets", "/api/files/1", "/api/portal/assistant", "/api"]) {
      expect(gate(path, "USER")).toBe("maintenance-api");
    }
  });

  it("blocks the REST API with a JSON 503, also for tokens of admins (a token has no session role)", () => {
    for (const path of ["/api/v1/tickets", "/api/v1/tickets/12", "/api/v1/openapi"]) {
      expect(gate(path, "USER")).toBe("maintenance-api");
    }
    // A Bearer request carries no session, so the proxy sees it as USER, never ADMIN.
    expect(gate("/api/v1/tickets", "ADMIN")).toBe("allow");
  });

  it("keeps sign-in, the maintenance page, its status API and assets reachable for everyone", () => {
    for (const path of [
      "/login",
      "/login/callback",
      "/api/auth/session",
      "/api/auth/signin/credentials",
      "/maintenance",
      "/api/maintenance",
      "/_next/static/chunks/app.js",
      "/brand/servio/logo.svg",
      "/favicon.ico",
      "/img/logo.png",
    ]) {
      expect(gate(path, "USER")).toBe("allow");
    }
  });

  it("matches whole path segments: look-alike paths stay blocked", () => {
    expect(gate("/login-help", "USER")).toBe("maintenance-page");
    expect(gate("/maintenance-report", "USER")).toBe("maintenance-page");
    expect(gate("/api/authx", "USER")).toBe("maintenance-api");
    expect(gate("/api/maintenance-secret", "USER")).toBe("maintenance-api");
    expect(gate("/brandish", "USER")).toBe("maintenance-page");
  });

  it("does not let deep routes that merely end in an image extension through", () => {
    expect(gate("/reports/export/123.png", "USER")).toBe("maintenance-page");
    expect(gate("/api/files/photo.png", "USER")).toBe("maintenance-api");
  });
});

// ── the tick's next step ──────────────────────────────────────────────────────

describe("nextWindowStep", () => {
  const window = (overrides: Partial<TickWindow>): TickWindow => ({
    id: "w1",
    kind: "GENERAL",
    status: "SCHEDULED",
    startsAt: at(-MINUTE),
    endsAt: at(HOUR),
    result: null,
    targetVersion: null,
    log: "[]",
    ...overrides,
  });
  const idle = { now, heartbeatFresh: true, updaterStatus: null as UpdaterStatus | null, currentVersion: "0.2.0" };
  const updateWindow = (overrides: Partial<TickWindow> = {}) => window({ kind: "UPDATE", targetVersion: "0.3.0", ...overrides });
  const status = (state: string, extra: Record<string, unknown> = {}) =>
    parseUpdaterStatus({ id: "w1", state, targetVersion: "0.3.0", message: `now ${state}`, log: [], ...extra });

  describe("a scheduled window", () => {
    it("waits until its start", () => {
      expect(nextWindowStep(window({ startsAt: at(1) }), idle)).toEqual({ kind: "none" });
    });

    it("starts a general window exactly at its start", () => {
      expect(nextWindowStep(window({ startsAt: now }), idle)).toEqual({ kind: "start" });
      expect(nextWindowStep(window({ startsAt: at(-HOUR) }), idle)).toEqual({ kind: "start" });
    });

    it("requests an update when the updater is connected", () => {
      expect(nextWindowStep(updateWindow(), idle)).toEqual({ kind: "request-update" });
    });

    it("fails an update without a (valid) target version", () => {
      for (const targetVersion of [null, "", "latest"]) {
        expect(nextWindowStep(updateWindow({ targetVersion }), idle)).toEqual({ kind: "fail", result: STEP_RESULTS.noTarget });
      }
    });

    it("fails an update whose target is no longer newer than what runs now", () => {
      const expected = { kind: "fail", result: STEP_RESULTS.alreadyRunning("0.2.0") };
      expect(nextWindowStep(updateWindow({ targetVersion: "0.2.0" }), idle)).toEqual(expected);
      expect(nextWindowStep(updateWindow({ targetVersion: "0.1.5" }), idle)).toEqual(expected);
      expect(nextWindowStep(updateWindow({ targetVersion: "0.2.1" }), idle)).toEqual({ kind: "request-update" });
    });

    it("checks the target before the updater: a stale target fails even without a heartbeat", () => {
      expect(nextWindowStep(updateWindow({ targetVersion: "0.2.0" }), { ...idle, heartbeatFresh: false })).toEqual({
        kind: "fail",
        result: STEP_RESULTS.alreadyRunning("0.2.0"),
      });
    });

    it("fails an update when the updater is not reachable", () => {
      expect(nextWindowStep(updateWindow(), { ...idle, heartbeatFresh: false })).toEqual({
        kind: "fail",
        result: STEP_RESULTS.updaterUnreachable,
      });
    });

    it("does not need the updater for a general window", () => {
      expect(nextWindowStep(window({}), { ...idle, heartbeatFresh: false })).toEqual({ kind: "start" });
    });

    it("fails a window that was missed entirely instead of starting it", () => {
      expect(nextWindowStep(window({ startsAt: at(-2 * HOUR), endsAt: at(-HOUR) }), idle)).toEqual({
        kind: "fail",
        result: STEP_RESULTS.missed,
      });
      expect(nextWindowStep(window({ startsAt: at(-2 * HOUR), endsAt: now }), idle)).toEqual({
        kind: "fail",
        result: STEP_RESULTS.missed,
      });
    });
  });

  describe("a running general window", () => {
    const running = window({ status: "IN_PROGRESS", startsAt: at(-HOUR) });

    it("continues until its end", () => {
      expect(nextWindowStep({ ...running, endsAt: at(1) }, idle)).toEqual({ kind: "none" });
    });

    it("completes at its planned end", () => {
      expect(nextWindowStep({ ...running, endsAt: now }, idle)).toEqual({ kind: "complete" });
      expect(nextWindowStep({ ...running, endsAt: at(-1) }, idle)).toEqual({ kind: "complete" });
    });
  });

  describe("a running update window", () => {
    const running = updateWindow({ status: "IN_PROGRESS", startsAt: at(-10 * MINUTE), endsAt: at(5 * MINUTE) });

    it("waits while the updater has reported nothing for this window", () => {
      expect(nextWindowStep(running, idle)).toEqual({ kind: "none" });
      expect(nextWindowStep(running, { ...idle, updaterStatus: status("SUCCEEDED", { id: "older-window" }) })).toEqual({ kind: "none" });
    });

    it("copies new progress, keeping the window in progress", () => {
      const step = nextWindowStep(running, { ...idle, updaterStatus: status("PULLING") });
      expect(step).toEqual({ kind: "sync", status: "IN_PROGRESS", result: "now PULLING", log: [] });
    });

    it("treats a stored null result and an empty updater message as the same, so nothing is rewritten every tick", () => {
      const quiet = status("PENDING", { message: "" });
      expect(nextWindowStep({ ...running, result: null }, { ...idle, updaterStatus: quiet })).toEqual({ kind: "none" });
      expect(nextWindowStep({ ...running, result: "" }, { ...idle, updaterStatus: quiet })).toEqual({ kind: "none" });
    });

    it("stays quiet once the progress is already stored", () => {
      const stored = { ...running, result: "now PULLING", log: "[]" };
      expect(nextWindowStep(stored, { ...idle, updaterStatus: status("PULLING") })).toEqual({ kind: "none" });
      const newLog = [{ at: "t", state: "PULLING", message: "step" }];
      expect(nextWindowStep(stored, { ...idle, updaterStatus: status("PULLING", { log: newLog }) }).kind).toBe("sync");
    });

    it.each([
      ["SUCCEEDED", "COMPLETED"],
      ["FAILED", "FAILED"],
      ["ROLLED_BACK", "ROLLED_BACK"],
    ])("finishes as %s -> %s", (state, expected) => {
      const stored = { ...running, result: `now ${state}` };
      const step = nextWindowStep(stored, { ...idle, updaterStatus: status(state) });
      expect(step).toMatchObject({ kind: "sync", status: expected });
    });

    it("takes a terminal result even long after the planned end", () => {
      const late = { ...running, endsAt: at(-3 * HOUR) };
      expect(nextWindowStep(late, { ...idle, updaterStatus: status("SUCCEEDED") })).toMatchObject({ kind: "sync", status: "COMPLETED" });
    });

    it("times out an hour after the planned end without a terminal state", () => {
      const endsAt = at(-UPDATER_RESULT_GRACE_MS);
      expect(nextWindowStep({ ...running, endsAt }, idle)).toEqual({ kind: "none" });
      const expired = { ...running, endsAt: at(-UPDATER_RESULT_GRACE_MS - 1) };
      expect(nextWindowStep(expired, idle)).toEqual({ kind: "fail", result: STEP_RESULTS.noUpdaterResult });
      expect(nextWindowStep(expired, { ...idle, updaterStatus: status("SWITCHING") })).toEqual({
        kind: "fail",
        result: STEP_RESULTS.noUpdaterResult,
      });
    });
  });

  it("leaves finished windows alone", () => {
    for (const finished of ["COMPLETED", "FAILED", "ROLLED_BACK", "CANCELLED"]) {
      expect(nextWindowStep(window({ status: finished }), idle)).toEqual({ kind: "none" });
    }
  });
});

// ── admin notices ─────────────────────────────────────────────────────────────

describe("outcomeNotice", () => {
  const update = { title: "Update to 0.3.0", kind: "UPDATE", targetVersion: "0.3.0" };
  const general = { title: "Network work", kind: "GENERAL", targetVersion: null };

  it("announces a finished update with its version", () => {
    expect(outcomeNotice(update, "COMPLETED", "ok")?.title).toBe("Servio was updated to 0.3.0");
  });

  it("stays silent when a general window just ended", () => {
    expect(outcomeNotice(general, "COMPLETED", null)).toBeNull();
  });

  it("reports failures with the reason and a missing reason", () => {
    expect(outcomeNotice(update, "FAILED", "Pull failed")).toEqual({ title: "Maintenance failed: Update to 0.3.0", body: "Pull failed" });
    expect(outcomeNotice(general, "FAILED", null)?.body).toBe("No details were reported.");
  });

  it("reports a rollback", () => {
    const notice = outcomeNotice(update, "ROLLED_BACK", "Health check failed");
    expect(notice?.title).toBe("Update rolled back: Update to 0.3.0");
    expect(notice?.body).toContain("previous version is running again");
  });

  it("has nothing to say about windows that did not end", () => {
    expect(outcomeNotice(update, "IN_PROGRESS", null)).toBeNull();
    expect(outcomeNotice(update, "CANCELLED", null)).toBeNull();
  });
});

describe("aborting a stuck update", () => {
  it("is possible only for a running update", () => {
    expect(isAbortable({ kind: "UPDATE", status: "IN_PROGRESS" })).toBe(true);
    expect(isAbortable({ kind: "GENERAL", status: "IN_PROGRESS" })).toBe(false);
    for (const status of ["SCHEDULED", "COMPLETED", "FAILED", "ROLLED_BACK", "CANCELLED"]) {
      expect(isAbortable({ kind: "UPDATE", status }), status).toBe(false);
    }
  });

  it("names the admin in the result", () => {
    expect(abortResult("admin@servio.dev")).toBe("Aborted by admin@servio.dev");
  });

  it("tells the admins about the failure with that result", () => {
    const notice = outcomeNotice({ title: "Update to 0.3.0", kind: "UPDATE", targetVersion: "0.3.0" }, "FAILED", abortResult("a@b.c"));
    expect(notice).toEqual({ title: "Maintenance failed: Update to 0.3.0", body: "Aborted by a@b.c" });
  });
});
