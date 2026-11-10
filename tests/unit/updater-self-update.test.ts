/* eslint-disable @typescript-eslint/no-explicit-any -- Docker inspect payloads are untyped Engine API JSON */
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DockerApiError } from "../../updater/docker-client.mjs";
import { createHeartbeat } from "../../updater/heartbeat.mjs";
import { SELF_UPDATE_LABEL, createSelfUpdate } from "../../updater/self-update.mjs";
import { runUpdater } from "../../updater/service.mjs";
import { statePaths } from "../../updater/state-files.mjs";
import { createUpdateFlow } from "../../updater/update-flow.mjs";
import { FRESH_REQUESTED_AT, IMAGE_REPO, NEW_VERSION, createHarness, type FakeContainer, type Harness } from "./updater-test-kit";

const UPDATER_REPO = `${IMAGE_REPO}-updater`;
const UPDATER_NAME = "servio-updater";
const OLD_UPDATER = "0.2.0";
const PRE_NAME = `${UPDATER_NAME}-pre-${OLD_UPDATER}`;
const OWN_ID = `abcdef012345${"0".repeat(52)}`;
const OWN_HOSTNAME = OWN_ID.slice(0, 12);
const NEW_REF = `${UPDATER_REPO}:${NEW_VERSION}`;

let harness: Harness;
let retired: number;

beforeEach(async () => {
  harness = await createHarness({ env: { UPDATER_CONTAINER: UPDATER_NAME, UPDATER_SELF_UPDATE_TIMEOUT_SECONDS: "60" } });
  harness.config.updaterVersion = OLD_UPDATER;
  harness.docker.add(updaterContainer());
  // A started updater container of the new release writes its liveness stamp, as the real one does.
  harness.docker.onStart = (container) => (container.Config.Image === NEW_REF ? stamp(NEW_VERSION) : undefined);
  retired = 0;
});
afterEach(() => harness.cleanup());

/** The updater's own container as compose creates it. */
function updaterContainer(): FakeContainer {
  return {
    Id: OWN_ID,
    Name: `/${UPDATER_NAME}`,
    Image: "sha256:updater-old",
    Config: {
      Hostname: OWN_HOSTNAME,
      Image: `${UPDATER_REPO}:${OLD_UPDATER}`,
      Env: ["SERVIO_IMAGE=ghcr.io/test/servio", "UPDATER_CONTAINER=servio-updater"],
      Labels: { "com.docker.compose.service": "updater" },
    },
    HostConfig: { NetworkMode: "none", ReadonlyRootfs: true, GroupAdd: ["64999"], RestartPolicy: { Name: "unless-stopped" } },
    NetworkSettings: { Networks: { none: {} } },
    Mounts: [],
    State: { Running: true, Restarting: false, ExitCode: 0, StartedAt: "2026-11-01T08:00:00Z", Health: { Status: "healthy" } },
    RestartCount: 0,
  };
}

const livenessFile = () => join(harness.backupDir, ".liveness.json");
const handoverFile = () => join(harness.backupDir, ".self-update.json");
const exists = (path: string) => stat(path).then(() => true, () => false);
const readJson = async (path: string) => JSON.parse(await readFile(path, "utf8"));

function stamp(version: string, at = new Date(harness.clock.now()).toISOString()) {
  return writeFile(livenessFile(), JSON.stringify({ at, version }));
}

function selfUpdater(hostname = () => OWN_HOSTNAME) {
  return createSelfUpdate({
    docker: harness.docker.asClient(),
    config: harness.config,
    clock: harness.clock,
    log: (line) => harness.logLines.push(line),
    hostname,
    retire: () => (retired += 1),
  });
}

const afterUpdate = (selfUpdate = selfUpdater(), targetVersion = NEW_VERSION) =>
  selfUpdate.afterAppUpdate({ requestId: "win-1", targetVersion });

const byName = (name: string) => harness.docker.byName(name);

