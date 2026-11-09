/**
 * Pure rules for maintenance windows and the maintenance-mode gate: window
 * validation, which banner to show, what the maintenance flag file says, how a
 * window advances and which requests proxy.ts lets through. No I/O: lib/maintenance.ts,
 * lib/ticks/maintenance.ts and proxy.ts feed these functions.
 *
 * Imported by proxy.ts, so it must stay free of Prisma and of runtime imports
 * from lib/constants (icons). Types are imported type-only.
 */
import { format } from "date-fns";
import { windowsOverlap, type TimeWindow } from "@/lib/change-schedule-rules";
import { isNewerVersion, isValidVersion } from "@/lib/update-rules";
import type { MaintenanceKind, MaintenanceStatus, Tone } from "@/lib/constants";

// ── Updater contract (files in SERVIO_STATE_DIR/updater) ──────────────────────

export const UPDATER_STATES = [
  "PENDING",
  "PULLING",
  "BACKING_UP",
  "SWITCHING",
  "HEALTH_CHECK",
  "SUCCEEDED",
  "FAILED",
  "ROLLED_BACK",
] as const;
export type UpdaterState = (typeof UPDATER_STATES)[number];

const TERMINAL_UPDATER_STATES: readonly UpdaterState[] = ["SUCCEEDED", "FAILED", "ROLLED_BACK"];

export const isTerminalUpdaterState = (state: UpdaterState): boolean => TERMINAL_UPDATER_STATES.includes(state);

export type UpdaterLogEntry = { at: string; state: UpdaterState; message: string };

export type UpdaterStatus = {
  id: string;
  state: UpdaterState;
  fromVersion: string | null;
  targetVersion: string;
  message: string;
  updatedAt: string;
  log: UpdaterLogEntry[];
};

export type UpdaterHeartbeat = {
  updaterVersion: string;
  at: string;
  dockerOk: boolean;
  container: string | null;
  image: string | null;
  /**
   * The update request the updater is working on (null: idle). `undefined` when the
   * updater is too old to report it; the app then cannot tell idle from busy.
   */
  activeRequestId?: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object";
const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);
const isUpdaterState = (value: unknown): value is UpdaterState => UPDATER_STATES.includes(value as UpdaterState);

function parseLogEntry(entry: unknown): UpdaterLogEntry | null {
  if (!isRecord(entry) || !isUpdaterState(entry.state)) return null;
  return { at: asString(entry.at) ?? "", state: entry.state, message: asString(entry.message) ?? "" };
}

/** The log stored on a window (a JSON array copied from the updater); empty when it is not one. */
export function parseWindowLog(stored: string): UpdaterLogEntry[] {
  try {
    const raw: unknown = JSON.parse(stored);
    return Array.isArray(raw) ? raw.map(parseLogEntry).filter((e): e is UpdaterLogEntry => e !== null) : [];
  } catch {
    return [];
  }
}

/** The updater's status.json, or null when absent or not in the documented shape. */
export function parseUpdaterStatus(raw: unknown): UpdaterStatus | null {
  if (!isRecord(raw)) return null;
  const id = asString(raw.id);
  const targetVersion = asString(raw.targetVersion);
  if (!id || !targetVersion || !isUpdaterState(raw.state)) return null;
  return {
    id,
    state: raw.state,
    fromVersion: asString(raw.fromVersion),
    targetVersion,
    message: asString(raw.message) ?? "",
    updatedAt: asString(raw.updatedAt) ?? "",
    log: Array.isArray(raw.log) ? raw.log.map(parseLogEntry).filter((e): e is UpdaterLogEntry => e !== null) : [],
  };
}

