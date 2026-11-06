import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DockerApiError } from "../../updater/docker-client.mjs";
import {
  CONTAINER_NAME,
  FRESH_REQUESTED_AT,
  IMAGE_REPO,
  NEW_VERSION,
  OLD_DB,
  OLD_VERSION,
  createHarness,
  type Harness,
} from "./updater-test-kit";

const PRE_NAME = `${CONTAINER_NAME}-pre-${OLD_VERSION}`;
const REQUEST = { id: "win-1", targetVersion: NEW_VERSION, requestedAt: FRESH_REQUESTED_AT, requestedBy: "admin@x" };

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});
afterEach(() => harness.cleanup());

async function runRequest(request: Record<string, unknown> = REQUEST) {
  await harness.writeRequest(request);
  return harness.flow.processPendingRequest();
}

const stateSequence = (status: { log: Array<{ state: string }> }) => {
  const states = status.log.map((entry) => entry.state);
  return states.filter((state, index) => state !== states[index - 1]);
};

describe("update flow: success", () => {
  it("pulls, backs up, switches, waits for health and removes the old container", async () => {
    harness.docker.add(harness.container({ Id: "other", Name: "/unrelated", Config: { Labels: {} } }));
    const outcome = await runRequest();

    const status = await harness.readStatus();
    expect(outcome).toBe("processed");
    expect(status).toMatchObject({
      id: "win-1",
      state: "SUCCEEDED",
      fromVersion: OLD_VERSION,
      targetVersion: NEW_VERSION,
    });
    expect(stateSequence(status)).toEqual(["PULLING", "BACKING_UP", "SWITCHING", "HEALTH_CHECK", "SUCCEEDED"]);
    expect(Date.parse(status.updatedAt)).not.toBeNaN();
    expect(status.log.every((entry: { at: string; message: string }) => entry.at && entry.message)).toBe(true);

    const { docker } = harness;
    expect(docker.callsTo("pull")).toEqual([`pull ${IMAGE_REPO}:${NEW_VERSION}`]);
    expect(docker.callsTo("stop")).toEqual([`stop ${CONTAINER_NAME} 30`]);
    expect(docker.calls.filter((c) => /^(stop|rename|create|start|remove) /.test(c))).toEqual([
      `stop ${CONTAINER_NAME} 30`,
      `rename ${CONTAINER_NAME} ${PRE_NAME}`,
      `create ${CONTAINER_NAME}`,
      `start ${CONTAINER_NAME}`,
      `remove ${PRE_NAME} {"force":true}`,
    ]);
    expect(docker.byName(PRE_NAME)).toBeUndefined();
    expect(docker.byName(CONTAINER_NAME)?.Config.Image).toBe(`sha256:id-of-${IMAGE_REPO}:${NEW_VERSION}`);
    expect(docker.byName("unrelated")).toBeDefined();
  });

  it("creates the container from the pulled image's id and logs the digest", async () => {
    await runRequest();

    const status = await harness.readStatus();
    const pulled = status.log.find((entry: { message: string }) => entry.message.startsWith("Pulled "));
    expect(pulled.message).toContain(`image sha256:id-of-${IMAGE_REPO}:${NEW_VERSION}`);
    expect(pulled.message).toContain(`digest ${IMAGE_REPO}@sha256:digest-of-${IMAGE_REPO}:${NEW_VERSION}`);
    expect(harness.docker.byName(CONTAINER_NAME)?.Config.Image).toMatch(/^sha256:/);
  });

  it("writes a backup of the database and its WAL into the backup directory", async () => {
    await runRequest();

    const backups = await harness.backupFiles();
    const database = backups.find((name) => name.endsWith(".db"));
    expect(database).toMatch(new RegExp(`^servio-${OLD_VERSION}-\\d{8}T\\d{6}Z\\.db$`));
    expect(backups).toContain(`${database}-wal`);
    expect(await readFile(join(harness.backupDir, database!))).toEqual(OLD_DB);
    expect((await harness.readStatus()).message).toContain(join(harness.backupDir, database!));
  });

  it("connects every network beyond the first before starting the new container", async () => {
    const container = harness.container();
    container.NetworkSettings.Networks.db_net = { Aliases: ["web"] };
    harness.docker.containers.clear();
    harness.docker.add(container);

    await runRequest();

    const calls = harness.docker.calls;
    expect(calls).toContain(`connect db_net ${CONTAINER_NAME}`);
    expect(calls.indexOf(`connect db_net ${CONTAINER_NAME}`)).toBeLessThan(calls.indexOf(`start ${CONTAINER_NAME}`));
  });

  it("still reports SUCCEEDED when the old container cannot be removed, and says how to clean up", async () => {
    harness.docker.failOn("remove", new Error("device busy"));
    await runRequest();

    const status = await harness.readStatus();
    expect(status.state).toBe("SUCCEEDED");
    expect(status.message).toContain(`${PRE_NAME} could not be removed`);
  });
});