describe("updater self-update: handover", () => {
  it("replaces its own container with the new release under the same name and configuration, then retires", async () => {
    const selfUpdate = selfUpdater();

    const note = await afterUpdate(selfUpdate);

    const replacement = byName(UPDATER_NAME) as FakeContainer;
    expect(replacement.Id).not.toBe(OWN_ID);
    expect(replacement.Config.Image).toBe(NEW_REF);
    expect(replacement.Config.Labels).toMatchObject({ "com.docker.compose.service": "updater", [SELF_UPDATE_LABEL]: "win-1" });
    expect(replacement.Config.Env).toContain("UPDATER_CONTAINER=servio-updater");
    expect(replacement.HostConfig).toMatchObject({ NetworkMode: "none", ReadonlyRootfs: true, GroupAdd: ["64999"], RestartPolicy: { Name: "unless-stopped" } });
    expect(replacement.State.Running).toBe(true);
    // The old updater keeps running until it exits, renamed and without a restart policy.
    const old = harness.docker.find(OWN_ID) as FakeContainer;
    expect(old.Name).toBe(`/${PRE_NAME}`);
    expect(old.HostConfig.RestartPolicy).toEqual({ Name: "no" });
    expect((await readJson(handoverFile())).step).toBe("HANDED_OVER");
    expect(retired).toBe(1);
    expect(selfUpdate.isHandingOver()).toBe(true);
    expect(note).toContain(`updated itself from ${OLD_UPDATER} to ${NEW_VERSION}`);
    expect(await selfUpdate.readResult()).toMatchObject({ state: "SUCCEEDED", fromVersion: OLD_UPDATER, targetVersion: NEW_VERSION });
  });

  it("turns its own restart policy off before it gives up its name", async () => {
    await afterUpdate();

    const calls = harness.docker.calls;
    expect(calls.findIndex((call) => call.startsWith(`update ${UPDATER_NAME}`))).toBeLessThan(
      calls.findIndex((call) => call.startsWith(`rename ${UPDATER_NAME} ${PRE_NAME}`)),
    );
  });

  it("does not count its own liveness stamp, nor one from before the handover, as the new updater reporting in", async () => {
    harness.docker.onStart = () => {};
    await stamp(OLD_UPDATER);
    await afterUpdate();
    expect(byName(UPDATER_NAME)?.Id).toBe(OWN_ID);

    await stamp(NEW_VERSION, "2026-11-06T09:00:00Z");
    await afterUpdate();
    expect(byName(UPDATER_NAME)?.Id).toBe(OWN_ID);
  });
});

describe("updater self-update: rollback", () => {
  it("rolls back when the new updater does not report a heartbeat in time", async () => {
    harness.docker.onStart = () => {};
    const selfUpdate = selfUpdater();

    const note = await afterUpdate(selfUpdate);

    expect(harness.elapsedMs()).toBeGreaterThanOrEqual(60_000);
    const own = byName(UPDATER_NAME) as FakeContainer;
    expect(own.Id).toBe(OWN_ID);
    expect(own.HostConfig.RestartPolicy).toEqual({ Name: "unless-stopped" });
    expect([...harness.docker.containers.values()].filter((c) => c.Config.Image === NEW_REF)).toEqual([]);
    expect(await exists(handoverFile())).toBe(false);
    expect(retired).toBe(0);
    expect(selfUpdate.isHandingOver()).toBe(false);
    expect(note).toContain("did not report a heartbeat within 60s");
    expect(note).toContain("rolled back");
    expect((await selfUpdate.readResult())?.state).toBe("ROLLED_BACK");
  });

  it("rolls back at once when the new updater exits", async () => {
    harness.docker.onStart = () => {};
    harness.docker.newContainerPlan = "exits";

    const note = await afterUpdate();

    expect(harness.elapsedMs()).toBeLessThan(60_000);
    expect(byName(UPDATER_NAME)?.Id).toBe(OWN_ID);
    expect(note).toContain("the new updater stopped");
  });

  it("rolls back when the new container cannot be created", async () => {
    harness.docker.failOn("create", new DockerApiError("create refused", 403));

    const note = await afterUpdate();

    const own = byName(UPDATER_NAME) as FakeContainer;
    expect(own.Id).toBe(OWN_ID);
    expect(own.HostConfig.RestartPolicy).toEqual({ Name: "unless-stopped" });
    expect(note).toContain("create refused");
  });

  it("keeps the updater running and reports manual action when the rollback itself fails", async () => {
    harness.docker.onStart = () => {};
    harness.docker.failOn("rename", new DockerApiError("rename refused", 403), (args) => args[0] === PRE_NAME && args[1] === UPDATER_NAME);
    const selfUpdate = selfUpdater();

    const note = await afterUpdate(selfUpdate);

    expect(note).toContain("MANUAL ACTION REQUIRED");
    expect(selfUpdate.isHandingOver()).toBe(false);
    expect(await exists(handoverFile())).toBe(false);
    expect((await selfUpdate.readResult())?.state).toBe("FAILED");
  });
});