/** The updater's heartbeat.json, or null when absent or not in the documented shape. */
export function parseUpdaterHeartbeat(raw: unknown): UpdaterHeartbeat | null {
  if (!isRecord(raw)) return null;
  const at = asString(raw.at);
  if (!at || Number.isNaN(Date.parse(at))) return null;
  return {
    updaterVersion: asString(raw.updaterVersion) ?? "unknown",
    at,
    dockerOk: raw.dockerOk === true,
    container: asString(raw.container),
    image: asString(raw.image),
    ...("activeRequestId" in raw ? { activeRequestId: asString(raw.activeRequestId) } : {}),
  };
}

/** The updater counts as connected while its heartbeat is younger than this. */
export const HEARTBEAT_MAX_AGE_MS = 60_000;

/** Default for UPDATER_STALE_MINUTES: how long a running update may go without any sign of progress. */
export const DEFAULT_UPDATER_STALE_MINUTES = 10;
const MAX_UPDATER_STALE_MINUTES = 24 * 60;

/** UPDATER_STALE_MINUTES as milliseconds; the default for anything that is not a whole number of minutes from 1 to 1440. */
export function updaterStaleMs(raw: string | undefined): number {
  const minutes = Number(raw);
  const valid = raw !== undefined && raw.trim() !== "" && Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_UPDATER_STALE_MINUTES;
  return (valid ? minutes : DEFAULT_UPDATER_STALE_MINUTES) * 60_000;
}

/** Connected = a heartbeat younger than a minute that reports a working Docker connection. */
export function heartbeatFresh(heartbeat: UpdaterHeartbeat | null, now: Date): boolean {
  if (!heartbeat?.dockerOk) return false;
  return now.getTime() - Date.parse(heartbeat.at) < HEARTBEAT_MAX_AGE_MS;
}

/** The status of the updater's last run, only when it belongs to this window. */
export const statusForWindow = (status: UpdaterStatus | null, windowId: string): UpdaterStatus | null =>
  status?.id === windowId ? status : null;

export function updaterStateToWindowStatus(state: UpdaterState): MaintenanceStatus {
  if (state === "SUCCEEDED") return "COMPLETED";
  if (state === "FAILED") return "FAILED";
  if (state === "ROLLED_BACK") return "ROLLED_BACK";
  return "IN_PROGRESS";
}

// ── Windows ───────────────────────────────────────────────────────────────────

/** Statuses in which a window still occupies its time slot (no other window may overlap it). */
export const OPEN_MAINTENANCE_STATUSES: readonly MaintenanceStatus[] = ["SCHEDULED", "IN_PROGRESS"];

export const MAX_WINDOW_HOURS = 24;
export const MAX_ANNOUNCE_HOURS = 24 * 14;
/** A window may be created with a start this far in the past (clock skew between browser and server). */
const START_GRACE_MS = 60_000;
/** How long after a window's planned end the updater may still report its result. */
export const UPDATER_RESULT_GRACE_MS = 60 * 60_000;
const HOUR_MS = 3_600_000;

export type WindowSlot = { id: string; title: string; startsAt: Date; endsAt: Date };

export type WindowDraft = {
  kind: MaintenanceKind;
  startsAt: Date;
  endsAt: Date;
  targetVersion: string | null;
};

export const WINDOW_ERRORS = {
  endBeforeStart: "The window must end after it starts.",
  startInPast: "The window cannot start in the past.",
  tooLong: `A maintenance window can last at most ${MAX_WINDOW_HOURS} hours.`,
  noTarget: "Choose the version to update to.",
  updaterOffline:
    "The updater is not connected, so an update cannot run. Start the updater service first (see the update guide).",
  notNewer: (target: string, current: string) =>
    `Version ${target} is not newer than the installed version ${current}.`,
  overlap: (title: string) => `The window overlaps "${title}". Maintenance windows cannot overlap.`,
};

function updateError(draft: WindowDraft, currentVersion: string, updaterConnected: boolean): string | null {
  if (draft.kind !== "UPDATE") return null;
  if (!updaterConnected) return WINDOW_ERRORS.updaterOffline;
  if (!draft.targetVersion || !isValidVersion(draft.targetVersion)) return WINDOW_ERRORS.noTarget;
  if (!isNewerVersion(draft.targetVersion, currentVersion)) {
    return WINDOW_ERRORS.notNewer(draft.targetVersion, currentVersion);
  }
  return null;
}

