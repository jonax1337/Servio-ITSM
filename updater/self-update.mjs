// Self-update: after a successful app update to version X, the updater replaces
// its own container with one of `UPDATER_IMAGE:X`, so fixes to the updater arrive
// with the release instead of waiting for the operator to re-run compose.
//
//   pull + checks (nothing changed on failure) -> PREPARING -> RENAMED -> STARTED -> HANDED_OVER
//                                                     \--------- rollback ---------/
//
// The old updater runs the whole handover and is never stopped while it does:
// it pauses its heartbeat (so only the new updater can refresh the liveness
// stamp), turns its own restart policy off, renames its container to
// `<name>-pre-<version>`, creates the new container under the original name from
// its own configuration (by tag), starts it and waits until the new updater
// writes a liveness stamp with version X. Then it records HANDED_OVER and exits;
// the new updater removes the stopped old container. If the new one does not
// report in time, exits or restarts, the old one removes it, takes its name and
// restart policy back and carries on. Only one updater ever processes requests:
// the new one waits while the handover record exists and the old one runs.
//
// The record lives on the updater-only backup volume (`.self-update.json`), so a
// restart of either updater can finish or undo a handover; the outcome of the
// last self-update (`.self-update-result.json`) is reported in the heartbeat.
import { hostname as osHostname } from "node:os";
import { join } from "node:path";
import { rename, rm } from "node:fs/promises";
import { withRetries } from "./docker-retry.mjs";
import { livenessFile } from "./heartbeat.mjs";
import {
  VERSION_LABEL,
  containerNameOf,
  hasRestartPolicy,
  ignoreNotFound,
  inspectContainerOrNull,
} from "./managed-container.mjs";
import { buildCreateSpec } from "./recreate.mjs";
import { syncDirectory } from "./safe-fs.mjs";
import { MAX_SMALL_JSON_BYTES, readJsonFile, writeJsonAtomic } from "./state-files.mjs";
import { compareVersions } from "./versions.mjs";

/** Set on the new updater container, to the id of the app update that triggered the handover. */
export const SELF_UPDATE_LABEL = "servio.updater.self-update";
const HANDOVER_FILE = ".self-update.json";
const RESULT_FILE = ".self-update-result.json";
const HANDOVER_STEPS = new Set(["PREPARING", "RENAMED", "STARTED", "HANDED_OVER"]);
/** Health polls the new updater must pass after its first liveness stamp, as the same instance. */
const SOAK_POLLS = 2;
const STOP_TIMEOUT_SEC = 10;
/** Docker's default hostname of a container: the first 12 hex digits of its id. */
const CONTAINER_HOSTNAME = /^[0-9a-f]{12}$/;

/**
 * @typedef {"PREPARING" | "RENAMED" | "STARTED" | "HANDED_OVER"} HandoverStep
 * @typedef {{
 *   requestId: string, fromVersion: string, targetVersion: string, name: string, preName: string,
 *   oldId: string, newId: string | null, imageRef: string, imageId: string,
 *   restartPolicy: { Name: string, MaximumRetryCount?: number } | null, startedAt: string, step: HandoverStep,
 * }} Handover
 * @typedef {"SUCCEEDED" | "ROLLED_BACK" | "FAILED"} SelfUpdateState
 * @typedef {{ state: SelfUpdateState, fromVersion: string, targetVersion: string, message: string, at: string }} SelfUpdateResult
 *   `FAILED`: nothing was changed, unless the message says MANUAL ACTION REQUIRED
 */

/** @param {unknown} error */
const messageOf = (error) => (error instanceof Error ? error.message : String(error));

/**
 * @param {{
 *   docker: import("./docker-client.mjs").DockerClient,
 *   config: import("./config.mjs").UpdaterConfig,
 *   clock: import("./update-flow.mjs").Clock,
 *   log?: (line: string) => void,
 *   hostname?: () => string,
 *   retire?: () => void,
 * }} deps `hostname` identifies the updater's own container (Docker sets it to the short container id);
 *   `retire` is called once the new updater has taken over: the old one must stop processing and exit
 */