describe("updater self-update: preconditions (nothing changes)", () => {
  const unchanged = () => {
    expect(byName(UPDATER_NAME)?.Id).toBe(OWN_ID);
    expect(harness.docker.callsTo("rename")).toEqual([]);
    expect(harness.docker.callsTo("create")).toEqual([]);
  };

  it("does nothing when the app update is not newer than the updater, or self-update is off", async () => {
    expect(await afterUpdate(selfUpdater(), OLD_UPDATER)).toBe("");
    harness.config.selfUpdate = false;
    expect(await afterUpdate()).toBe("");
    expect(harness.docker.callsTo("pull")).toEqual([]);
    unchanged();
  });

  it("refuses without UPDATER_CONTAINER", async () => {
    harness.config.updaterContainer = undefined;
    expect(await afterUpdate()).toContain("UPDATER_CONTAINER is not set");
    unchanged();
  });

  it("refuses when the named container is not its own (hostname does not match)", async () => {
    expect(await afterUpdate(selfUpdater(() => "999999999999"))).toContain("is not this updater");
    expect(await afterUpdate(selfUpdater(() => "my-updater"))).toContain("is not this updater");
    unchanged();
  });

  it("refuses an image whose version label is not the target", async () => {
    harness.docker.images[NEW_REF] = { Id: "sha256:other", Config: { Labels: { "org.opencontainers.image.version": "9.9.9" } } };
    expect(await afterUpdate()).toContain(`not ${NEW_VERSION}`);
    unchanged();
  });

  it("refuses when the pull fails, and records the outcome", async () => {
    harness.docker.pullError = new DockerApiError("manifest unknown", 404);
    const selfUpdate = selfUpdater();
    expect(await afterUpdate(selfUpdate)).toContain("manifest unknown");
    expect(await selfUpdate.readResult()).toMatchObject({ state: "FAILED", targetVersion: NEW_VERSION });
    unchanged();
  });

  it("refuses while a container with the -pre- name is left over", async () => {
    harness.docker.add({ ...updaterContainer(), Id: "f".repeat(64), Name: `/${PRE_NAME}` });
    expect(await afterUpdate()).toContain(`${PRE_NAME} already exists`);
    expect(byName(UPDATER_NAME)?.Id).toBe(OWN_ID);
  });
});

describe("updater self-update: finishing a handover after a restart", () => {
  const NEW_ID = `0123456789ff${"1".repeat(52)}`;

  /** The record and containers a handover in `step` leaves behind. */
  async function leftBehind(step: string, { newRunning = true } = {}) {
    const own = harness.docker.find(OWN_ID) as FakeContainer;
    own.Name = `/${PRE_NAME}`;
    own.HostConfig.RestartPolicy = { Name: "no" };
    const started = step === "STARTED" || step === "HANDED_OVER";
    if (started) {
      harness.docker.add({
        ...updaterContainer(),
        Id: NEW_ID,
        Image: `sha256:id-of-${NEW_REF}`,
        Config: { ...updaterContainer().Config, Image: NEW_REF, Labels: { [SELF_UPDATE_LABEL]: "win-1" } },
        State: { Running: newRunning, Restarting: false, ExitCode: 0, StartedAt: "2026-11-06T10:00:00Z" },
      });
    }
    await writeFile(
      handoverFile(),
      JSON.stringify({
        requestId: "win-1",
        fromVersion: OLD_UPDATER,
        targetVersion: NEW_VERSION,
        name: UPDATER_NAME,
        preName: PRE_NAME,
        oldId: OWN_ID,
        newId: started ? NEW_ID : null,
        imageRef: NEW_REF,
        imageId: `sha256:id-of-${NEW_REF}`,
        restartPolicy: { Name: "unless-stopped" },
        startedAt: new Date(harness.clock.now()).toISOString(),
        step,
      }),
    );
    return own;
  }

  it("the new updater waits while the old one still runs, then removes it", async () => {
    const own = await leftBehind("HANDED_OVER");
    const asNew = selfUpdater(() => NEW_ID.slice(0, 12));

    expect(await asNew.resolvePending()).toBe("waiting");
    expect(harness.docker.find(OWN_ID)).toBeDefined();

    own.State.Running = false;
    expect(await asNew.resolvePending()).toBe("resolved");
    expect(harness.docker.find(OWN_ID)).toBeUndefined();
    expect(await exists(handoverFile())).toBe(false);
    expect((await asNew.readResult())?.state).toBe("SUCCEEDED");
    expect(await asNew.resolvePending()).toBe("none");
  });

  it("an old updater restarted before the new one started rolls back", async () => {
    const own = await leftBehind("RENAMED");

    expect(await selfUpdater().resolvePending()).toBe("resolved");

    expect(byName(UPDATER_NAME)?.Id).toBe(OWN_ID);
    expect(own.HostConfig.RestartPolicy).toEqual({ Name: "unless-stopped" });
    expect(await exists(handoverFile())).toBe(false);
  });

  it("an old updater restarted while the new one starts hands over once it reports in", async () => {
    await leftBehind("STARTED");
    await stamp(NEW_VERSION);

    expect(await selfUpdater().resolvePending()).toBe("waiting");
    expect(retired).toBe(1);
    expect((await readJson(handoverFile())).step).toBe("HANDED_OVER");
  });

  it("an old updater restarted while a new one that stopped was starting rolls back and removes it", async () => {
    await leftBehind("STARTED", { newRunning: false });

    expect(await selfUpdater().resolvePending()).toBe("resolved");
    expect(harness.docker.find(NEW_ID)).toBeUndefined();
    expect(byName(UPDATER_NAME)?.Id).toBe(OWN_ID);
  });

  it("an old updater restarted after handing over retires again", async () => {
    await afterUpdate();
    retired = 0;
    expect(await selfUpdater().resolvePending()).toBe("waiting");
    expect(retired).toBe(1);
  });

  it("sets a record aside that names neither container", async () => {
    await afterUpdate();
    expect(await selfUpdater(() => "eeeeeeeeeeee").resolvePending()).toBe("none");
    expect(await exists(handoverFile())).toBe(false);
  });
});