/**
 * The first reason `draft` cannot be scheduled, or null. `existing` are the other
 * open (SCHEDULED / IN_PROGRESS) windows; a window being rescheduled is not among them.
 */
export function validateWindow(
  draft: WindowDraft,
  context: { now: Date; existing: WindowSlot[]; currentVersion: string; updaterConnected: boolean },
): string | null {
  const { startsAt, endsAt } = draft;
  if (endsAt.getTime() <= startsAt.getTime()) return WINDOW_ERRORS.endBeforeStart;
  if (startsAt.getTime() < context.now.getTime() - START_GRACE_MS) return WINDOW_ERRORS.startInPast;
  if (endsAt.getTime() - startsAt.getTime() > MAX_WINDOW_HOURS * HOUR_MS) return WINDOW_ERRORS.tooLong;
  const updateProblem = updateError(draft, context.currentVersion, context.updaterConnected);
  if (updateProblem) return updateProblem;
  const clash = context.existing.find((slot) => windowsOverlap({ start: startsAt, end: endsAt }, toTimeWindow(slot)));
  return clash ? WINDOW_ERRORS.overlap(clash.title) : null;
}

const toTimeWindow = (slot: WindowSlot): TimeWindow => ({ start: slot.startsAt, end: slot.endsAt });

const WINDOW_DATE = "PP p";

export function describeWindow(window: { title: string; startsAt: Date; endsAt: Date }): string {
  return `${window.title} (${format(window.startsAt, WINDOW_DATE)} – ${format(window.endsAt, WINDOW_DATE)})`;
}

// ── Banners ───────────────────────────────────────────────────────────────────

export type BannerWindow = {
  id: string;
  title: string;
  message: string | null;
  kind: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  announceHours: number;
  blockAccess: boolean;
};

/** When the banner's window runs: a start and end, or only the planned end of a window already running. Dates stay ISO strings so the browser formats them in the viewer's time zone. */
export type BannerPeriod = { startsAt: string | null; endsAt: string };

export type MaintenanceBanner = { tone: Tone; title: string; text: string; period: BannerPeriod; href?: string };

/** Where a viewer can read about maintenance: admins manage it, agents and users see it on the status pages. */
function bannerHref(role: string): string {
  if (role === "ADMIN") return "/settings/updates";
  return role === "USER" ? "/portal/status" : "/status";
}

/** The window's own message wins; the fixed sentence only stands in when there is none. */
const textFor = (message: string | null, fallback: string): string => message ?? fallback;

function inProgressBanner(window: BannerWindow, role: string): MaintenanceBanner {
  const period = { startsAt: null, endsAt: window.endsAt.toISOString() };
  const href = bannerHref(role);
  if (role === "ADMIN" && window.blockAccess) {
    return { tone: "warning", title: "Maintenance mode is on", text: "Users see the maintenance page.", period, href };
  }
  return { tone: "warning", title: `Maintenance in progress: ${window.title}`, text: textFor(window.message, ""), period, href };
}

function scheduledBanner(window: BannerWindow, role: string): MaintenanceBanner {
  return {
    tone: "info",
    title: `Planned maintenance: ${window.title}`,
    text: textFor(window.message, window.blockAccess ? "Servio will be unavailable." : ""),
    period: { startsAt: window.startsAt.toISOString(), endsAt: window.endsAt.toISOString() },
    href: bannerHref(role),
  };
}

const isAnnounced = (window: BannerWindow, now: Date): boolean =>
  window.startsAt.getTime() > now.getTime() &&
  window.startsAt.getTime() - window.announceHours * HOUR_MS <= now.getTime();

