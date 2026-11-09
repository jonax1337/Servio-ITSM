// A running update that the maintenance tick fails (the updater went silent)
// must take its request back: an updater that comes back late would otherwise
// still stop the app and change the version while the window reads FAILED.
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const windows: Array<Record<string, unknown>> = [];

vi.mock("@/lib/db", () => ({
  db: {
    maintenanceWindow: {
      findMany: async ({ where }: { where: { status: { in?: string[] } | string } }) =>
        windows.filter((w) => (typeof where.status === "string" ? w.status === where.status : where.status.in?.includes(w.status as string))),
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: Record<string, unknown> }) => {
        const row = windows.find((w) => w.id === where.id && w.status === where.status);
        if (row) Object.assign(row, data);
        return { count: row ? 1 : 0 };
      },
    },
  },
}));
vi.mock("@/lib/audit", () => ({ writeAudit: async () => {}, notifyAdmins: async () => {} }));

import { withdrawUpdateRequest } from "@/lib/maintenance";
import { runMaintenanceTick } from "@/lib/ticks/maintenance";

const MINUTE = 60_000;
let stateDir: string;
const requestFile = () => join(stateDir, "updater", "request.json");
const writeRequest = (id: string) => {
  mkdirSync(join(stateDir, "updater"), { recursive: true });
  writeFileSync(requestFile(), JSON.stringify({ id, targetVersion: "9.9.9", requestedAt: new Date().toISOString() }));
};

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "servio-withdraw-"));
  vi.stubEnv("SERVIO_STATE_DIR", stateDir);
  windows.length = 0;
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(stateDir, { recursive: true, force: true });
});

describe("withdrawUpdateRequest", () => {
  it("removes the request of this window only", () => {
    writeRequest("other");
    expect(withdrawUpdateRequest("w1")).toBe(true);
    expect(existsSync(requestFile())).toBe(true);

    writeRequest("w1");
    expect(withdrawUpdateRequest("w1")).toBe(true);
    expect(existsSync(requestFile())).toBe(false);
  });

  it("succeeds when there is no request", () => {
    expect(withdrawUpdateRequest("w1")).toBe(true);
  });
});

describe("maintenance tick: a stalled update", () => {
  it("fails the window and withdraws its request", async () => {
    const now = Date.now();
    windows.push({
      id: "w1",
      title: "Update",
      kind: "UPDATE",
      status: "IN_PROGRESS",
      blockAccess: true,
      startsAt: new Date(now - 60 * MINUTE),
      startedAt: new Date(now - 30 * MINUTE),
      endsAt: new Date(now + 60 * MINUTE),
      targetVersion: "9.9.9",
      result: null,
      log: "[]",
      createdBy: null,
    });
    writeRequest("w1");
    // The updater's last heartbeat is long gone.
    writeFileSync(join(stateDir, "updater", "heartbeat.json"), JSON.stringify({ at: new Date(now - 30 * MINUTE).toISOString(), dockerOk: true }));

    await runMaintenanceTick();

    expect(windows[0].status).toBe("FAILED");
    expect(existsSync(requestFile())).toBe(false);
    expect(readFileSync(join(stateDir, "maintenance.json"), "utf8")).toContain('"active": false');
  });
});