describe("update flow: failures before anything changed", () => {
  it("fails when the pull fails and never touches the running container", async () => {
    harness.docker.pullError = new DockerApiError("pull access denied", 200);
    await runRequest();

    const status = await harness.readStatus();
    expect(status.state).toBe("FAILED");
    expect(status.message).toContain("pull access denied");
    expect(harness.docker.callsTo("stop")).toEqual([]);
    expect(harness.docker.callsTo("rename")).toEqual([]);
    expect(harness.docker.byName(CONTAINER_NAME)?.State.Running).toBe(true);
    expect(await harness.backupFiles()).toEqual([]);
  });

  it("refuses a Postgres URL without ALLOW_UPDATE_WITHOUT_BACKUP and leaves the container running", async () => {
    await harness.cleanup();
    harness = await createHarness({ databaseUrl: "postgresql://servio@db/servio" });
    await runRequest();

    const status = await harness.readStatus();
    expect(status.state).toBe("FAILED");
    expect(status.message).toContain("ALLOW_UPDATE_WITHOUT_BACKUP");
    expect(harness.docker.callsTo("pull")).toEqual([]);
    expect(harness.docker.callsTo("stop")).toEqual([]);
    expect(harness.docker.byName(CONTAINER_NAME)?.State.Running).toBe(true);
  });

  it("updates a Postgres deployment without a backup when ALLOW_UPDATE_WITHOUT_BACKUP=true", async () => {
    await harness.cleanup();
    harness = await createHarness({
      env: { ALLOW_UPDATE_WITHOUT_BACKUP: "true" },
      databaseUrl: "postgresql://servio@db/servio",
    });
    await runRequest();

    const status = await harness.readStatus();
    expect(status.state).toBe("SUCCEEDED");
    expect(await harness.backupFiles()).toEqual([]);
  });

  it("refuses when DATABASE_URL points at a different file than DB_FILE", async () => {
    await harness.cleanup();
    harness = await createHarness({ databaseUrl: "file:/elsewhere/other.db" });
    await runRequest();

    const status = await harness.readStatus();
    expect(status.state).toBe("FAILED");
    expect(status.message).toContain("/elsewhere/other.db");
    expect(harness.docker.callsTo("stop")).toEqual([]);
  });

  it("refuses a container that lacks the managed label", async () => {
    harness.docker.containers.clear();
    harness.docker.add(harness.container({ Config: { Image: `${IMAGE_REPO}:${OLD_VERSION}`, Labels: {} } }));
    await runRequest();

    const status = await harness.readStatus();
    expect(status.state).toBe("FAILED");
    expect(status.message).toContain("servio.updater.managed=true");
    expect(harness.docker.callsTo("pull")).toEqual([]);
  });

  it("refuses to run while a -pre- container from an earlier update still exists", async () => {
    harness.docker.add(harness.container({ Id: "leftover", Name: `/${PRE_NAME}` }));
    await runRequest();

    const status = await harness.readStatus();
    expect(status.state).toBe("FAILED");
    expect(status.message).toContain(PRE_NAME);
    expect(harness.docker.callsTo("stop")).toEqual([]);
    expect(harness.docker.byName(PRE_NAME)).toBeDefined();
  });

  it("restarts the container when the backup fails after it was stopped", async () => {
    // The clock sits at 10:00:00Z, so the backup file name is predictable: plant it.
    await writeFile(join(harness.backupDir, `servio-${OLD_VERSION}-20261106T100000Z.db`), "planted");
    await runRequest();

    const status = await harness.readStatus();
    expect(status.state).toBe("FAILED");
    expect(status.message).toContain("EEXIST");
    expect(await readFile(join(harness.backupDir, `servio-${OLD_VERSION}-20261106T100000Z.db`), "utf8")).toBe("planted");
    expect(harness.docker.callsTo("stop")).toHaveLength(1);
    expect(harness.docker.callsTo("start")).toEqual([`start ${CONTAINER_NAME}`]);
    expect(harness.docker.byName(CONTAINER_NAME)?.State.Running).toBe(true);
    expect(harness.docker.callsTo("rename")).toEqual([]);
    expect(await harness.backupFiles()).toEqual([`servio-${OLD_VERSION}-20261106T100000Z.db`]);
  });

  it("refuses before stopping anything when the database file is missing", async () => {
    await rm(harness.dbFile);
    await runRequest();

    const status = await harness.readStatus();
    expect(status.state).toBe("FAILED");
    expect(status.message).toContain("does not exist");
    expect(harness.docker.callsTo("stop")).toEqual([]);
  });
});