/** The banner for a viewer: a running window wins, otherwise the next announced one. */
export function bannerFor(windows: BannerWindow[], now: Date, viewerRole: string): MaintenanceBanner | null {
  const running = windows.find((w) => w.status === "IN_PROGRESS");
  if (running) return inProgressBanner(running, viewerRole);
  const upcoming = windows
    .filter((w) => w.status === "SCHEDULED" && isAnnounced(w, now))
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  return upcoming.length > 0 ? scheduledBanner(upcoming[0], viewerRole) : null;
}

// ── Maintenance flag (maintenance.json) and the proxy gate ────────────────────

export type MaintenanceFlag = {
  active: boolean;
  windowId: string;
  title: string;
  message: string | null;
  endsAt: string;
  kind: MaintenanceKind;
};

/** What `GET /api/maintenance` tells anonymous visitors: the flag without internal ids. */
export type PublicMaintenance = Omit<MaintenanceFlag, "windowId">;

/** The flag written for the running window that blocks access; null when nothing blocks. */
export function flagForWindows(
  windows: Pick<BannerWindow, "id" | "title" | "message" | "kind" | "status" | "endsAt" | "blockAccess">[],
): MaintenanceFlag | null {
  const blocking = windows.find((w) => w.status === "IN_PROGRESS" && w.blockAccess);
  if (!blocking) return null;
  return {
    active: true,
    windowId: blocking.id,
    title: blocking.title,
    message: blocking.message,
    endsAt: blocking.endsAt.toISOString(),
    kind: blocking.kind as MaintenanceKind,
  };
}

/** The active flag in maintenance.json, or null when the file is absent, half-written or inactive. */
export function parseMaintenanceFlag(raw: unknown): MaintenanceFlag | null {
  if (!isRecord(raw) || raw.active !== true) return null;
  const title = asString(raw.title);
  const endsAt = asString(raw.endsAt);
  if (!title || !endsAt) return null;
  return {
    active: true,
    windowId: asString(raw.windowId) ?? "",
    title,
    message: asString(raw.message),
    endsAt,
    kind: raw.kind === "UPDATE" ? "UPDATE" : "GENERAL",
  };
}

export function toPublicMaintenance(flag: MaintenanceFlag | null): PublicMaintenance | null {
  if (!flag) return null;
  const { windowId: _internal, ...visible } = flag;
  return visible;
}

export type GateDecision = "allow" | "maintenance-page" | "maintenance-api";

/** Reachable during maintenance by everyone: sign-in (and the Docker health probe on /login), the maintenance page and its status API, the health endpoint, assets. */
const ALWAYS_ALLOWED_PREFIXES = ["/login", "/api/auth", "/maintenance", "/api/maintenance", "/api/v1/health", "/_next", "/brand"];
/** Mirrors the proxy matcher: shallow image files (favicon, /img/logo.svg) never carry data. */
const SHALLOW_ASSET = /^\/(?:[^/]+\/)?[^/]+\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/;

const matchesPrefix = (path: string, prefix: string): boolean => path === prefix || path.startsWith(`${prefix}/`);

function isAlwaysAllowed(path: string): boolean {
  return ALWAYS_ALLOWED_PREFIXES.some((prefix) => matchesPrefix(path, prefix)) || SHALLOW_ASSET.test(path);
}

/** What the proxy does with a request while a maintenance flag may be active. Admins keep full access. */
export function maintenanceGate(input: { path: string; role: string; state: MaintenanceFlag | null }): GateDecision {
  const { path, role, state } = input;
  if (!state?.active || role === "ADMIN" || isAlwaysAllowed(path)) return "allow";
  return matchesPrefix(path, "/api") ? "maintenance-api" : "maintenance-page";
}

// ── The tick's next step ──────────────────────────────────────────────────────

export type TickWindow = {
  id: string;
  kind: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  result: string | null;
  targetVersion: string | null;
  /** The stored JSON log, compared against the updater's to detect progress. */
  log: string;
  /** When the window moved to IN_PROGRESS (the update request was written then). */
  startedAt?: Date | null;
};

