import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runUpdater } from "../../updater/service.mjs";
import {
  CONTAINER_NAME,
  FRESH_REQUESTED_AT,
  NEW_VERSION,
  OLD_DB,
  createHarness,
  killOn,
  type Harness,
} from "./updater-test-kit";

const REQUEST = { id: "win-1", targetVersion: NEW_VERSION, requestedAt: FRESH_REQUESTED_AT, requestedBy: "admin@x" };

let harness: Harness;
let stop: AbortController;
let logLines: string[];

beforeEach(async () => {
  harness = await createHarness();
  stop = new AbortController();
  logLines = [];
});
afterEach(() => harness.cleanup());

const exists = (path: string) => stat(path).then(() => true, () => false);

/** Runs the service with short loop intervals; `onLine` sees every log line (e.g. to send SIGTERM). */
function start(onLine: (line: string) => void = () => {}) {
  return runUpdater({
    config: { ...harness.config, pollIntervalMs: 5, heartbeatIntervalMs: 5 },
    docker: harness.docker.asClient(),
    signal: stop.signal,
    clock: harness.clock,
    log: (line) => {
      logLines.push(line);
      onLine(line);
    },
  });
}

const stopOnceRunning = (line: string) => {
  if (line.includes(" managing ")) stop.abort();
};

describe("updater service start-up (finding M1)", () => {
  it("recovers an interrupted update before touching the app-writable state directory", async () => {
    const { client, reached } = killOn(harness.docker, "startContainer", "after", (args) => args[0].startsWith("new-"));
    await harness.writeRequest(REQUEST);
    void harness.newFlow(client).processPendingRequest();
    await reached;
    // The app sabotages the state directory while the updater is down.
    await rm(harness.stateDir, { recursive: true });
    await writeFile(harness.stateDir, "not a directory");

    await start(stopOnceRunning);

    expect(await readFile(harness.dbFile)).toEqual(OLD_DB);
    expect(harness.docker.byName(CONTAINER_NAME)?.State.Running).toBe(true);
    expect(await exists(join(harness.backupDir, ".journal.json"))).toBe(false);
    expect(logLines.some((line) => line.includes("state directory unusable, continuing"))).toBe(true);
    expect(logLines.at(-1)).toBe("[updater] stopped");
  });

  it("waits for Docker before recovering instead of giving up on the first failed call", async () => {
    let pings = 0;
    harness.docker.failOn("ping", new Error("proxy not up yet"), () => ++pings === 1);
    const lines: string[] = [];

    await start((line) => {
      lines.push(line);
      stopOnceRunning(line);
    });

    expect(lines[0]).toContain("waiting for Docker");
    expect(pings).toBeGreaterThanOrEqual(2);
  });
});

describe("updater service shutdown", () => {
  it("lets an update that is in progress finish when SIGTERM arrives", async () => {
    harness.docker.onPull = () => stop.abort();
    await harness.writeRequest(REQUEST);

    await start();

    expect((await harness.readStatus()).state).toBe("SUCCEEDED");
    expect(logLines.at(-1)).toBe("[updater] stopped");
  });

  it("stops without recovering or polling when SIGTERM arrives while waiting for Docker", async () => {
    harness.docker.failOn("ping", new Error("down"));
    setTimeout(() => stop.abort(), 20);

    await start();

    expect(harness.docker.calls.every((call) => call === "ping")).toBe(true);
    expect(logLines.some((line) => line.includes(" managing "))).toBe(false);
  });
});
