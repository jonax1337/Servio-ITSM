/* eslint-disable @typescript-eslint/no-explicit-any -- Docker image payloads are untyped Engine API JSON */
// Disk housekeeping of the updater: the free-space check before a pull, the
// cleanup of superseded images after a successful update, the tag reference of
// the recreated container, the active request in the heartbeat and the retried
// status write.
import { createHash } from "node:crypto";
import { readFile, rename, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../updater/config.mjs";
import type { DockerClient } from "../../updater/docker-client.mjs";
import { createHeartbeat } from "../../updater/heartbeat.mjs";
import {
  MAX_DOWNLOAD_HINT_BYTES,
  describePrune,
  downloadHint,
  planImagePrune,
  pullSpaceNeeded,
} from "../../updater/image-housekeeping.mjs";
import { statePaths } from "../../updater/state-files.mjs";
import {
  CONTAINER_NAME,
  FRESH_REQUESTED_AT,
  IMAGE_REPO,
  NEW_VERSION,
  OLD_VERSION,
  createHarness,
  type Harness,
} from "./updater-test-kit";

const UPDATER_REPO = `${IMAGE_REPO}-updater`;
const REQUEST = { id: "win-1", targetVersion: NEW_VERSION, requestedAt: FRESH_REQUESTED_AT, requestedBy: "admin@x" };
const GB = 1024 ** 3;
const digest = (seed: string) => `sha256:${createHash("sha256").update(seed).digest("hex")}`;

/** An entry of `GET /images/json` for a release of `repo`. */
const release = (repo: string, version: string, extra: Record<string, any> = {}) => ({
  Id: `sha256:id-of-${repo}:${version}`,
  RepoTags: [`${repo}:${version}`],
  RepoDigests: [`${repo}@${digest(`${repo}:${version}`)}`],
  Labels: { "org.opencontainers.image.version": version },
  ...extra,
});

describe("planImagePrune", () => {
  const plan = (images: any[], overrides: Record<string, unknown> = {}) =>
    planImagePrune({
      images,
      repository: IMAGE_REPO,
      runningVersion: "0.5.0",
      protectedIds: [],
      rollbackVersion: "0.4.0",
      keep: 1,
      ...overrides,
    }).map((image) => image.version);

  it("keeps the replaced release as rollback target and removes older ones", () => {
    const images = ["0.1.0", "0.2.0", "0.3.0", "0.4.0", "0.5.0"].map((v) => release(IMAGE_REPO, v));
    expect(plan(images)).toEqual(["0.3.0", "0.2.0", "0.1.0"]);
  });

  it("keeps the replaced release first even when a newer superseded release exists", () => {
    // 0.4.1 was pulled for an update that rolled back; 0.4.0 is what ran before 0.5.0.
    const images = ["0.4.0", "0.4.1", "0.5.0"].map((v) => release(IMAGE_REPO, v));
    expect(plan(images)).toEqual(["0.4.1"]);
  });

  it("keeps more superseded releases when asked to", () => {
    const images = ["0.1.0", "0.2.0", "0.3.0", "0.4.0"].map((v) => release(IMAGE_REPO, v));
    expect(plan(images, { keep: 2 })).toEqual(["0.2.0", "0.1.0"]);
  });

  it("never removes the running release, newer releases, protected ids or images without a version", () => {
    const images = [
      release(IMAGE_REPO, "0.5.0"),
      release(IMAGE_REPO, "0.6.0"),
      release(IMAGE_REPO, "0.2.0", { Id: "sha256:protected" }),
      { Id: "sha256:custom", RepoTags: [`${IMAGE_REPO}:custom-build`], RepoDigests: [], Labels: {} },
      release(IMAGE_REPO, "0.1.0"),
    ];
    expect(plan(images, { protectedIds: ["sha256:protected"], rollbackVersion: null, keep: 1 })).toEqual([]);
  });

  it("leaves images alone that also carry a reference of another repository", () => {
    const shared = release(IMAGE_REPO, "0.1.0", { RepoTags: [`${IMAGE_REPO}:0.1.0`, "mirror.example/servio:0.1.0"] });
    expect(plan([release(IMAGE_REPO, "0.4.0"), shared])).toEqual([]);
    const sharedDigest = release(IMAGE_REPO, "0.2.0", { RepoDigests: [`other/servio@${digest("other")}`] });
    expect(plan([release(IMAGE_REPO, "0.4.0"), sharedDigest])).toEqual([]);
  });

  it("does not confuse the updater repository with the app repository", () => {
    expect(plan([release(IMAGE_REPO, "0.4.0"), release(UPDATER_REPO, "0.1.0")])).toEqual([]);
  });

  it("removes untagged superseded images by their digest reference", () => {
    const dangling = { Id: "sha256:dangling", RepoTags: ["<none>:<none>"], RepoDigests: [`${IMAGE_REPO}@${digest("dangling")}`], Labels: { "org.opencontainers.image.version": "0.3.0" } };
    const planned = planImagePrune({
      images: [release(IMAGE_REPO, "0.4.0"), dangling],
      repository: IMAGE_REPO,
      runningVersion: "0.5.0",
      protectedIds: [],
      rollbackVersion: "0.4.0",
      keep: 1,
    });
    expect(planned).toEqual([{ id: "sha256:dangling", version: "0.3.0", refs: [`${IMAGE_REPO}@${digest("dangling")}`] }]);
  });

  it("removes every tag of an image, tags before digests", () => {
    const twoTags = release(IMAGE_REPO, "0.3.0", { RepoTags: [`${IMAGE_REPO}:0.3.0`, `${IMAGE_REPO}:latest`] });
    const [planned] = planImagePrune({
      images: [release(IMAGE_REPO, "0.4.0"), twoTags],
      repository: IMAGE_REPO,
      runningVersion: "0.5.0",
      protectedIds: [],
      rollbackVersion: "0.4.0",
      keep: 1,
    });
    expect(planned.refs).toEqual([`${IMAGE_REPO}:0.3.0`, `${IMAGE_REPO}:latest`, twoTags.RepoDigests[0]]);
  });

  it("does nothing when the running version is unknown", () => {
    expect(plan([release(IMAGE_REPO, "0.1.0")], { runningVersion: null })).toEqual([]);
  });

  it("describes what happened", () => {
    expect(describePrune({ removed: [], kept: [], failed: [] })).toBe("");
    expect(describePrune({ removed: ["a:1"], kept: ["a:2"], failed: ["a:3 (boom)"] })).toBe(
      "Removed superseded images: a:1. Kept superseded images a container still uses: a:2. Could not remove: a:3 (boom).",
    );
  });
});

describe("pullSpaceNeeded and downloadHint", () => {
  it("adds the compressed download, the unpacked size (the installed image's) and the margin", () => {
    expect(pullSpaceNeeded({ downloadBytes: 1 * GB, installedBytes: 3 * GB, marginBytes: GB })).toEqual({
      download: GB,
      unpacked: 3 * GB,
      margin: GB,
      total: 5 * GB,
    });
  });

  it("falls back to the installed size when the registry size is unknown", () => {
    expect(pullSpaceNeeded({ downloadBytes: null, installedBytes: 2 * GB, marginBytes: 0 }).total).toBe(4 * GB);
    expect(pullSpaceNeeded({ downloadBytes: null, installedBytes: undefined, marginBytes: GB }).total).toBe(GB);
  });

  it("accepts only a plausible download size", () => {
    expect(downloadHint(123)).toBe(123);
    expect(downloadHint(MAX_DOWNLOAD_HINT_BYTES)).toBe(MAX_DOWNLOAD_HINT_BYTES);
    for (const value of [0, -1, 1.5, "100", null, undefined, MAX_DOWNLOAD_HINT_BYTES + 1, Number.NaN]) {
      expect(downloadHint(value)).toBeNull();
    }
  });
});

describe("update flow: image cleanup after success", () => {
  let harness: Harness;
  afterEach(() => harness.cleanup());

  async function update(env: Record<string, string> = {}) {
    harness = await createHarness({ env });
    harness.docker.imageList = [
      release(IMAGE_REPO, "0.1.0"),
      release(IMAGE_REPO, OLD_VERSION, { Id: "sha256:oldimage" }),
      release(IMAGE_REPO, NEW_VERSION),
      release(UPDATER_REPO, "0.0.1"),
      release(UPDATER_REPO, "0.0.2"),
      { Id: "sha256:unrelated", RepoTags: ["postgres:16"], RepoDigests: [] },
    ];
  }

  it("removes superseded images of both repositories and keeps the rollback target", async () => {
    await update();
    await harness.writeRequest(REQUEST);
    await harness.flow.processPendingRequest();

    const status = await harness.readStatus();
    expect(status.state).toBe("SUCCEEDED");
    expect(harness.docker.callsTo("removeImage")).toEqual([
      `removeImage ${IMAGE_REPO}:0.1.0`,
      `removeImage ${IMAGE_REPO}@${digest(`${IMAGE_REPO}:0.1.0`)}`,
      `removeImage ${UPDATER_REPO}:0.0.1`,
      `removeImage ${UPDATER_REPO}@${digest(`${UPDATER_REPO}:0.0.1`)}`,
    ]);
    const left = harness.docker.imageList.map((image) => image.RepoTags?.[0]);
    expect(left).toEqual([`${IMAGE_REPO}:${OLD_VERSION}`, `${IMAGE_REPO}:${NEW_VERSION}`, `${UPDATER_REPO}:0.0.2`, "postgres:16"]);
    expect(status.message).toContain(`Removed superseded images: ${IMAGE_REPO}:0.1.0.`);
    expect(status.message).toContain(`Removed superseded images: ${UPDATER_REPO}:0.0.1.`);
  });

  it("keeps an image Docker refuses to delete because a container uses it", async () => {
    await update();
    harness.docker.imagesInUse.add(`${IMAGE_REPO}:0.1.0`);
    await harness.writeRequest(REQUEST);
    await harness.flow.processPendingRequest();

    const status = await harness.readStatus();
    expect(status.state).toBe("SUCCEEDED");
    expect(status.message).toContain(`Kept superseded images a container still uses: ${IMAGE_REPO}:0.1.0.`);
    expect(harness.docker.imageList.some((image) => image.RepoTags?.includes(`${IMAGE_REPO}:0.1.0`))).toBe(true);
  });

  it("still succeeds when the cleanup fails", async () => {
    await update();
    harness.docker.failOn("listImages", new Error("proxy refused"));
    await harness.writeRequest(REQUEST);
    await harness.flow.processPendingRequest();

    const status = await harness.readStatus();
    expect(status.state).toBe("SUCCEEDED");
    expect(status.message).toContain(`Superseded images of ${IMAGE_REPO} could not be cleaned up (proxy refused).`);
  });

  it("keeps more releases with UPDATER_KEEP_IMAGES and none are touched with PRUNE_IMAGES=false", async () => {
    await update({ UPDATER_KEEP_IMAGES: "2" });
    await harness.writeRequest(REQUEST);
    await harness.flow.processPendingRequest();
    expect(harness.docker.callsTo("removeImage")).toEqual([]);
    await harness.cleanup();

    await update({ PRUNE_IMAGES: "false" });
    await harness.writeRequest(REQUEST);
    await harness.flow.processPendingRequest();
    expect(harness.docker.callsTo("listImages")).toEqual([]);
    expect((await harness.readStatus()).state).toBe("SUCCEEDED");
  });

  it("does not clean up after a rollback", async () => {
    await update();
    harness.docker.newContainerPlan = "unhealthy";
    await harness.writeRequest(REQUEST);
    await harness.flow.processPendingRequest();

    expect((await harness.readStatus()).state).toBe("ROLLED_BACK");
    expect(harness.docker.callsTo("listImages")).toEqual([]);
  });
});

describe("update flow: free space before the pull", () => {
  let harness: Harness;
  afterEach(() => harness.cleanup());
  const TARGET = `${IMAGE_REPO}:${NEW_VERSION}`;

  async function setUp(freeBytes: number, env: Record<string, string> = {}) {
    harness = await createHarness({ freeBytes, env });
    harness.docker.missingImages.add(TARGET);
    harness.docker.images["sha256:oldimage"].Size = 3 * GB;
  }

  it("fails with a clear message and changes nothing when the image would not fit", async () => {
    await setUp(2 * GB);
    await harness.writeRequest({ ...REQUEST, downloadBytes: GB });
    await harness.flow.processPendingRequest();

    const status = await harness.readStatus();
    expect(status.state).toBe("FAILED");
    expect(status.message).toContain("Not enough free space for the image pull: 2.0 GB free");
    expect(status.message).toContain("5.0 GB needed");
    expect(status.message).toContain("(1.0 GB download, 3.0 GB unpacked, 1.0 GB margin)");
    expect(status.message).toContain("Nothing was changed.");
    expect(harness.docker.callsTo("pull")).toEqual([]);
    expect(harness.docker.callsTo("stop")).toEqual([]);
  });

  it("estimates the download from the installed image without a registry size", async () => {
    await setUp(2 * GB);
    await harness.writeRequest(REQUEST);
    await harness.flow.processPendingRequest();

    expect((await harness.readStatus()).message).toContain("(3.0 GB estimated download, 3.0 GB unpacked, 1.0 GB margin)");
  });

  it("pulls when there is room", async () => {
    await setUp(10 * GB);
    await harness.writeRequest({ ...REQUEST, downloadBytes: GB });
    await harness.flow.processPendingRequest();

    expect((await harness.readStatus()).state).toBe("SUCCEEDED");
    expect(harness.docker.callsTo("pull")).toEqual([`pull ${TARGET}`]);
  });

  it("skips the check when the image is already on the host", async () => {
    await setUp(GB);
    harness.docker.missingImages.clear();
    await harness.writeRequest(REQUEST);
    await harness.flow.processPendingRequest();

    expect((await harness.readStatus()).state).toBe("SUCCEEDED");
  });

  it("skips the check with PULL_SPACE_CHECK=false and honours PULL_SPACE_MARGIN_MB", async () => {
    await setUp(GB, { PULL_SPACE_CHECK: "false" });
    await harness.writeRequest(REQUEST);
    await harness.flow.processPendingRequest();
    expect((await harness.readStatus()).state).toBe("SUCCEEDED");
    await harness.cleanup();

    await setUp(6 * GB + 1, { PULL_SPACE_MARGIN_MB: "0" });
    await harness.writeRequest(REQUEST);
    await harness.flow.processPendingRequest();
    expect((await harness.readStatus()).state).toBe("SUCCEEDED");
  });

  it("cleans up superseded images first when space is short", async () => {
    harness = await createHarness({ freeBytes: 0 });
    harness.docker.missingImages.add(TARGET);
    harness.docker.imageList = [release(IMAGE_REPO, "0.1.0"), release(IMAGE_REPO, "0.1.5"), release(IMAGE_REPO, OLD_VERSION, { Id: "sha256:oldimage" })];
    await harness.writeRequest(REQUEST);
    await harness.flow.processPendingRequest();

    const status = await harness.readStatus();
    expect(status.state).toBe("FAILED");
    // The installed release and the newest older one stay; only 0.1.0 goes.
    expect(harness.docker.callsTo("removeImage")[0]).toBe(`removeImage ${IMAGE_REPO}:0.1.0`);
    expect(status.log.some((entry: any) => entry.message.startsWith("Low on space before the pull. Removed superseded images"))).toBe(true);
  });
});

describe("update flow: container reference", () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await createHarness();
  });
  afterEach(() => harness.cleanup());

  it("rolls back when the tag no longer points at the pulled image at create time", async () => {
    const ref = `${IMAGE_REPO}:${NEW_VERSION}`;
    const docker = harness.docker;
    const client = new Proxy(docker, {
      get(target, property) {
        const value = Reflect.get(target, property) as unknown;
        if (typeof value !== "function") return value;
        if (property !== "createContainer") return value.bind(target);
        return async (...args: any[]) => {
          // Someone pulled a different image under the same tag after our pull.
          target.images[ref] = { Id: "sha256:moved", Config: { Labels: { "org.opencontainers.image.version": NEW_VERSION } } };
          return value.apply(target, args);
        };
      },
    }) as unknown as DockerClient;
    await harness.writeRequest(REQUEST);
    await harness.newFlow(client).processPendingRequest();

    const status = await harness.readStatus();
    expect(status.state).toBe("ROLLED_BACK");
    expect(status.message).toContain("instead of the pulled");
    expect(docker.byName(CONTAINER_NAME)?.Config.Image).toBe(`${IMAGE_REPO}:${OLD_VERSION}`);
  });
});

