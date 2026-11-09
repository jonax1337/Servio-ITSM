import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DockerApiError, type DockerClient } from "../../updater/docker-client.mjs";
import {
  CONTAINER_NAME,
  FRESH_REQUESTED_AT,
  IMAGE_REPO,
  NEW_VERSION,
  OLD_DB,
  OLD_VERSION,
  createHarness,
  killOn,
  unreachable,
  type Harness,
} from "./updater-test-kit";

const REQUEST = { id: "win-1", targetVersion: NEW_VERSION, requestedAt: FRESH_REQUESTED_AT, requestedBy: "admin@x" };
const PRE_NAME = `${CONTAINER_NAME}-pre-${OLD_VERSION}`;
const ORIGINAL_POLICY = { Name: "unless-stopped" };
const TERMINAL = ["SUCCEEDED", "FAILED", "ROLLED_BACK"];

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
const readJournal = async () => JSON.parse(await readFile(journalPath(), "utf8"));
const exists = (path: string) => stat(path).then(() => true, () => false);
const asideJournals = async () => (await readdir(harness.backupDir)).filter((name) => name.startsWith(".journal.manual-"));
const runningManaged = () => [...harness.docker.containers.values()].filter((c) => c.Name === `/${CONTAINER_NAME}` && c.State.Running);
const destructiveCalls = () => harness.docker.calls.filter((call) => /^(stop|remove|rename) /.test(call));

/** Starts the update and "kills the updater process" at the given Docker call. */
async function killAt(call: string, when: "before" | "after", matches?: (args: string[]) => boolean) {
  const { client, reached } = killOn(harness.docker, call, when, matches);
  await harness.writeRequest(REQUEST);
  void harness.newFlow(client).processPendingRequest();
  await reached;
}

/** Restarts the updater: a fresh flow runs start-up recovery. */
async function restartUpdater() {
  const restarted = harness.newFlow();
  await restarted.recoverInterrupted();
  return restarted;
}

describe("journal", () => {
  it("is written before the old container is stopped and removed when the update finishes", async () => {
    await killAt("stopContainer", "before");

    expect(await readJournal()).toMatchObject({
      requestId: "win-1",
      oldId,
      name: CONTAINER_NAME,
      preName: PRE_NAME,
      step: "STOPPING",
      newId: null,
      newImageId: `sha256:id-of-${IMAGE_REPO}:${NEW_VERSION}`,
      restartPolicy: ORIGINAL_POLICY,
    });
  });

  it("is gone after a normal update and after a rollback", async () => {
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

    const journal = await readJournal();
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

    const restarted = await restartUpdater();

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
    expect(running[0].HostConfig.RestartPolicy).toEqual(ORIGINAL_POLICY);
    expect([...harness.docker.containers.values()].map((c) => c.Name).sort()).toEqual([`/${CONTAINER_NAME}`]);
    expect(await restarted.processPendingRequest()).toBe("idle");
  });

  it("finishes a switch that was healthy when the updater died before removing the old container", async () => {
    await killAt("removeContainer", "before", (args) => args[0] === oldId);
    expect((await readJournal()).step).toBe("SWITCHED");

    await restartUpdater();

    const status = await harness.readStatus();
    expect(status.state).toBe("SUCCEEDED");
    expect(status.message).toContain("Recovered after an updater restart");
    expect(harness.docker.containers.has(oldId)).toBe(false);
    const running = runningManaged();
    expect(running).toHaveLength(1);
    expect(running[0].Config.Image).toBe(`${IMAGE_REPO}:${NEW_VERSION}`);
    expect(await readFile(harness.dbFile, "utf8")).toBe("migrated-by-the-new-version");
    expect(await exists(journalPath())).toBe(false);
  });

  it("removes the new container even when it was never recorded in the journal, by its request label and image", async () => {
    // Killed between createContainer returning and the journal learning the id.
    await killAt("createContainer", "after");
    expect((await readJournal()).newId).toBeNull();
    expect(harness.docker.byName(CONTAINER_NAME)?.Config.Labels["servio.updater.request"]).toBe("win-1");

    await restartUpdater();

    expect(harness.docker.containers.has("new-1")).toBe(false);
    expect(runningManaged().map((c) => c.Id)).toEqual([oldId]);
  });

  it("treats a backup cut short by the kill as no backup: the old container just starts again", async () => {
    await killAt("stopContainer", "after");
    // What a copy interrupted by the kill leaves behind.
    await writeFile(join(harness.backupDir, `servio-${OLD_VERSION}-20261106T100000Z.db.partial-0b5c7a52-1d1e-4c39-9c1a-6c0d1d1f0b8e`), "half");

    await restartUpdater();

    const status = await harness.readStatus();
    expect(status.state).toBe("FAILED");
    expect(status.message).toContain("nothing was changed");
    expect(await readFile(harness.dbFile)).toEqual(OLD_DB);
    expect(runningManaged().map((c) => c.Id)).toEqual([oldId]);
    expect((await harness.backupFiles()).filter((name) => name.endsWith(".db"))).toEqual([]);
  });

  it("does not restore the database twice when killed during the rollback after the restore", async () => {
    harness.docker.newContainerPlan = "never-healthy";
    await killAt("renameContainer", "before", (args) => args[0] === oldId && args[1] === CONTAINER_NAME);
    expect((await readJournal()).step).toBe("RESTORED");
    expect(await readFile(harness.dbFile)).toEqual(OLD_DB);

    await restartUpdater();

    expect((await harness.readStatus()).state).toBe("ROLLED_BACK");
    expect(runningManaged().map((c) => c.Id)).toEqual([oldId]);
    expect(await exists(journalPath())).toBe(false);
  });

  it("keeps what the restarted old container wrote when killed after the rollback started it", async () => {
    harness.docker.newContainerPlan = "never-healthy";
    await killAt("startContainer", "after", (args) => args[0] === oldId);
    await writeFile(harness.dbFile, "live-data-written-by-the-old-container");

    await restartUpdater();

    expect((await harness.readStatus()).state).toBe("ROLLED_BACK");
    expect(await readFile(harness.dbFile, "utf8")).toBe("live-data-written-by-the-old-container");
    expect(runningManaged().map((c) => c.Id)).toEqual([oldId]);
  });
});

