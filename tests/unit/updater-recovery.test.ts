import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CONTAINER_NAME,
  FRESH_REQUESTED_AT,
  IMAGE_REPO,
  NEW_VERSION,
  OLD_DB,
  OLD_VERSION,
  createHarness,
  killOn,
  type Harness,
} from "./updater-test-kit";

const REQUEST = { id: "win-1", targetVersion: NEW_VERSION, requestedAt: FRESH_REQUESTED_AT, requestedBy: "admin@x" };
const PRE_NAME = `${CONTAINER_NAME}-pre-${OLD_VERSION}`;

let harness: Harness;
let oldId: string;

beforeEach(async () => {
  harness = await createHarness();
  oldId = harness.docker.byName(CONTAINER_NAME)!.Id;
  // The new version "migrates" the database as soon as it starts.
  harness.docker.onStart = async (container) => {
    if (container.Id.startsWith("new-")) await writeFile(harness.dbFile, "migrated-by-the-new-version");
  };
});
afterEach(() => harness.cleanup());

const journalPath = () => join(harness.backupDir, ".journal.json");
const exists = (path: string) => stat(path).then(() => true, () => false);
const runningManaged = () => [...harness.docker.containers.values()].filter((c) => c.Name === `/${CONTAINER_NAME}` && c.State.Running);

/** Starts the update and "kills the updater process" at the given Docker call. */
async function killAt(call: string, when: "before" | "after", matches?: (args: string[]) => boolean) {
  const { client, reached } = killOn(harness.docker, call, when, matches);
  await harness.writeRequest(REQUEST);
  void harness.newFlow(client).processPendingRequest();
  await reached;
}

describe("journal", () => {
  it("is written before the old container is stopped and removed when the update finishes", async () => {
    await killAt("stopContainer", "before");

    const journal = JSON.parse(await readFile(journalPath(), "utf8"));
    expect(journal).toMatchObject({ requestId: "win-1", oldId, name: CONTAINER_NAME, preName: PRE_NAME, step: "STOPPING", newId: null });
  });

  it("is gone after a normal update, a rollback and a failure before the stop", async () => {
    await harness.writeRequest(REQUEST);
    await harness.flow.processPendingRequest();
    expect(await exists(journalPath())).toBe(false);

    await harness.cleanup();
    harness = await createHarness();
    harness.docker.newContainerPlan = "never-healthy";
    await harness.writeRequest(REQUEST);
    await harness.flow.processPendingRequest();
    expect(await exists(journalPath())).toBe(false);
  });

  it("records the new container and the backup as the update progresses", async () => {
    await killAt("startContainer", "after", (args) => args[0].startsWith("new-"));

    const journal = JSON.parse(await readFile(journalPath(), "utf8"));
    // Killed after the daemon started the container but before the flow recorded STARTED.
    expect(journal.step).toBe("SWITCHING");
    expect(journal.newId).toBe("new-1");
    expect(journal.backup.path).toContain(`servio-${OLD_VERSION}-`);
  });
});