describe("update flow: progress the app can rely on", () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await createHarness();
  });
  afterEach(() => harness.cleanup());

  it("reports the active request while it runs and none afterwards", async () => {
    let during: unknown = null;
    harness.docker.onPull = () => {
      during = harness.flow.activeRequest();
    };
    expect(harness.flow.activeRequest()).toBeNull();
    await harness.writeRequest(REQUEST);
    await harness.flow.processPendingRequest();

    expect(during).toEqual({ id: "win-1", state: "PULLING" });
    expect(harness.flow.activeRequest()).toBeNull();
  });

  it("writes a final status that could not be written on a later poll", async () => {
    const updaterDir = join(harness.stateDir, "updater");
    // The status directory is swapped for a link while the image pulls: every status write is refused.
    harness.docker.onPull = async () => {
      await rename(updaterDir, `${updaterDir}-real`);
      await symlink(`${updaterDir}-real`, updaterDir, "junction");
    };
    await harness.writeRequest(REQUEST);
    await harness.flow.processPendingRequest();
    expect(harness.logLines.some((line) => line.includes("could not write status.json (retried on every poll)"))).toBe(true);

    // The cause is gone (on a full disk: space is back): the next poll writes the outcome.
    await rm(updaterDir);
    await rename(`${updaterDir}-real`, updaterDir);
    await harness.flow.processPendingRequest();

    const status = JSON.parse(await readFile(join(updaterDir, "status.json"), "utf8"));
    expect(status).toMatchObject({ id: "win-1", state: "SUCCEEDED" });
    expect(harness.logLines.some((line) => line.includes("status.json written after an earlier failure (SUCCEEDED)"))).toBe(true);
  });

  it("puts the active request into the heartbeat", async () => {
    const config = loadConfig({ SERVIO_IMAGE: IMAGE_REPO, SERVIO_CONTAINER: CONTAINER_NAME, BACKUP_DIR: harness.backupDir, SERVIO_STATE_DIR: harness.stateDir });
    const beat = createHeartbeat({
      docker: harness.docker.asClient(),
      config,
      paths: statePaths(harness.stateDir),
      now: () => Date.parse("2026-11-06T10:00:00Z"),
      log: () => {},
      activeRequest: () => ({ id: "win-7", state: "HEALTH_CHECK" }),
    });
    await beat();

    const heartbeat = JSON.parse(await readFile(join(harness.stateDir, "updater", "heartbeat.json"), "utf8"));
    expect(heartbeat.activeRequestId).toBe("win-7");
  });
});