describe("recovery after the final status was written but before the journal was cleared (finding L4)", () => {
  /** Runs the update to the end, then puts back the journal as it was at `call`, as if the kill came just before its removal. */
  async function runAndRestoreJournalFrom(call: string, matches: (args: string[]) => boolean) {
    let snapshot = "";
    const client = new Proxy(harness.docker, {
      get(target, property) {
        const value = Reflect.get(target, property) as unknown;
        if (typeof value !== "function") return value;
        if (property !== call) return value.bind(target);
        return async (...args: string[]) => {
          if (matches(args)) snapshot = await readFile(journalPath(), "utf8");
          return value.apply(target, args);
        };
      },
    }) as unknown as DockerClient;
    await harness.writeRequest(REQUEST);
    await harness.newFlow(client).processPendingRequest();
    await writeFile(journalPath(), snapshot);
    return (await harness.readStatus()).state;
  }

  it("replays a finished update harmlessly", async () => {
    expect(await runAndRestoreJournalFrom("removeContainer", (args) => args[0] === oldId)).toBe("SUCCEEDED");
    const serving = runningManaged()[0].Id;
    const calls = destructiveCalls().length;

    await restartUpdater();

    expect((await harness.readStatus()).state).toBe("SUCCEEDED");
    expect(runningManaged().map((c) => c.Id)).toEqual([serving]);
    expect(destructiveCalls()).toHaveLength(calls);
    expect(await exists(journalPath())).toBe(false);
  });

  it("replays a finished rollback harmlessly", async () => {
    harness.docker.newContainerPlan = "never-healthy";
    expect(await runAndRestoreJournalFrom("startContainer", (args) => args[0] === oldId)).toBe("ROLLED_BACK");
    await writeFile(harness.dbFile, "live-data-written-after-the-rollback");

    await restartUpdater();

    expect((await harness.readStatus()).state).toBe("ROLLED_BACK");
    expect(await readFile(harness.dbFile, "utf8")).toBe("live-data-written-after-the-rollback");
    expect(runningManaged().map((c) => c.Id)).toEqual([oldId]);
  });
});