export type WindowStep =
  | { kind: "none" }
  /** Move to IN_PROGRESS (a GENERAL window; maintenance mode begins). */
  | { kind: "start" }
  /** Move to IN_PROGRESS and hand the update to the updater. */
  | { kind: "request-update" }
  /** End in FAILED without further work. */
  | { kind: "fail"; result: string }
  /** Copy the updater's progress; `status` is the window status it maps to. */
  | { kind: "sync"; status: MaintenanceStatus; result: string; log: UpdaterLogEntry[] }
  /** A GENERAL window reached its planned end. */
  | { kind: "complete" };

export const STEP_RESULTS = {
  updaterUnreachable: "Updater not reachable",
  noUpdaterResult: "Updater did not report a result",
  missed: "Servio was not running when this window was due, so it never started",
  noTarget: "No target version",
  alreadyRunning: (version: string) => `Already running ${version}`,
  updaterSilent: (minutes: number, state: string) =>
    `The updater stopped reporting: no heartbeat for more than ${minutes} minutes while the update was ${state}. ` +
    "Its outcome is unknown: check the updater's log and `docker ps -a`, and restore the previous container if the application is down.",
  updaterLostTrack: (minutes: number, state: string) =>
    `The updater is running but no longer working on this update, and reported no result for more than ${minutes} minutes ` +
    `(last state: ${state}); it most likely could not write its status file, for example on a full disk. ` +
    "Check the updater's log and `docker ps -a`.",
};

const describeState = (status: UpdaterStatus | null): string => (status ? status.state : "not yet started");

function scheduledStep(window: TickWindow, input: StepInput): WindowStep {
  if (window.startsAt.getTime() > input.now.getTime()) return { kind: "none" };
  if (window.endsAt.getTime() <= input.now.getTime()) return { kind: "fail", result: STEP_RESULTS.missed };
  if (window.kind !== "UPDATE") return { kind: "start" };
  return updateStartStep(window, input);
}

/** Starting an update: the target must still be newer than what runs now and the updater must be reachable. */
function updateStartStep(window: TickWindow, input: StepInput): WindowStep {
  if (!window.targetVersion || !isValidVersion(window.targetVersion)) return { kind: "fail", result: STEP_RESULTS.noTarget };
  if (!isNewerVersion(window.targetVersion, input.currentVersion)) {
    return { kind: "fail", result: STEP_RESULTS.alreadyRunning(input.currentVersion) };
  }
  return input.heartbeatFresh ? { kind: "request-update" } : { kind: "fail", result: STEP_RESULTS.updaterUnreachable };
}

function runningUpdateStep(window: TickWindow, input: StepInput): WindowStep {
  const status = statusForWindow(input.updaterStatus, window.id);
  const timedOut = input.now.getTime() > window.endsAt.getTime() + UPDATER_RESULT_GRACE_MS;
  if (status && isTerminalUpdaterState(status.state)) return syncStep(status);
  if (timedOut) return { kind: "fail", result: STEP_RESULTS.noUpdaterResult };
  const stalled = stalledUpdate(window, status, input);
  if (stalled) return { kind: "fail", result: stalled };
  if (status && hasProgressed(window, status)) return syncStep(status);
  return { kind: "none" };
}

/**
 * Why a running update will never report its result, or null while it may. Only
 * once nothing moved for `staleAfterMs` (no status change since the request was
 * handed over or last reported): then the heartbeat has stopped too (the updater
 * is down, or cannot write to the shared volume, e.g. a full disk), or the
 * updater is alive but works on nothing for this window (its final status.json
 * write failed). A busy updater (a long pull, a health check) is left alone.
 */