describe("update flow: request validation", () => {
  it.each([
    ["not semver", "latest"],
    ["two segments", "1.2"],
    ["shell metacharacters", "1.2.3; rm -rf /"],
    ["path traversal", "../../etc/passwd"],
    ["digest", "1.2.3@sha256:abcdef"],
    ["foreign image reference", "ghcr.io/evil/servio:1.2.3"],
    ["trailing newline", "1.2.3\n"],
    ["leading v", "v1.2.3"],
    ["non-string", 123],
    ["missing", undefined],
  ])("rejects targetVersion (%s) without calling Docker", async (_label, targetVersion) => {
    await runRequest({ id: "bad-1", targetVersion, requestedAt: FRESH_REQUESTED_AT });

    const status = await harness.readStatus();
    expect(status).toMatchObject({ id: "bad-1", state: "FAILED" });
    expect(status.message).toContain("semantic version");
    expect(harness.docker.calls.filter((call) => !call.startsWith("inspect"))).toEqual([]);
  });

  it("rejects prerelease versions by default", async () => {
    await runRequest({ id: "pre-1", targetVersion: "1.0.0-rc.1", requestedAt: FRESH_REQUESTED_AT });

    const status = await harness.readStatus();
    expect(status.state).toBe("FAILED");
    expect(status.message).toContain("ALLOW_PRERELEASE=true");
    expect(harness.docker.callsTo("pull")).toEqual([]);
  });

  it("installs prerelease versions when ALLOW_PRERELEASE=true", async () => {
    await harness.cleanup();
    harness = await createHarness({ env: { ALLOW_PRERELEASE: "true" } });
    await runRequest({ id: "pre-1", targetVersion: "1.0.0-rc.1", requestedAt: FRESH_REQUESTED_AT });

    expect(harness.docker.callsTo("pull")).toEqual([`pull ${IMAGE_REPO}:1.0.0-rc.1`]);
    expect((await harness.readStatus()).state).toBe("SUCCEEDED");
  });

  it("only ever pulls the image repository from the updater's own configuration", async () => {
    await runRequest({ ...REQUEST, image: "ghcr.io/evil/servio", imageRef: "evil:1", container: "someone-else" });

    expect(harness.docker.callsTo("pull")).toEqual([`pull ${IMAGE_REPO}:${NEW_VERSION}`]);
    expect(harness.docker.calls.join("\n")).not.toContain("evil");
    expect(harness.docker.calls.join("\n")).not.toContain("someone-else");
  });

  it("ignores a request without a usable id and logs it once", async () => {
    await harness.writeRequest({ targetVersion: NEW_VERSION });
    expect(await harness.flow.processPendingRequest()).toBe("ignored");
    expect(await harness.flow.processPendingRequest()).toBe("ignored");

    expect(harness.logLines.filter((line) => line.includes("no valid id"))).toHaveLength(1);
    expect(harness.docker.calls).toEqual([]);
  });

  it("is idle when there is no request", async () => {
    expect(await harness.flow.processPendingRequest()).toBe("idle");
  });
});