describe("recovery when the containers no longer match the journal (finding H2)", () => {
  /** An operator's `docker compose up -d`: a fresh managed container under the managed name. */
  const operatorContainer = () =>
    harness.docker.add(harness.container({ Id: "operator-made", Name: `/${CONTAINER_NAME}`, Image: "sha256:compose-pulled" }));

  async function expectLeftAloneForTheOperator() {
    const status = await harness.readStatus();
    expect(status.state).toBe("FAILED");
    expect(status.message).toContain("MANUAL ACTION REQUIRED");
    // The old container may still carry the suspended policy (review item 6).
    expect(status.message).toContain(`docker update --restart unless-stopped ${oldId.slice(0, 12)}`);
    expect(status.message).toContain("Database backup: "); // review S3
    expect(await exists(journalPath())).toBe(false);
    expect(await asideJournals()).toHaveLength(1);
    expect(status.message).toContain(join(harness.backupDir, (await asideJournals())[0]));
  }

  it("leaves a managed container that it did not create in place", async () => {
    await killAt("renameContainer", "after");
    harness.docker.byName(PRE_NAME)!.State.Running = false;
    operatorContainer();
    const before = destructiveCalls().length;

    await restartUpdater();

    await expectLeftAloneForTheOperator();
    expect(harness.docker.containers.has("operator-made")).toBe(true);
    expect(harness.docker.byName(PRE_NAME)?.Id).toBe(oldId);
    expect(destructiveCalls()).toHaveLength(before);
  });

  it("does not touch an unrelated container that took the managed name", async () => {
    await killAt("renameContainer", "after");
    harness.docker.add(harness.container({ Id: "stranger", Name: `/${CONTAINER_NAME}`, Config: { Image: "other:1", Labels: {} } }));

    await restartUpdater();

    await expectLeftAloneForTheOperator();
    expect(harness.docker.containers.has("stranger")).toBe(true);
  });

  it("changes nothing when the previous container no longer exists", async () => {
    await killAt("startContainer", "after", (args) => args[0].startsWith("new-"));
    harness.docker.containers.delete(oldId);
    const before = destructiveCalls().length;

    await restartUpdater();

    await expectLeftAloneForTheOperator();
    expect(harness.docker.containers.has("new-1")).toBe(true);
    expect(await readFile(harness.dbFile, "utf8")).toBe("migrated-by-the-new-version");
    expect(destructiveCalls()).toHaveLength(before);
  });

  it("never restores the database underneath an old container that someone started again", async () => {
    await killAt("startContainer", "after", (args) => args[0].startsWith("new-"));
    harness.docker.containers.get(oldId)!.State.Running = true;
    await writeFile(harness.dbFile, "live-data-written-by-the-old-container");

    await restartUpdater();

    await expectLeftAloneForTheOperator();
    expect(await readFile(harness.dbFile, "utf8")).toBe("live-data-written-by-the-old-container");
    expect(harness.docker.containers.has(oldId)).toBe(true);
  });

  it("does not remove the old container after a healthy switch when the operator brought it back", async () => {
    await killAt("removeContainer", "before", (args) => args[0] === oldId);
    // The operator removed the new container and put the old one back.
    harness.docker.containers.delete("new-1");
    const old = harness.docker.containers.get(oldId)!;
    old.Name = `/${CONTAINER_NAME}`;
    old.State.Running = true;

    await restartUpdater();

    await expectLeftAloneForTheOperator();
    expect(runningManaged().map((c) => c.Id)).toEqual([oldId]);
  });

  it("keeps the journal live and removes nothing while Docker cannot be asked whether the switch still holds", async () => {
    await killAt("removeContainer", "before", (args) => args[0] === oldId);
    let dockerAway = true;
    const failing = new Proxy(harness.docker, {
      get(target, property) {
        const value = Reflect.get(target, property) as unknown;
        if (typeof value !== "function") return value;
        if (property === "inspectContainer" && dockerAway) return () => Promise.reject(unreachable());
        return value.bind(target);
      },
    }) as unknown as DockerClient;
    const restarted = harness.newFlow(failing);

    await restarted.recoverInterrupted();
    expect(await exists(journalPath())).toBe(true);
    expect(await asideJournals()).toEqual([]);
    expect(harness.docker.containers.has(oldId)).toBe(true);
    expect((await harness.readStatus()).message).toContain("retried from the journal");

    dockerAway = false;
    await restarted.processPendingRequest();
    expect((await harness.readStatus()).state).toBe("SUCCEEDED");
    expect(harness.docker.containers.has(oldId)).toBe(false);
  });

  it.each([
    ["was restarted by its restart policy", (c: { RestartCount?: number; State: { StartedAt?: string } }) => {
      c.RestartCount = 1;
      c.State.StartedAt = "restart-1";
    }],
    ["is no longer healthy", (c: { State: { Health?: { Status: string } } }) => {
      c.State.Health = { Status: "starting" };
    }],
  ])("keeps the old container when the new one %s after the switch (review M1)", async (_label, change) => {
    await killAt("removeContainer", "before", (args) => args[0] === oldId);
    change(harness.docker.byName(CONTAINER_NAME)!);

    await restartUpdater();

    await expectLeftAloneForTheOperator();
    expect(harness.docker.containers.has(oldId)).toBe(true);
  });

  it("still reports the outcome when the journal cannot be set aside (review S4)", async () => {
    await killAt("renameContainer", "after");
    harness.docker.byName(PRE_NAME)!.State.Running = false;
    operatorContainer();
    // The clock stands at 10:00:00Z, so the name the journal would be moved to is known: block it.
    await mkdir(join(harness.backupDir, ".journal.manual-20261106T100000Z.json"));

    await restartUpdater();

    const status = await harness.readStatus();
    expect(status.state).toBe("FAILED");
    expect(status.message).toContain("MANUAL ACTION REQUIRED");
    expect(status.message).toContain("could not be set aside");
    expect(await exists(journalPath())).toBe(true);
  });

  it("sets the journal aside after a failed rollback and never replays it on later starts", async () => {
    await killAt("renameContainer", "after");
    harness.docker.failOn("rename", new Error("daemon unavailable"), () => true);

    await restartUpdater();
    const failed = await harness.readStatus();
    expect(failed.state).toBe("FAILED");
    expect(failed.message).toContain("ROLLBACK FAILED — manual action required");
    expect(failed.message).toContain("daemon unavailable");
    expect(await asideJournals()).toHaveLength(1);

    // The operator fixes things by hand: removes what is left and starts a fresh container.
    for (const id of [...harness.docker.containers.keys()]) harness.docker.containers.delete(id);
    operatorContainer();
    const before = destructiveCalls().length;

    await restartUpdater();

    expect(harness.docker.containers.has("operator-made")).toBe(true);
    expect(destructiveCalls()).toHaveLength(before);
  });

  it("refuses new updates until the operator deletes the set-aside journal", async () => {
    await killAt("renameContainer", "after");
    harness.docker.byName(PRE_NAME)!.State.Running = false;
    operatorContainer();
    const restarted = await restartUpdater();

    await harness.writeRequest({ ...REQUEST, id: "win-2" });
    await restarted.processPendingRequest();
    const refused = await harness.readStatus();
    expect(refused).toMatchObject({ id: "win-2", state: "FAILED" });
    expect(refused.message).toContain("needs manual attention");
    expect(harness.docker.callsTo("pull")).toHaveLength(1);

    for (const name of await asideJournals()) await rm(join(harness.backupDir, name));
    harness.docker.containers.delete(oldId);
    // 0.3.0 itself is cooling down after the failed attempt (finding L7), so the next window targets 0.4.0.
    await harness.writeRequest({ ...REQUEST, id: "win-3", targetVersion: "0.4.0" });
    await restarted.processPendingRequest();
    expect(harness.docker.callsTo("pull")).toEqual([`pull ${IMAGE_REPO}:${NEW_VERSION}`, `pull ${IMAGE_REPO}:0.4.0`]);
  });
});