describe("configuration of the housekeeping", () => {
  const config = (env: Record<string, string> = {}) => loadConfig({ SERVIO_IMAGE: IMAGE_REPO, ...env });

  it("applies the documented defaults", () => {
    expect(config()).toMatchObject({
      updaterImage: UPDATER_REPO,
      pruneImages: true,
      keepImages: 1,
      pullSpaceCheck: true,
      pullSpaceMarginBytes: 1024 * 1024 * 1024,
      pullSpaceProbeDir: "/backups",
    });
    expect(config({ BACKUP_DIR: "/srv/backups" }).pullSpaceProbeDir).toBe("/srv/backups");
  });

  it("reads overrides", () => {
    expect(
      config({
        UPDATER_IMAGE: "registry.local:5000/team/updater",
        UPDATER_KEEP_IMAGES: "3",
        PRUNE_IMAGES: "false",
        PULL_SPACE_CHECK: "false",
        PULL_SPACE_MARGIN_MB: "0",
        PULL_SPACE_PROBE_DIR: "/docker-root",
      }),
    ).toMatchObject({
      updaterImage: "registry.local:5000/team/updater",
      keepImages: 3,
      pruneImages: false,
      pullSpaceCheck: false,
      pullSpaceMarginBytes: 0,
      pullSpaceProbeDir: "/docker-root",
    });
  });

  it("refuses invalid values", () => {
    expect(() => config({ UPDATER_KEEP_IMAGES: "0" })).toThrow("UPDATER_KEEP_IMAGES");
    expect(() => config({ PRUNE_IMAGES: "yes" })).toThrow("PRUNE_IMAGES");
    expect(() => config({ PULL_SPACE_MARGIN_MB: "-1" })).toThrow("PULL_SPACE_MARGIN_MB");
    expect(() => config({ UPDATER_IMAGE: "ghcr.io/x/updater:1.0.0" })).toThrow("UPDATER_IMAGE");
  });
});