describe("update flow: idempotency", () => {
  it("does not process the same request id twice", async () => {
    await runRequest();
    const callsAfterFirstRun = harness.docker.calls.length;

    expect(await harness.flow.processPendingRequest()).toBe("idle");
    expect(harness.docker.calls).toHaveLength(callsAfterFirstRun);
  });

  it("does not repeat a handled request after the updater restarts", async () => {
    await runRequest();
    const callsAfterFirstRun = harness.docker.calls.length;

    const restarted = harness.newFlow();
    await restarted.recoverInterrupted();

    expect(await restarted.processPendingRequest()).toBe("idle");
    expect(harness.docker.calls).toHaveLength(callsAfterFirstRun);
    expect((await harness.readStatus()).state).toBe("SUCCEEDED");
  });

  it("processes a new request id after a finished one", async () => {
    await runRequest();
    harness.docker.containers.clear();
    harness.docker.add(harness.container());

    expect(await runRequest({ ...REQUEST, id: "win-2" })).toBe("processed");
    expect((await harness.readStatus()).id).toBe("win-2");
  });

  it("marks an update interrupted by an updater crash as FAILED with a manual-check hint", async () => {
    await writeFile(
      join(harness.config.stateDir, "updater", "status.json"),
      JSON.stringify({ id: "win-1", state: "SWITCHING", fromVersion: OLD_VERSION, targetVersion: NEW_VERSION, message: "x", updatedAt: "2026-11-06T10:00:00Z", log: [] }),
    );

    await harness.flow.recoverInterrupted();

    const status = await harness.readStatus();
    expect(status.state).toBe("FAILED");
    expect(status.message).toContain("SWITCHING");
    expect(status.message).toContain("docker ps -a");
    expect(status.log.at(-1).state).toBe("FAILED");
    await harness.writeRequest(REQUEST);
    expect(await harness.flow.processPendingRequest()).toBe("idle");
  });

  it("leaves a terminal status untouched on start-up", async () => {
    await runRequest();
    const before = await readFile(join(harness.config.stateDir, "updater", "status.json"), "utf8");

    await harness.flow.recoverInterrupted();

    expect(await readFile(join(harness.config.stateDir, "updater", "status.json"), "utf8")).toBe(before);
  });
});

describe("update flow: limits on repeated and oversized updates", () => {
  it("refuses another attempt at a target that was just rolled back, but not at another target (finding L7)", async () => {
    harness.docker.newContainerPlan = "never-healthy";
    await runRequest();
    expect((await harness.readStatus()).state).toBe("ROLLED_BACK");
    const stops = harness.docker.callsTo("stop").length;

    await runRequest({ ...REQUEST, id: "win-2" });
    const refused = await harness.readStatus();
    expect(refused).toMatchObject({ id: "win-2", state: "FAILED" });
    expect(refused.message).toContain("failed recently");
    expect(harness.docker.callsTo("stop")).toHaveLength(stops);

    harness.docker.newContainerPlan = "healthy";
    await runRequest({ ...REQUEST, id: "win-3", targetVersion: "0.3.1" });
    expect((await harness.readStatus()).state).toBe("SUCCEEDED");
  });

  it("allows the target again once RETRY_COOLDOWN_SECONDS have passed", async () => {
    harness.docker.newContainerPlan = "never-healthy";
    await runRequest();
    await harness.clock.sleep(3600_000);
    harness.docker.newContainerPlan = "healthy";

    await runRequest({ ...REQUEST, id: "win-2", requestedAt: new Date(harness.clock.now()).toISOString() });

    expect((await harness.readStatus()).state).toBe("SUCCEEDED");
  });

  it("does not start a cooldown for a failure that never stopped the app", async () => {
    harness.docker.pullError = new DockerApiError("registry down", 500);
    await runRequest();
    harness.docker.pullError = null;

    await runRequest({ ...REQUEST, id: "win-2" });

    expect((await harness.readStatus()).state).toBe("SUCCEEDED");
  });

  it("refuses before stopping anything when a backup and its restore would not fit (finding L10)", async () => {
    await harness.cleanup();
    harness = await createHarness({ freeBytes: 1024 });
    await runRequest();

    const status = await harness.readStatus();
    expect(status.state).toBe("FAILED");
    expect(status.message).toContain("Not enough free space");
    expect(harness.docker.callsTo("stop")).toEqual([]);
  });

  it("proceeds when there is room for the backup and the restore", async () => {
    await harness.cleanup();
    harness = await createHarness({ freeBytes: 1024 ** 3 });
    await runRequest();

    expect((await harness.readStatus()).state).toBe("SUCCEEDED");
  });
});