function stalledUpdate(window: TickWindow, status: UpdaterStatus | null, input: StepInput): string | null {
  if (input.updaterHeartbeat === undefined) return null;
  const staleAfterMs = input.staleAfterMs ?? DEFAULT_UPDATER_STALE_MINUTES * 60_000;
  const now = input.now.getTime();
  const lastProgress = Math.max((window.startedAt ?? window.startsAt).getTime(), Date.parse(status?.updatedAt ?? "") || 0);
  if (now - lastProgress <= staleAfterMs) return null;

  const minutes = Math.round(staleAfterMs / 60_000);
  const heartbeat = input.updaterHeartbeat;
  const beatAge = heartbeat ? now - Date.parse(heartbeat.at) : Number.POSITIVE_INFINITY;
  if (!(beatAge <= staleAfterMs)) return STEP_RESULTS.updaterSilent(minutes, describeState(status));
  if (heartbeat && heartbeat.activeRequestId !== undefined && heartbeat.activeRequestId !== window.id) {
    return STEP_RESULTS.updaterLostTrack(minutes, describeState(status));
  }
  return null;
}

const syncStep = (status: UpdaterStatus): WindowStep => ({
  kind: "sync",
  status: updaterStateToWindowStatus(status.state),
  result: status.message,
  log: status.log,
});

const hasProgressed = (window: TickWindow, status: UpdaterStatus): boolean =>
  (window.result ?? "") !== status.message || JSON.stringify(status.log) !== window.log;

function runningStep(window: TickWindow, input: StepInput): WindowStep {
  if (window.kind === "UPDATE") return runningUpdateStep(window, input);
  return window.endsAt.getTime() <= input.now.getTime() ? { kind: "complete" } : { kind: "none" };
}

type StepInput = {
  now: Date;
  heartbeatFresh: boolean;
  updaterStatus: UpdaterStatus | null;
  /** The version running now (APP_VERSION). */
  currentVersion: string;
  /** heartbeat.json (null: absent). Leaving it out skips the stall detection. */
  updaterHeartbeat?: UpdaterHeartbeat | null;
  /** UPDATER_STALE_MINUTES in milliseconds. */
  staleAfterMs?: number;
};

/** The one transition the maintenance tick performs for `window` right now. */
export function nextWindowStep(window: TickWindow, input: StepInput): WindowStep {
  if (window.status === "SCHEDULED") return scheduledStep(window, input);
  if (window.status === "IN_PROGRESS") return runningStep(window, input);
  return { kind: "none" };
}

// ── Admin notices ─────────────────────────────────────────────────────────────

export type OutcomeNotice = { title: string; body: string };

type FinishedWindow = { title: string; kind: string; targetVersion: string | null };

/** The notice admins get when a window ends; null when nothing needs their attention (a general window that simply ended). */
export function outcomeNotice(window: FinishedWindow, status: MaintenanceStatus, result: string | null): OutcomeNotice | null {
  const detail = result ?? "No details were reported.";
  if (status === "COMPLETED") {
    return window.kind === "UPDATE"
      ? { title: `Servio was updated to ${window.targetVersion}`, body: window.title }
      : null;
  }
  if (status === "ROLLED_BACK") {
    return { title: `Update rolled back: ${window.title}`, body: `The previous version is running again. ${detail}` };
  }
  if (status === "FAILED") {
    return { title: `Maintenance failed: ${window.title}`, body: detail };
  }
  return null;
}

const MIN_RETRY_AFTER_SECONDS = 30;

/** Seconds to put in `Retry-After` while the flag is active: until the planned end, but never less than 30. */
export function retryAfterSeconds(flag: MaintenanceFlag, now: Date): number {
  const untilEnd = Math.ceil((Date.parse(flag.endsAt) - now.getTime()) / 1000);
  return Math.max(MIN_RETRY_AFTER_SECONDS, Number.isFinite(untilEnd) ? untilEnd : 0);
}

// ── Aborting a stuck update ───────────────────────────────────────────────────

/** Only a running update can get stuck on the updater; general windows end themselves. */
export const isAbortable = (window: { kind: string; status: string }): boolean =>
  window.kind === "UPDATE" && window.status === "IN_PROGRESS";

export const abortResult = (adminEmail: string): string => `Aborted by ${adminEmail}`;