describe("recovery details (review items 2, 3)", () => {
  it("finishes a rollback without a backup that was killed after the old container started", async () => {
    await harness.cleanup();
    harness = await createHarness({ env: { ALLOW_UPDATE_WITHOUT_BACKUP: "true" }, databaseUrl: "postgresql://servio@db/servio" });
    oldId = harness.docker.byName(CONTAINER_NAME)!.Id;
    harness.docker.newContainerPlan = "never-healthy";
    await killAt("startContainer", "after", (args) => args[0] === oldId);
    expect((await readJournal()).step).toBe("RESTORED");

    await restartUpdater();

    expect((await harness.readStatus()).state).toBe("ROLLED_BACK");
    expect(await asideJournals()).toEqual([]);
    expect(runningManaged().map((c) => c.Id)).toEqual([oldId]);
  });

  it("recovers although Docker refuses connections for a while after the restart", async () => {
    await killAt("startContainer", "after", (args) => args[0].startsWith("new-"));
    let refusals = 0;
    harness.docker.failOn("ping", unreachable(), () => ++refusals <= 5);

    await restartUpdater();

    expect((await harness.readStatus()).state).toBe("ROLLED_BACK");
    expect(await readFile(harness.dbFile)).toEqual(OLD_DB);
    expect(runningManaged().map((c) => c.Id)).toEqual([oldId]);
  });

  it("keeps the journal live when Docker stays away past the retry window, and finishes on a later poll (review S2)", async () => {
    await killAt("startContainer", "after", (args) => args[0].startsWith("new-"));
    let dockerAway = true;
    harness.docker.failOn("ping", unreachable(), () => dockerAway);

    const restarted = await restartUpdater();
    const waiting = await harness.readStatus();
    expect(TERMINAL).not.toContain(waiting.state);
    expect(waiting.message).toContain("retried from the journal");
    expect(await exists(journalPath())).toBe(true);
    expect(await asideJournals()).toEqual([]);

    dockerAway = false;
    await restarted.processPendingRequest();
    expect((await harness.readStatus()).state).toBe("ROLLED_BACK");
    expect(await readFile(harness.dbFile)).toEqual(OLD_DB);
    expect(await exists(journalPath())).toBe(false);
  });

  it("does not wait for a 500 from Docker, which is usually final (review S1)", async () => {
    await killAt("startContainer", "after", (args) => args[0].startsWith("new-"));
    harness.docker.failOn("start", new DockerApiError("driver failed programming external connectivity: port is already allocated", 500));

    await restartUpdater();

    expect((await harness.readStatus()).message).toContain("ROLLBACK FAILED — manual action required");
    // The new container's start before the kill, then a single attempt for the old one.
    expect(harness.docker.callsTo("start").filter((call) => call === `start ${CONTAINER_NAME}`)).toHaveLength(2);
  });
});