export function createSelfUpdate({ docker: rawDocker, config, clock, log = console.log, hostname = osHostname, retire = () => {} }) {
  const docker = withRetries(rawDocker, { clock, windowMs: config.dockerRetryWindowMs, intervalMs: config.dockerRetryIntervalMs, log });
  const handoverFile = join(config.backupDir, HANDOVER_FILE);
  const resultFile = join(config.backupDir, RESULT_FILE);
  let handingOver = false;
  let lastWaitingFor = "";

  /** @param {string} nameOrId */
  const inspectOrNull = (nameOrId) => inspectContainerOrNull(docker, nameOrId);

  /**
   * Called after an app update to `targetVersion` succeeded.
   *
   * @param {{ requestId: string, targetVersion: string }} update
   * @returns {Promise<string>} a note for the update's status ("" when no self-update was due)
   */
  async function afterAppUpdate({ requestId, targetVersion }) {
    if (!config.selfUpdate || !((compareVersions(targetVersion, config.updaterVersion) ?? 0) > 0)) return "";
    const fromVersion = config.updaterVersion;
    let prepared;
    try {
      prepared = await prepare(targetVersion);
    } catch (error) {
      return record({
        state: "FAILED",
        fromVersion,
        targetVersion,
        message: `Updater self-update to ${targetVersion} skipped: ${messageOf(error)} The updater ${fromVersion} keeps running; nothing was changed.`,
      });
    }
    const { self, selfImage, image, imageRef } = prepared;
    const name = containerNameOf(self);
    const handover = handoverFor({
      requestId,
      fromVersion,
      targetVersion,
      name,
      preName: preNameFor(name),
      oldId: self.Id,
      newId: null,
      imageRef,
      imageId: image.Id,
      restartPolicy: self.HostConfig?.RestartPolicy ?? null,
      startedAt: new Date(clock.now()).toISOString(),
      step: "PREPARING",
    });
    handingOver = true;
    try {
      await handover.save({});
      await switchOver(handover, self, selfImage);
      await awaitNewUpdater(handover.data);
    } catch (error) {
      return rollBack(handover, messageOf(error));
    }
    return handOver(handover);
  }

  /**
   * Everything that can fail without changing anything: identify the own
   * container, refuse leftovers, pull and check the new image.
   *
   * @param {string} targetVersion
   */
  async function prepare(targetVersion) {
    if (!config.updaterContainer) throw new Error("UPDATER_CONTAINER is not set, so the updater cannot find its own container.");
    if (await readHandover()) throw new Error(`an earlier self-update is not finished (${handoverFile}).`);
    const self = await findSelf([config.updaterContainer]);
    if (!self) {
      throw new Error(
        `container ${config.updaterContainer} is not this updater (its id does not start with the hostname ${hostname()}); ` +
          "check UPDATER_CONTAINER, and do not set a hostname on the updater.",
      );
    }
    const preName = preNameFor(containerNameOf(self));
    if (await inspectOrNull(preName)) throw new Error(`container ${preName} already exists from an earlier self-update; remove it first.`);
    const imageRef = `${config.updaterImage}:${targetVersion}`;
    const deadline = clock.timeoutSignal(config.pullTimeoutMs);
    try {
      await docker.pullImage(config.updaterImage, targetVersion, { signal: deadline });
    } catch (error) {
      throw new Error(`pulling ${imageRef} failed (${deadline.aborted ? "PULL_TIMEOUT_SECONDS" : messageOf(error)}).`);
    }
    const image = await docker.inspectImage(imageRef);
    const labelled = image.Config?.Labels?.[VERSION_LABEL];
    if (labelled !== targetVersion) {
      throw new Error(`${imageRef} carries ${VERSION_LABEL}=${labelled ? `"${labelled}"` : "nothing"}, not ${targetVersion}.`);
    }
    return { self, selfImage: await docker.inspectImage(self.Image), image, imageRef };
  }

  /**
   * @param {ReturnType<typeof handoverFor>} handover
   * @param {any} self the old updater's container, inspected
   * @param {any} selfImage its image, inspected
   */
  async function switchOver(handover, self, selfImage) {
    const { name, preName, oldId, imageRef, imageId, requestId, restartPolicy } = handover.data;
    log(`[updater] self-update: handing over to ${imageRef}`);
    // Otherwise a Docker restart would start both updaters.
    if (hasRestartPolicy(restartPolicy)) await docker.updateContainer(oldId, { RestartPolicy: { Name: "no" } });
    await docker.renameContainer(oldId, preName);
    await handover.save({ step: "RENAMED" });
    const { body, extraNetworks } = buildCreateSpec(self, selfImage, imageRef);
    body.Labels = { ...body.Labels, [SELF_UPDATE_LABEL]: requestId };
    const created = await docker.createContainer(name, body);
    await handover.save({ newId: created.Id });
    const inspected = await docker.inspectContainer(created.Id);
    if (inspected.Image !== imageId) throw new Error(`${imageRef} pointed at another image than the pulled ${imageId} when the container was created`);
    for (const network of extraNetworks) await docker.connectNetwork(network.name, created.Id, network.endpointConfig);
    await docker.startContainer(created.Id);
    await handover.save({ step: "STARTED" });
  }

  /**
   * The new updater must write the liveness stamp with its version (the old one
   * paused its own) within UPDATER_SELF_UPDATE_TIMEOUT_SECONDS and then keep
   * running as the same instance for a few more polls.
   *
   * @param {Handover} data
   */
  async function awaitNewUpdater(data) {
    const newId = /** @type {string} */ (data.newId);
    const deadline = clock.now() + config.selfUpdateTimeoutMs;
    for (;;) {
      const container = await docker.inspectContainer(newId);
      const problem = runningProblem(container);
      if (problem) throw new Error(`the new updater ${problem}`);
      if (await stampedBy(data.targetVersion, data.startedAt)) return soak(newId, container);
      if (clock.now() >= deadline) {
        throw new Error(`the new updater did not report a heartbeat within ${config.selfUpdateTimeoutMs / 1000}s (UPDATER_SELF_UPDATE_TIMEOUT_SECONDS)`);
      }
      await clock.sleep(config.healthIntervalMs);
    }
  }

  /**
   * @param {string} id
   * @param {any} first the container as it first reported in
   */
  async function soak(id, first) {
    for (let poll = 0; poll < SOAK_POLLS; poll += 1) {
      await clock.sleep(config.healthIntervalMs);
      const container = await docker.inspectContainer(id);
      const problem = runningProblem(container) ?? (container.State.StartedAt !== first.State.StartedAt ? "was restarted" : null);
      if (problem) throw new Error(`the new updater ${problem} right after reporting in`);
    }
  }

  /**
   * @param {string} version
   * @param {string} since ISO time the handover started
   */
  async function stampedBy(version, since) {
    const stamp = await readJsonFile(livenessFile(config.backupDir), MAX_SMALL_JSON_BYTES).catch(() => null);
    return stamp?.version === version && typeof stamp.at === "string" && Date.parse(stamp.at) >= Date.parse(since);
  }

  /**
   * @param {ReturnType<typeof handoverFor>} handover
   * @returns {Promise<string>}
   */
  async function handOver(handover) {
    const { fromVersion, targetVersion, preName } = handover.data;
    await handover.save({ step: "HANDED_OVER" });
    const note = await record({
      state: "SUCCEEDED",
      fromVersion,
      targetVersion,
      message:
        `The updater updated itself from ${fromVersion} to ${targetVersion}: the new updater is running and reporting; ` +
        `the previous one stops and its container ${preName} is removed by the new one.`,
    });
    retire();
    return note;
  }

  /**
   * Undoes a handover: the new container goes, the old one gets its name and
   * restart policy back and resumes. Every step can be repeated.
   *
   * @param {ReturnType<typeof handoverFor>} handover
   * @param {string} reason
   * @returns {Promise<string>}
   */
  async function rollBack(handover, reason) {
    const { name, oldId, fromVersion, targetVersion, restartPolicy, step } = handover.data;
    try {
      await removeNewUpdater(handover.data);
      const old = await docker.inspectContainer(oldId);
      if (containerNameOf(old) !== name) await docker.renameContainer(oldId, name);
      if (hasRestartPolicy(restartPolicy)) await docker.updateContainer(oldId, { RestartPolicy: restartPolicy });
    } catch (error) {
      const aside = await setHandoverAside();
      return record({
        state: "FAILED",
        fromVersion,
        targetVersion,
        message:
          `MANUAL ACTION REQUIRED — the updater self-update to ${targetVersion} failed (${reason}) and could not be undone ` +
          `(${messageOf(error)}). This updater keeps running; make sure exactly one updater container exists, named ${name}` +
          `${hasRestartPolicy(restartPolicy) ? ` with restart policy ${restartPolicy?.Name}` : ""}. The handover record is kept at ${aside}.`,
      });
    } finally {
      handingOver = false;
    }
    await rm(handoverFile, { force: true });
    await syncDirectory(config.backupDir);
    const changed = step !== "PREPARING";
    return record({
      state: changed ? "ROLLED_BACK" : "FAILED",
      fromVersion,
      targetVersion,
      message: changed
        ? `Updater self-update to ${targetVersion} failed (${reason}); rolled back: the new updater container was removed and the updater ${fromVersion} keeps running.`
        : `Updater self-update to ${targetVersion} failed (${reason}); the updater ${fromVersion} keeps running, nothing was changed.`,
    });
  }

  /**
   * The container the handover created: the recorded one and, if the record did
   * not get its id, the one holding the name that carries this handover's label and image.
   *
   * @param {Handover} data
   */
  async function removeNewUpdater(data) {
    const occupant = await inspectOrNull(data.name);
    const unrecorded =
      occupant && occupant.Id !== data.oldId && occupant.Config?.Labels?.[SELF_UPDATE_LABEL] === data.requestId && occupant.Image === data.imageId
        ? occupant.Id
        : null;
    for (const id of new Set([data.newId, unrecorded].filter((id) => id && id !== data.oldId))) {
      await ignoreNotFound(docker.stopContainer(/** @type {string} */ (id), STOP_TIMEOUT_SEC));
      await ignoreNotFound(docker.removeContainer(/** @type {string} */ (id), { force: true }));
    }
  }

  /**
   * Finishes a handover a previous process left behind; called at start-up and on
   * every poll. The new updater removes the old container once it has stopped; an
   * old updater that was restarted mid-handover resumes it.
   *
   * @returns {Promise<"none" | "waiting" | "resolved">} `waiting`: the handover is still running, process no request
   */
  async function resolvePending() {
    const data = await readHandover().catch(() => null);
    if (!data) return "none";
    const self = await findSelf([data.name, data.preName]);
    if (self?.Id === data.oldId) return resumeAsOld(data);
    if (self?.Id === data.newId) return finishAsNew(data);
    const aside = await setHandoverAside();
    log(`[updater] self-update: the handover record does not name this container; it was set aside as ${aside}. Check \`docker ps -a\`.`);
    return "none";
  }

  /** @param {Handover} data */
  async function finishAsNew(data) {
    const old = await inspectOrNull(data.oldId);
    if (old?.State?.Running) {
      if (lastWaitingFor !== data.oldId) log(`[updater] self-update: waiting for the previous updater ${data.preName} to stop`);
      lastWaitingFor = data.oldId;
      return "waiting";
    }
    if (old) await ignoreNotFound(docker.removeContainer(data.oldId));
    await rm(handoverFile, { force: true });
    await syncDirectory(config.backupDir);
    const result = await readResult();
    if (result?.targetVersion !== data.targetVersion || result.state !== "SUCCEEDED") {
      await record({
        state: "SUCCEEDED",
        fromVersion: data.fromVersion,
        targetVersion: data.targetVersion,
        message: `The updater updated itself from ${data.fromVersion} to ${data.targetVersion} (completed after the previous updater stopped).`,
      });
    }
    log(`[updater] self-update from ${data.fromVersion} complete; the previous updater container was removed`);
    return "resolved";
  }

  /** @param {Handover} data */
  async function resumeAsOld(data) {
    handingOver = true;
    const handover = handoverFor(data);
    if (data.step === "HANDED_OVER") {
      retire();
      return "waiting";
    }
    if (data.step !== "STARTED") {
      log(`[updater] ${await rollBack(handover, `the updater restarted during step ${data.step}`)}`);
      return "resolved";
    }
    try {
      await awaitNewUpdater(data);
    } catch (error) {
      log(`[updater] ${await rollBack(handover, messageOf(error))}`);
      return "resolved";
    }
    log(`[updater] ${await handOver(handover)}`);
    return "waiting";
  }

  /**
   * The updater's own container among `names`: the one whose id starts with this
   * container's hostname. Null when the hostname is not a container id prefix.
   *
   * @param {string[]} names
   */
  async function findSelf(names) {
    const own = hostname();
    if (!CONTAINER_HOSTNAME.test(own)) return null;
    for (const name of names) {
      const container = await inspectOrNull(name);
      if (container?.Id.startsWith(own)) return container;
    }
    return null;
  }

  /** @param {string} name */
  const preNameFor = (name) => `${name}-pre-${config.updaterVersion.replace(/[^0-9A-Za-z.-]/g, "_")}`;

  /**
   * @param {Handover} initial
   */
  function handoverFor(initial) {
    const data = { ...initial };
    return {
      data,
      /** @param {Partial<Handover>} changes */
      async save(changes) {
        await writeJsonAtomic(handoverFile, { ...data, ...changes }, [config.backupDir]);
        Object.assign(data, changes);
      },
    };
  }

  /** @returns {Promise<Handover | null>} */
  async function readHandover() {
    const raw = await readJsonFile(handoverFile, MAX_SMALL_JSON_BYTES);
    if (raw === null) return null;
    if (isHandover(raw)) return raw;
    const aside = await setHandoverAside();
    log(`[updater] self-update: the handover record is malformed and was set aside as ${aside}`);
    return null;
  }

  /** @returns {Promise<string>} where the record is now */
  async function setHandoverAside() {
    const stamp = new Date(clock.now()).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const aside = join(config.backupDir, `.self-update.manual-${stamp}.json`);
    await rename(handoverFile, aside).catch((/** @type {NodeJS.ErrnoException} */ error) => {
      if (error.code !== "ENOENT") throw error;
    });
    await syncDirectory(config.backupDir);
    return aside;
  }

  /**
   * @param {Omit<SelfUpdateResult, "at">} result
   * @returns {Promise<string>} the message, as a note for the update's status
   */
  async function record(result) {
    log(`[updater] self-update ${result.state}: ${result.message}`);
    try {
      await writeJsonAtomic(resultFile, { ...result, at: new Date(clock.now()).toISOString() }, [config.backupDir]);
    } catch (error) {
      log(`[updater] could not record the self-update result: ${messageOf(error)}`);
    }
    return result.message;
  }

  /** @returns {Promise<SelfUpdateResult | null>} the outcome of the last self-update, for the heartbeat */
  async function readResult() {
    const raw = await readJsonFile(resultFile, MAX_SMALL_JSON_BYTES).catch(() => null);
    return isResult(raw) ? raw : null;
  }

  return {
    afterAppUpdate,
    resolvePending,
    readResult,
    /** True while this updater hands over to a new one: it must not refresh its liveness stamp or heartbeat. */
    isHandingOver: () => handingOver,
  };
}

/**
 * @param {any} container inspected
 * @returns {string | null}
 */
function runningProblem(container) {
  const state = container.State ?? {};
  if (state.Restarting) return "is restarting";
  if (!state.Running) return `stopped (exit code ${state.ExitCode})`;
  if (state.Health?.Status === "unhealthy") return "is unhealthy";
  return null;
}

/** @param {any} value @returns {value is Handover} */
function isHandover(value) {
  const strings = ["requestId", "fromVersion", "targetVersion", "name", "preName", "oldId", "imageRef", "imageId", "startedAt"];
  return (
    strings.every((key) => typeof value?.[key] === "string") &&
    HANDOVER_STEPS.has(value.step) &&
    (value.newId === null || typeof value.newId === "string") &&
    (value.restartPolicy === null || typeof value.restartPolicy?.Name === "string")
  );
}

/** @param {any} value @returns {value is SelfUpdateResult} */
function isResult(value) {
  return (
    ["SUCCEEDED", "ROLLED_BACK", "FAILED"].includes(value?.state) &&
    ["fromVersion", "targetVersion", "message", "at"].every((key) => typeof value[key] === "string")
  );
}