describe("update flow: rollback", () => {
  const corruptDatabaseOnStart = (harness: Harness) => {
    harness.docker.onStart = async (container) => {
      if (!container.Id.startsWith("new-")) return;
      await writeFile(harness.dbFile, "migrated-by-the-new-version");
      await writeFile(`${harness.dbFile}-shm`, "created-by-the-new-version");
    };
  };

  it("restores the database byte-for-byte and brings the old container back when health times out", async () => {
    corruptDatabaseOnStart(harness);
    harness.docker.newContainerPlan = "never-healthy";
    await runRequest();

    const status = await harness.readStatus();
    expect(status.state).toBe("ROLLED_BACK");
    expect(status.message).toContain("not healthy within 30s");
    expect(status.message).toContain("database restored from backup");
    expect(stateSequence(status)).toEqual(["PULLING", "BACKING_UP", "SWITCHING", "HEALTH_CHECK", "ROLLED_BACK"]);

    expect(await readFile(harness.dbFile)).toEqual(OLD_DB);
    expect((await readFile(`${harness.dbFile}-wal`)).toString()).toBe("old-wal-bytes");
    await expect(stat(`${harness.dbFile}-shm`)).rejects.toMatchObject({ code: "ENOENT" });

    const { docker } = harness;
    expect(docker.byName(PRE_NAME)).toBeUndefined();
    const restored = docker.byName(CONTAINER_NAME);
    expect(restored?.Config.Image).toBe(`${IMAGE_REPO}:${OLD_VERSION}`);
    expect(restored?.State.Running).toBe(true);
    expect([...docker.containers.keys()].filter((id) => id.startsWith("new-"))).toEqual([]);
  });

  it("removes a hot rollback journal the killed new container left, so the old version does not replay it (finding H1)", async () => {
    harness.docker.newContainerPlan = "never-healthy";
    harness.docker.onStart = async (container) => {
      if (!container.Id.startsWith("new-")) return;
      await writeFile(harness.dbFile, "half-migrated");
      await writeFile(`${harness.dbFile}-journal`, "hot-journal-of-the-interrupted-migration");
    };
    await runRequest();

    expect((await harness.readStatus()).state).toBe("ROLLED_BACK");
    expect(await readFile(harness.dbFile)).toEqual(OLD_DB);
    await expect(stat(`${harness.dbFile}-journal`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rolls back when the new container exits while health is being checked", async () => {
    harness.docker.newContainerPlan = "exits";
    await runRequest();

    const status = await harness.readStatus();
    expect(status.state).toBe("ROLLED_BACK");
    expect(status.message).toContain("exit code 1");
    expect(harness.docker.byName(CONTAINER_NAME)?.Config.Image).toBe(`${IMAGE_REPO}:${OLD_VERSION}`);
    expect(harness.docker.byName(CONTAINER_NAME)?.State.Running).toBe(true);
  });

  it("rolls back when the new container cannot be created", async () => {
    harness.docker.failOn("create", new DockerApiError("invalid mount config", 400));
    await runRequest();

    const status = await harness.readStatus();
    expect(status.state).toBe("ROLLED_BACK");
    expect(status.message).toContain("invalid mount config");
    expect(harness.docker.byName(CONTAINER_NAME)?.State.Running).toBe(true);
    expect(await readFile(harness.dbFile)).toEqual(OLD_DB);
  });

  it("reports ROLLBACK FAILED with the backup path and old container when the rollback itself breaks", async () => {
    harness.docker.newContainerPlan = "never-healthy";
    harness.docker.failOn("rename", new Error("daemon unavailable"), (args) => args[1] === CONTAINER_NAME);
    await runRequest();

    const status = await harness.readStatus();
    const [backupFile] = (await readdir(harness.backupDir)).filter((name) => name.endsWith(".db"));
    expect(status.state).toBe("FAILED");
    expect(status.message).toContain("ROLLBACK FAILED — manual action required");
    expect(status.message).toContain("daemon unavailable");
    expect(status.message).toContain(PRE_NAME);
    expect(status.message).toContain(join(harness.backupDir, backupFile));
  });

  it("reports ROLLBACK FAILED when the old container does not become healthy again", async () => {
    harness.docker.newContainerPlan = "exits";
    harness.docker.restartPlan = "never-healthy";
    await runRequest();

    const status = await harness.readStatus();
    expect(status.state).toBe("FAILED");
    expect(status.message).toContain("ROLLBACK FAILED — manual action required");
    expect(status.message).toContain("not healthy within 30s");
  });
});