describe("restart policy during the update (finding L6)", () => {
  it("suspends the old container's restart policy while it is stopped and gives the new container the original one", async () => {
    await harness.writeRequest(REQUEST);
    await harness.flow.processPendingRequest();

    expect(harness.docker.callsTo("update")).toEqual([`update ${CONTAINER_NAME} {"RestartPolicy":{"Name":"no"}}`]);
    expect(harness.docker.calls.indexOf(harness.docker.callsTo("update")[0])).toBeLessThan(harness.docker.calls.indexOf(`stop ${CONTAINER_NAME} 30`));
    expect(runningManaged()[0].HostConfig.RestartPolicy).toEqual(ORIGINAL_POLICY);
  });

  it("puts the original policy back on the old container when the update is rolled back", async () => {
    harness.docker.newContainerPlan = "never-healthy";
    await harness.writeRequest(REQUEST);
    await harness.flow.processPendingRequest();

    expect((await harness.readStatus()).state).toBe("ROLLED_BACK");
    expect(harness.docker.containers.get(oldId)!.HostConfig.RestartPolicy).toEqual(ORIGINAL_POLICY);
  });

  it("restores the database when the old container was found stopped, as the suspended policy guarantees", async () => {
    await killAt("startContainer", "after", (args) => args[0].startsWith("new-"));
    expect(harness.docker.containers.get(oldId)!.HostConfig.RestartPolicy).toEqual({ Name: "no" });

    await restartUpdater();

    expect(await readFile(harness.dbFile)).toEqual(OLD_DB);
    expect(harness.docker.containers.get(oldId)!.HostConfig.RestartPolicy).toEqual(ORIGINAL_POLICY);
  });
});

describe("malformed state at start-up (finding M1)", () => {
  it.each([
    ["a directory", async (file: string) => { await rm(file, { force: true }); await mkdir(file); }],
    ["a JSON array", (file: string) => writeFile(file, "[1, 2]")],
    ["a status whose log is not a list", (file: string) => writeFile(file, JSON.stringify({ id: "win-1", state: "SWITCHING", log: "x" }))],
  ])("still recovers from the journal when status.json is %s", async (_label, plant) => {
    await killAt("startContainer", "after", (args) => args[0].startsWith("new-"));
    await plant(join(harness.stateDir, "updater", "status.json"));

    await restartUpdater();

    expect(await readFile(harness.dbFile)).toEqual(OLD_DB);
    expect(runningManaged().map((c) => c.Id)).toEqual([oldId]);
    expect(await exists(journalPath())).toBe(false);
  });

  it("sets a malformed journal aside instead of acting on it", async () => {
    await writeFile(journalPath(), JSON.stringify({ requestId: "win-1", step: "SWITCHING" }));

    await restartUpdater();

    expect(await asideJournals()).toHaveLength(1);
    expect(harness.docker.calls).toEqual([]);
    expect(harness.logLines.some((line) => line.includes("journal is malformed"))).toBe(true);
  });
});
