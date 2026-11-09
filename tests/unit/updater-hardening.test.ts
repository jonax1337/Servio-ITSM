import { readdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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

const REQUEST = { id: "win-1", targetVersion: NEW_VERSION, requestedAt: FRESH_REQUESTED_AT, requestedBy: "admin@x" };

let harness: Harness;
afterEach(() => harness.cleanup());

async function run(options: Parameters<typeof createHarness>[0] = {}, request: Record<string, unknown> = REQUEST) {
  harness = await createHarness(options);
  await harness.writeRequest(request);
  await harness.flow.processPendingRequest();
  return harness.readStatus();
}

const backupFiles = async () => (await readdir(harness.backupDir)).filter((name) => name.endsWith(".db")).sort();

describe("pruning (finding 2)", () => {
  it("never deletes the backup just taken, even when newer-looking backups push it out of BACKUP_KEEP", async () => {
    harness = await createHarness({ env: { BACKUP_KEEP: "1" } });
    await writeFile(join(harness.backupDir, "servio-9.9.9-20991231T000000Z.db"), "future");
    await harness.writeRequest(REQUEST);
    await harness.flow.processPendingRequest();

    const status = await harness.readStatus();
    expect(status.state).toBe("SUCCEEDED");
    expect(await backupFiles()).toEqual([`servio-${OLD_VERSION}-20261106T100000Z.db`, "servio-9.9.9-20991231T000000Z.db"]);
  });

  it("prunes old backups after SUCCEEDED", async () => {
    harness = await createHarness({ env: { BACKUP_KEEP: "1" } });
    await writeFile(join(harness.backupDir, "servio-0.0.1-20200101T000000Z.db"), "old");
    await harness.writeRequest(REQUEST);
    await harness.flow.processPendingRequest();

    expect((await harness.readStatus()).state).toBe("SUCCEEDED");
    expect(await backupFiles()).toEqual([`servio-${OLD_VERSION}-20261106T100000Z.db`]);
  });

  it("prunes after a rollback too, but never this update's backup (review item 8)", async () => {
    harness = await createHarness({ env: { BACKUP_KEEP: "1" } });
    harness.docker.newContainerPlan = "never-healthy";
    await writeFile(join(harness.backupDir, "servio-0.0.1-20200101T000000Z.db"), "old");
    await writeFile(join(harness.backupDir, "servio-9.9.9-20991231T000000Z.db"), "newer-looking");
    await harness.writeRequest(REQUEST);
    await harness.flow.processPendingRequest();

    expect((await harness.readStatus()).state).toBe("ROLLED_BACK");
    expect(await backupFiles()).toEqual([`servio-${OLD_VERSION}-20261106T100000Z.db`, "servio-9.9.9-20991231T000000Z.db"]);
  });

  it("prunes after a failure before the stop as well", async () => {
    harness = await createHarness({ env: { BACKUP_KEEP: "1" } });
    await writeFile(join(harness.backupDir, "servio-0.0.1-20200101T000000Z.db"), "old");
    await writeFile(join(harness.backupDir, "servio-0.0.2-20200102T000000Z.db"), "old");
    harness.docker.pullError = new Error("registry down");
    await harness.writeRequest(REQUEST);
    await harness.flow.processPendingRequest();

    expect((await harness.readStatus()).state).toBe("FAILED");
    expect(await backupFiles()).toEqual(["servio-0.0.2-20200102T000000Z.db"]);
  });
});

describe("downgrade protection (finding 3)", () => {
  it.each([
    ["older release", "0.1.0"],
    ["same version", OLD_VERSION],
    ["prerelease of the installed release", "0.2.0-rc.1"],
    ["older prerelease line", "0.1.9-rc.2"],
  ])("refuses %s without touching Docker", async (_label, targetVersion) => {
    const status = await run({ env: { ALLOW_PRERELEASE: "true" } }, { ...REQUEST, targetVersion });

    expect(status.state).toBe("FAILED");
    expect(status.message).toContain(`Refusing to install ${targetVersion}`);
    expect(status.message).toContain("ALLOW_DOWNGRADE=true");
    expect(harness.docker.callsTo("pull")).toEqual([]);
    expect(harness.docker.callsTo("stop")).toEqual([]);
  });

  it("installs an older release when ALLOW_DOWNGRADE=true", async () => {
    const status = await run({ env: { ALLOW_DOWNGRADE: "true" } }, { ...REQUEST, targetVersion: "0.1.0" });

    expect(status.state).toBe("SUCCEEDED");
    expect(harness.docker.callsTo("pull")).toEqual([`pull ${IMAGE_REPO}:0.1.0`]);
  });

  it("accepts the release after a prerelease of the same version", async () => {
    harness = await createHarness();
    const container = harness.docker.byName(CONTAINER_NAME)!;
    container.Config.Labels["org.opencontainers.image.version"] = "0.3.0-rc.1";
    await harness.writeRequest(REQUEST);
    await harness.flow.processPendingRequest();

    expect((await harness.readStatus()).state).toBe("SUCCEEDED");
  });

  /** The image the container was created from carries no version label, and its tag is not a version. */
  const forgetInstalledVersion = () => {
    const container = harness.docker.byName(CONTAINER_NAME)!;
    delete container.Config.Labels["org.opencontainers.image.version"];
    container.Config.Image = `${IMAGE_REPO}:latest`;
  };

  it("refuses to update when the installed version is unknown", async () => {
    harness = await createHarness();
    forgetInstalledVersion();
    await harness.writeRequest(REQUEST);
    await harness.flow.processPendingRequest();

    const status = await harness.readStatus();
    expect(status.state).toBe("FAILED");
    expect(status.message).toContain("installed version is unknown (latest)");
    expect(status.message).toContain("ALLOW_DOWNGRADE=true");
    expect(harness.docker.callsTo("pull")).toEqual([]);
    expect(harness.docker.callsTo("stop")).toEqual([]);
  });

  it("updates from an unknown installed version when ALLOW_DOWNGRADE=true", async () => {
    harness = await createHarness({ env: { ALLOW_DOWNGRADE: "true" } });
    forgetInstalledVersion();
    await harness.writeRequest(REQUEST);
    await harness.flow.processPendingRequest();

    expect((await harness.readStatus()).state).toBe("SUCCEEDED");
  });
});

describe("pulled image identity (finding M2)", () => {
  it.each([
    ["a different version", { "org.opencontainers.image.version": "0.2.9" }, '"0.2.9"'],
    ["no version", {}, "missing"],
  ])("refuses an image whose version label says %s, before stopping anything", async (_label, labels, shown) => {
    harness = await createHarness();
    harness.docker.images[`${IMAGE_REPO}:${NEW_VERSION}`] = { Id: "sha256:mislabelled", RepoDigests: [], Config: { Labels: labels } };
    await harness.writeRequest(REQUEST);
    await harness.flow.processPendingRequest();

    const status = await harness.readStatus();
    expect(status.state).toBe("FAILED");
    expect(status.message).toContain(`label is ${shown}, not ${NEW_VERSION}`);
    expect(harness.docker.callsTo("stop")).toEqual([]);
  });
});

describe("stopping the container (finding 4)", () => {
  it("restarts the old container when stop itself fails", async () => {
    harness = await createHarness();
    harness.docker.failOn("stop", new Error("daemon timeout"), (args) => args[0] === CONTAINER_NAME);
    await harness.writeRequest(REQUEST);
    await harness.flow.processPendingRequest();

    const status = await harness.readStatus();
    expect(status.state).toBe("FAILED");
    expect(status.message).toContain("daemon timeout");
    expect(harness.docker.callsTo("start")).toEqual([`start ${CONTAINER_NAME}`]);
    expect(harness.docker.byName(CONTAINER_NAME)?.State.Running).toBe(true);
    expect(harness.docker.callsTo("rename")).toEqual([]);
  });

  it("asks for manual action when the restart after a failed stop fails as well", async () => {
    harness = await createHarness();
    harness.docker.failOn("stop", new Error("daemon timeout"));
    harness.docker.failOn("start", new Error("daemon gone"));
    await harness.writeRequest(REQUEST);
    await harness.flow.processPendingRequest();

    const status = await harness.readStatus();
    expect(status.state).toBe("FAILED");
    expect(status.message).toContain("ROLLBACK FAILED — manual action required");
    expect(status.message).toContain("daemon gone");
  });
});

describe("DATABASE_URL (finding 5)", () => {
  it.each(["file:./prisma/dev.db", "file:servio.db", "file:../data/servio.db"])(
    "refuses the relative URL %s before pulling",
    async (databaseUrl) => {
      const status = await run({ databaseUrl });

      expect(status.state).toBe("FAILED");
      expect(status.message).toContain("must be an absolute file: URL equal to the updater's DB_FILE");
      expect(harness.docker.callsTo("pull")).toEqual([]);
      expect(harness.docker.callsTo("stop")).toEqual([]);
    },
  );

  it("accepts the URL with a query string when the path equals DB_FILE", async () => {
    harness = await createHarness();
    harness.docker.byName(CONTAINER_NAME)!.Config.Env = [`DATABASE_URL=file:${harness.dbFile}?connection_limit=1`];
    await harness.writeRequest(REQUEST);
    await harness.flow.processPendingRequest();

    expect((await harness.readStatus()).state).toBe("SUCCEEDED");
  });
});

describe("pull deadline and request freshness (finding 7)", () => {
  it("aborts a pull that exceeds PULL_TIMEOUT_SECONDS and leaves the container alone", async () => {
    harness = await createHarness();
    harness.docker.pullBehaviour = "hang";
    await harness.writeRequest(REQUEST);

    const finished = harness.flow.processPendingRequest();
    await vi.waitFor(() => expect(harness.docker.callsTo("pull")).toHaveLength(1));
    expect(harness.docker.pullSignals[0]).toBeInstanceOf(AbortSignal);
    harness.expirePullDeadline();
    await finished;

    const status = await harness.readStatus();
    expect(status.state).toBe("FAILED");
    expect(status.message).toContain("did not finish within 1800s");
    expect(harness.docker.callsTo("stop")).toEqual([]);
  });

  it("aborts when the request was replaced while the image was pulling", async () => {
    harness = await createHarness();
    harness.docker.onPull = () => harness.writeRequest({ ...REQUEST, id: "win-2" });
    await harness.writeRequest(REQUEST);
    await harness.flow.processPendingRequest();

    const status = await harness.readStatus();
    expect(status).toMatchObject({ id: "win-1", state: "FAILED" });
    expect(status.message).toContain("withdrawn or replaced");
    expect(harness.docker.callsTo("stop")).toEqual([]);
    expect(await harness.backupFiles()).toEqual([]);
  });

  it("aborts when the request file was removed while the image was pulling", async () => {
    harness = await createHarness();
    harness.docker.onPull = () => rm(join(harness.stateDir, "updater", "request.json"));
    await harness.writeRequest(REQUEST);
    await harness.flow.processPendingRequest();

    expect((await harness.readStatus()).message).toContain("withdrawn or replaced");
    expect(harness.docker.callsTo("stop")).toEqual([]);
  });

  it("aborts when the target version of the same request id changed", async () => {
    harness = await createHarness();
    harness.docker.onPull = () => harness.writeRequest({ ...REQUEST, targetVersion: "0.9.0" });
    await harness.writeRequest(REQUEST);
    await harness.flow.processPendingRequest();

    expect((await harness.readStatus()).message).toContain("withdrawn or replaced");
    expect(harness.docker.callsTo("stop")).toEqual([]);
  });

  it.each([
    ["two hours old", "2026-11-06T08:00:00Z", "is 7200s old"],
    ["more than five minutes in the future", "2026-11-06T10:06:00Z", "lies in the future"],
    ["not a date", "yesterday", "not a date"],
    ["missing", undefined, "not a date"],
  ])("rejects a request that is %s", async (_label, requestedAt, message) => {
    const status = await run({}, { ...REQUEST, requestedAt });

    expect(status.state).toBe("FAILED");
    expect(status.message).toContain(message);
    expect(harness.docker.calls.filter((call) => !call.startsWith("inspect"))).toEqual([]);
  });

  it("accepts a request that is slightly in the future (clock skew) or almost at the age limit", async () => {
    const skewed = await run({}, { ...REQUEST, requestedAt: "2026-11-06T10:04:00Z" });
    expect(skewed.state).toBe("SUCCEEDED");
    await harness.cleanup();

    const old = await run({}, { ...REQUEST, requestedAt: "2026-11-06T09:00:01Z" });
    expect(old.state).toBe("SUCCEEDED");
  });

  it("honours REQUEST_MAX_AGE_SECONDS", async () => {
    const status = await run({ env: { REQUEST_MAX_AGE_SECONDS: "30" } });

    expect(status.message).toContain("REQUEST_MAX_AGE_SECONDS=30");
  });
});

describe("health check fail-fast", () => {
  it("rolls back as soon as the new container reports unhealthy instead of waiting for the timeout", async () => {
    harness = await createHarness();
    harness.docker.newContainerPlan = "unhealthy";
    await harness.writeRequest(REQUEST);
    await harness.flow.processPendingRequest();

    const status = await harness.readStatus();
    expect(status.state).toBe("ROLLED_BACK");
    expect(status.message).toContain("reported unhealthy");
    expect(harness.elapsedMs()).toBeLessThan(30_000);
    expect(harness.docker.byName(CONTAINER_NAME)?.Config.Image).toBe(`${IMAGE_REPO}:${OLD_VERSION}`);
  });
});

describe("leftover -pre- container", () => {
  it("is never replaced: a second update refuses until an operator removes it", async () => {
    harness = await createHarness();
    harness.docker.add(harness.container({ Id: "leftover", Name: `/${CONTAINER_NAME}-pre-${OLD_VERSION}` }));
    await harness.writeRequest(REQUEST);
    await harness.flow.processPendingRequest();

    const status = await harness.readStatus();
    expect(status.state).toBe("FAILED");
    expect(status.message).toContain("already exists from an earlier update");
    expect(harness.docker.callsTo("stop")).toEqual([]);
  });
});

describe("unwritable status file", () => {
  /** Swaps the updater directory for a junction while the image is pulling, so every status write is refused. */
  async function swapUpdaterDirDuringPull() {
    const updaterDir = join(harness.stateDir, "updater");
    harness.docker.onPull = async () => {
      await rename(updaterDir, `${updaterDir}-real`);
      await symlink(`${updaterDir}-real`, updaterDir, "junction");
    };
  }

  it("still completes the update and never replays the request", async () => {
    harness = await createHarness();
    await swapUpdaterDirDuringPull();
    await harness.writeRequest(REQUEST);
    await harness.flow.processPendingRequest();

    expect(harness.docker.byName(CONTAINER_NAME)?.Config.Image).toBe(`${IMAGE_REPO}:${NEW_VERSION}`);
    expect(harness.logLines.some((line) => line.includes("could not write status.json"))).toBe(true);
    const calls = harness.docker.calls.length;
    expect(await harness.flow.processPendingRequest()).toBe("idle");
    expect(harness.docker.calls).toHaveLength(calls);
  });

  it("still rolls back", async () => {
    harness = await createHarness();
    harness.docker.newContainerPlan = "never-healthy";
    await swapUpdaterDirDuringPull();
    await harness.writeRequest(REQUEST);
    await harness.flow.processPendingRequest();

    expect(harness.docker.byName(CONTAINER_NAME)?.Config.Image).toBe(`${IMAGE_REPO}:${OLD_VERSION}`);
    expect(await readFile(harness.dbFile)).toEqual(OLD_DB);
  });
});