describe("recovery after the updater was killed", () => {
  const rolledBack = { state: "ROLLED_BACK", db: OLD_DB };
  it.each([
    ["after the old container was stopped", "stopContainer", "after", undefined, { state: "FAILED", db: OLD_DB }],
    ["before the old container was renamed", "renameContainer", "before", undefined, rolledBack],
    ["after the old container was renamed", "renameContainer", "after", undefined, rolledBack],
    ["after the new container was created", "createContainer", "after", undefined, rolledBack],
    ["after the new container was started", "startContainer", "after", (args: string[]) => args[0].startsWith("new-"), rolledBack],
  ] as const)("brings the old version back when killed %s", async (_label, call, when, matches, expected) => {
    await killAt(call, when, matches);

    const restarted = harness.newFlow();
    await restarted.recoverInterrupted();

    const status = await harness.readStatus();
    expect(status).toMatchObject({ id: "win-1", state: expected.state });
    expect(status.message).toContain("Recovered after an updater restart");
    expect(status.message).toContain("updater restarted during step");
    expect(await readFile(harness.dbFile)).toEqual(expected.db);
    expect(await exists(journalPath())).toBe(false);

    const running = runningManaged();
    expect(running).toHaveLength(1);
    expect(running[0].Id).toBe(oldId);
    expect(running[0].Config.Image).toBe(`${IMAGE_REPO}:${OLD_VERSION}`);
    expect([...harness.docker.containers.values()].map((c) => c.Name).sort()).toEqual([`/${CONTAINER_NAME}`]);
    expect(await restarted.processPendingRequest()).toBe("idle");
  });

  it("finishes a switch that was healthy when the updater died before removing the old container", async () => {
    await killAt("removeContainer", "before", (args) => args[0] === oldId);
    expect(JSON.parse(await readFile(journalPath(), "utf8")).step).toBe("SWITCHED");

    await harness.newFlow().recoverInterrupted();

    const status = await harness.readStatus();
    expect(status.state).toBe("SUCCEEDED");
    expect(status.message).toContain("Recovered after an updater restart");
    expect(harness.docker.containers.has(oldId)).toBe(false);
    const running = runningManaged();
    expect(running).toHaveLength(1);
    expect(running[0].Config.Image).toMatch(/^sha256:/);
    expect(await readFile(harness.dbFile, "utf8")).toBe("migrated-by-the-new-version");
    expect(await exists(journalPath())).toBe(false);
  });

  it("restores the database even when the new container was never recorded in the journal", async () => {
    // Killed between createContainer returning and the journal learning the id.
    await killAt("createContainer", "after");
    expect(JSON.parse(await readFile(journalPath(), "utf8")).newId).toBeNull();
    expect(harness.docker.byName(CONTAINER_NAME)?.Id).toBe("new-1");

    await harness.newFlow().recoverInterrupted();

    expect(harness.docker.containers.has("new-1")).toBe(false);
    expect(runningManaged().map((c) => c.Id)).toEqual([oldId]);
  });

  it("keeps the journal and reports ROLLBACK FAILED when the recovery fails, then succeeds on the next start", async () => {
    await killAt("renameContainer", "after");
    let attempts = 0;
    harness.docker.failOn("rename", new Error("daemon unavailable"), () => ++attempts === 1);

    await harness.newFlow().recoverInterrupted();
    const failed = await harness.readStatus();
    expect(failed.state).toBe("FAILED");
    expect(failed.message).toContain("ROLLBACK FAILED — manual action required");
    expect(failed.message).toContain("daemon unavailable");
    expect(await exists(journalPath())).toBe(true);

    await harness.newFlow().recoverInterrupted();
    expect((await harness.readStatus()).state).toBe("ROLLED_BACK");
    expect(await exists(journalPath())).toBe(false);
    expect(runningManaged().map((c) => c.Id)).toEqual([oldId]);
  });

  it("never restores the database underneath an old container that is already running", async () => {
    await killAt("startContainer", "after", (args) => args[0].startsWith("new-"));
    // The previous recovery attempt had already started the old container again.
    harness.docker.containers.get(oldId)!.State.Running = true;
    await writeFile(harness.dbFile, "live-data-written-by-the-old-container");

    await harness.newFlow().recoverInterrupted();

    expect(await readFile(harness.dbFile, "utf8")).toBe("live-data-written-by-the-old-container");
    expect(runningManaged().map((c) => c.Id)).toEqual([oldId]);
  });

  it("does not touch an unrelated container that took the managed name", async () => {
    await killAt("renameContainer", "after");
    harness.docker.add(harness.container({ Id: "stranger", Name: `/${CONTAINER_NAME}`, Config: { Image: "other:1", Labels: {} } }));

    await harness.newFlow().recoverInterrupted();

    expect(harness.docker.containers.has("stranger")).toBe(true);
    expect((await harness.readStatus()).state).toBe("FAILED");
  });
});