describe("updater self-update: integration", () => {
  const REQUEST = { id: "win-1", targetVersion: NEW_VERSION, requestedAt: FRESH_REQUESTED_AT, requestedBy: "admin@x" };

  it("runs after a successful app update and adds its outcome to the update's status", async () => {
    const flow = createUpdateFlow({ docker: harness.docker.asClient(), config: harness.config, clock: harness.clock, log: () => {}, selfUpdate: selfUpdater() });
    await harness.writeRequest(REQUEST);

    await flow.processPendingRequest();

    const status = await harness.readStatus();
    expect(status.state).toBe("SUCCEEDED");
    expect(status.message).toContain(`updated itself from ${OLD_UPDATER} to ${NEW_VERSION}`);
    expect(byName(UPDATER_NAME)?.Config.Image).toBe(NEW_REF);
    expect(retired).toBe(1);
  });

  it("does not self-update after a failed app update", async () => {
    harness.docker.newContainerPlan = "unhealthy";
    const flow = createUpdateFlow({ docker: harness.docker.asClient(), config: harness.config, clock: harness.clock, log: () => {}, selfUpdate: selfUpdater() });
    await harness.writeRequest(REQUEST);

    await flow.processPendingRequest();

    expect((await harness.readStatus()).state).toBe("ROLLED_BACK");
    expect(harness.docker.callsTo("pull").some((call) => call.includes(UPDATER_REPO))).toBe(false);
  });

  it("processes no request while a handover is waiting for the old updater", async () => {
    const flow = createUpdateFlow({
      docker: harness.docker.asClient(),
      config: harness.config,
      clock: harness.clock,
      log: () => {},
      selfUpdate: { afterAppUpdate: async () => "", resolvePending: async () => "waiting" },
    });
    await harness.writeRequest(REQUEST);

    expect(await flow.processPendingRequest()).toBe("idle");
    expect(harness.docker.callsTo("pull")).toEqual([]);
  });

  it("the service stops once a restarted old updater finds it already handed over", async () => {
    await afterUpdate();
    const lines: string[] = [];
    await runUpdater({
      config: { ...harness.config, pollIntervalMs: 5, heartbeatIntervalMs: 5 },
      docker: harness.docker.asClient(),
      signal: new AbortController().signal,
      clock: harness.clock,
      log: (line) => lines.push(line),
      hostname: () => OWN_HOSTNAME,
    });
    expect(lines.at(-1)).toBe("[updater] stopped: handed over to the new updater");
    expect(lines.some((line) => line.includes(" managing "))).toBe(false);
  });

  it("the heartbeat carries the version in the liveness stamp, the last self-update, and pauses during a handover", async () => {
    let paused = false;
    const selfUpdate = selfUpdater();
    const beat = createHeartbeat({
      docker: harness.docker.asClient(),
      config: harness.config,
      paths: statePaths(harness.stateDir),
      now: harness.clock.now,
      log: () => {},
      selfUpdateResult: selfUpdate.readResult,
      paused: () => paused,
    });
    harness.docker.pullError = new DockerApiError("manifest unknown", 404);
    await afterUpdate(selfUpdate);

    await beat();
    expect((await readJson(livenessFile())).version).toBe(OLD_UPDATER);
    const heartbeat = await readJson(join(harness.stateDir, "updater", "heartbeat.json"));
    expect(heartbeat.selfUpdate).toMatchObject({ state: "FAILED", targetVersion: NEW_VERSION });

    await writeFile(livenessFile(), "{}");
    paused = true;
    await beat();
    expect(await readJson(livenessFile())).toEqual({});
  });
});

it("keeps the restart policy of an updater that had none", async () => {
  (harness.docker.find(OWN_ID) as any).HostConfig.RestartPolicy = { Name: "no" };
  await afterUpdate();
  expect(harness.docker.callsTo("update").some((call) => call.startsWith(`update ${UPDATER_NAME}`))).toBe(false);
});
