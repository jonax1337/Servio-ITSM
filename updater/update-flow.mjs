// The update state machine. Docker access and time are injected so the whole
// flow (including rollback and crash recovery) runs against an in-memory fake in tests.
//
//   validate -> PULLING -> BACKING_UP -> SWITCHING -> HEALTH_CHECK -> SUCCEEDED
//                                            \--> rollback -> ROLLED_BACK (or FAILED if the rollback breaks)
//
// Before the old container is stopped, a journal is written to the updater-only
// backup volume and updated at every step. If the updater dies mid-update, the
// next start finishes or reverts the work from that journal.
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { createBackup, findBackupSources, pruneBackups, restoreBackup } from "./backup.mjs";
import { MANAGED_LABEL, containerNameOf, findManagedContainer, installedVersionOf } from "./managed-container.mjs";
import { buildCreateSpec } from "./recreate.mjs";
import { UnsafeFileError } from "./safe-fs.mjs";
import { MAX_SMALL_JSON_BYTES, MAX_STATUS_BYTES, readJsonFile, statePaths, writeJsonAtomic } from "./state-files.mjs";
import { compareVersions } from "./versions.mjs";

const TARGET_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const MAX_VERSION_LENGTH = 128;
const REQUEST_ID = /^[\w-]{1,64}$/;
const ROLLBACK_STOP_TIMEOUT_SEC = 10;
const FUTURE_SKEW_MS = 5 * 60_000;
const JOURNAL_FILE = ".journal.json";
const TERMINAL_STATES = new Set(["SUCCEEDED", "FAILED", "ROLLED_BACK"]);
/** Journal steps from which the new container may already have touched the database. */
const SWITCH_STEPS = new Set(["SWITCHING", "STARTED", "SWITCHED"]);

/**
 * @typedef {"PENDING" | "PULLING" | "BACKING_UP" | "SWITCHING" | "HEALTH_CHECK" | "SUCCEEDED" | "FAILED" | "ROLLED_BACK"} UpdaterState
 * @typedef {{ now: () => number, sleep: (ms: number) => Promise<void>, timeoutSignal: (ms: number) => AbortSignal }} Clock
 * @typedef {{ state: UpdaterState, message: string }} Outcome
 * @typedef {{
 *   requestId: string, targetVersion: string, fromVersion: string | null, name: string, preName: string,
 *   oldId: string, newId: string | null, backup: import("./backup.mjs").Backup | null,
 *   step: "STOPPING" | "BACKED_UP" | "SWITCHING" | "STARTED" | "SWITCHED",
 * }} Journal
 */

/** @type {Clock} */
export const systemClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutSignal: (ms) => AbortSignal.timeout(ms),
};

/** The update cannot be undone automatically; an operator has to act. */
class ManualActionRequired extends Error {}

/** @param {unknown} error */
const messageOf = (error) => (error instanceof Error ? error.message : String(error));

/**
 * @param {{
 *   docker: import("./docker-client.mjs").DockerClient,
 *   config: import("./config.mjs").UpdaterConfig,
 *   clock?: Clock,
 *   log?: (line: string) => void,
 * }} deps
 */
export function createUpdateFlow({ docker, config, clock = systemClock, log = console.log }) {
  const paths = statePaths(config.stateDir);
  const journalFile = join(config.backupDir, JOURNAL_FILE);
  let lastIgnored = "";
  /** Request ids this process already started: a status that cannot be written must never cause a replay. */
  const attempted = new Set();

  const readRequest = () => readJsonFile(paths.request, MAX_SMALL_JSON_BYTES);
  const readStatus = () => readJsonFile(paths.status, MAX_STATUS_BYTES);
  /** @param {string} file @param {unknown} value */
  const writeState = (file, value) => writeJsonAtomic(file, value, [paths.stateDir, paths.updaterDir]);
  const clearJournal = () => rm(journalFile, { force: true });

  /** @param {string} reason */
  function ignoreOnce(reason) {
    if (reason !== lastIgnored) log(`[updater] ignoring request: ${reason}`);
    lastIgnored = reason;
  }

  /**
   * Runs the request in `request.json` unless its id already has a status.
   *
   * @returns {Promise<"idle" | "ignored" | "processed">}
   */
  async function processPendingRequest() {
    let request;
    let status;
    try {
      request = await readRequest();
      status = request ? await readStatus() : null;
    } catch (error) {
      if (!(error instanceof UnsafeFileError)) throw error;
      ignoreOnce(error.message);
      return "ignored";
    }
    if (!request) return "idle";
    if (typeof request.id !== "string" || !REQUEST_ID.test(request.id)) {
      ignoreOnce(`no valid id in ${JSON.stringify(request).slice(0, 200)}`);
      return "ignored";
    }
    if (status?.id === request.id || attempted.has(request.id)) return "idle";

    attempted.add(request.id);
    await runUpdate(request);
    return "processed";
  }

  /**
   * Called once at start-up. Finishes or reverts an update that an earlier
   * updater process left half done, so some managed container is running again.
   */
  async function recoverInterrupted() {
    const journal = await readJsonFile(journalFile, MAX_SMALL_JSON_BYTES);
    const status = await readStatus();
    if (isJournal(journal)) return recoverFromJournal(journal, status);

    if (!status || TERMINAL_STATES.has(status.state)) return;
    const message =
      `Updater restarted while the update was in state ${status.state}. The container state is unknown: ` +
      "check `docker ps -a` and restore the previous container if the application is down.";
    await createReporter(status).report("FAILED", message);
  }

  /** @param {any} request */
  async function runUpdate(request) {
    const reporter = createReporter({
      id: request.id,
      state: "PENDING",
      fromVersion: null,
      targetVersion: String(request.targetVersion).slice(0, MAX_VERSION_LENGTH),
      message: "",
      updatedAt: "",
      log: [],
    });
    try {
      const outcome = await performUpdate(request, reporter);
      await clearJournal();
      await reporter.report(outcome.state, outcome.message);
    } catch (error) {
      if (!(error instanceof ManualActionRequired)) await clearJournal();
      await reporter.report("FAILED", messageOf(error));
    }
  }

  /**
   * @param {{ id: string, state: UpdaterState, fromVersion: string | null, targetVersion: string, message: string, updatedAt: string,
   *   log: Array<{ at: string, state: UpdaterState, message: string }> }} status
   */
  function createReporter(status) {
    return {
      /** @param {string | null} version */
      setFromVersion(version) {
        status.fromVersion = version;
      },
      /**
       * @param {UpdaterState} state
       * @param {string} message
       */
      async report(state, message) {
        const at = new Date(clock.now()).toISOString();
        status.log = [...(status.log ?? []), { at, state, message }];
        Object.assign(status, { state, message, updatedAt: at });
        log(`[updater] ${state}: ${message}`);
        // Best effort: an unwritable status file (e.g. a swapped directory) must not stop a rollback.
        await writeState(paths.status, status).catch((/** @type {Error} */ error) => {
          log(`[updater] could not write status.json: ${error.message}`);
        });
      },
      /** Log a step without changing the state. @param {string} message */
      note(message) {
        return this.report(status.state, message);
      },
    };
  }

  /**
   * @param {any} request
   * @param {ReturnType<typeof createReporter>} reporter
   * @returns {Promise<Outcome>}
   */
  async function performUpdate(request, reporter) {
    const targetVersion = validateRequest(request);
    const imageRef = `${config.image}:${targetVersion}`;

    const current = await findManagedContainer(docker, config.containerName);
    const name = containerNameOf(current);
    const fromVersion = installedVersionOf(current);
    reporter.setFromVersion(fromVersion);
    await assertUpgrade(fromVersion, targetVersion, reporter);
    const backupMode = backupModeFor(current);
    if (backupMode === "file") await findBackupSources(config.dbFile);
    const preName = `${name}-pre-${(fromVersion ?? "unknown").replace(/[^0-9A-Za-z.-]/g, "_")}`;
    await assertNameFree(preName);

    const image = await pullAndPin(imageRef, targetVersion, reporter);
    const currentImage = await docker.inspectImage(current.Image);
    await assertRequestStillCurrent(request);

    const journal = createJournal({
      requestId: request.id,
      targetVersion,
      fromVersion,
      name,
      preName,
      oldId: current.Id,
      newId: null,
      backup: null,
      step: "STOPPING",
    });
    await reporter.report("BACKING_UP", `Stopping ${name} and backing up the database`);
    await stopAndBackUp({ current, fromVersion, backupMode, journal, reporter });

    return switchOver({ current, currentImage, image, imageRef, journal, reporter });
  }

  /**
   * @param {any} request
   * @returns {string} the validated target version
   */
  function validateRequest(request) {
    const { targetVersion } = request;
    if (typeof targetVersion !== "string" || targetVersion.length > MAX_VERSION_LENGTH || !TARGET_VERSION.test(targetVersion)) {
      throw new Error("Rejected: targetVersion must be a semantic version such as 1.2.3 or 1.2.3-rc.1");
    }
    const age = clock.now() - Date.parse(request.requestedAt);
    if (Number.isNaN(age)) throw new Error("Rejected: requestedAt is missing or not a date");
    if (age > config.requestMaxAgeMs) {
      throw new Error(`Rejected: the request is ${Math.round(age / 1000)}s old (limit REQUEST_MAX_AGE_SECONDS=${config.requestMaxAgeMs / 1000})`);
    }
    if (age < -FUTURE_SKEW_MS) throw new Error("Rejected: requestedAt lies in the future");
    return targetVersion;
  }

  /**
   * Only upgrades are allowed unless ALLOW_DOWNGRADE=true. When the installed
   * version is unknown (image without version label) the update proceeds with a warning.
   *
   * @param {string | null} installed
   * @param {string} target
   * @param {ReturnType<typeof createReporter>} reporter
   */
  async function assertUpgrade(installed, target, reporter) {
    if (config.allowDowngrade) return;
    const order = installed ? compareVersions(target, installed) : null;
    if (order === null) {
      await reporter.note(`Installed version is unknown (${installed ?? "no version label"}); cannot check that ${target} is newer`);
    } else if (order <= 0) {
      throw new Error(
        `Refusing to install ${target}: it is not newer than the installed ${installed}. ` +
          "Set ALLOW_DOWNGRADE=true on the updater to allow it (the database is not migrated back). Nothing was changed.",
      );
    }
  }

  /**
   * @param {any} container
   * @returns {"file" | "none"}
   */
  function backupModeFor(container) {
    const databaseUrl = envValue(container.Config?.Env, "DATABASE_URL");
    if (databaseUrl?.startsWith("file:")) {
      const file = databaseUrl.slice("file:".length).split("?")[0];
      if (file !== config.dbFile) {
        throw new Error(
          `DATABASE_URL (${databaseUrl}) must be an absolute file: URL equal to the updater's DB_FILE=${config.dbFile}. Nothing was changed.`,
        );
      }
      return "file";
    }
    if (config.allowUpdateWithoutBackup) return "none";
    throw new Error(
      "DATABASE_URL is not a SQLite file: URL, so the updater cannot back up the database. " +
        "Back it up yourself and set ALLOW_UPDATE_WITHOUT_BACKUP=true to update anyway. Nothing was changed.",
    );
  }

  /**
   * A leftover `-pre-` container means an earlier update needs manual attention;
   * it may be the only copy of the previous version, so it is never replaced.
   *
   * @param {string} name
   */
  async function assertNameFree(name) {
    if (await inspectOrNull(name)) {
      throw new Error(`Container ${name} already exists from an earlier update; remove it manually first. Nothing was changed.`);
    }
  }

  /**
   * Pulls under a deadline and returns the pulled image; the container is later
   * created from its id, so a tag that moves after the pull cannot change what runs.
   *
   * @param {string} imageRef
   * @param {string} targetVersion
   * @param {ReturnType<typeof createReporter>} reporter
   */
  async function pullAndPin(imageRef, targetVersion, reporter) {
    await reporter.report("PULLING", `Pulling ${imageRef}`);
    const deadline = clock.timeoutSignal(config.pullTimeoutMs);
    try {
      await docker.pullImage(config.image, targetVersion, { signal: deadline });
    } catch (error) {
      if (!deadline.aborted) throw error;
      throw new Error(`Pulling ${imageRef} did not finish within ${config.pullTimeoutMs / 1000}s (PULL_TIMEOUT_SECONDS). Nothing was changed.`);
    }
    const image = await docker.inspectImage(imageRef);
    const digest = (image.RepoDigests ?? []).find((/** @type {string} */ entry) => entry.startsWith(`${config.image}@`)) ?? "none";
    await reporter.note(`Pulled ${imageRef}: image ${image.Id}, digest ${digest}`);
    return image;
  }

  /**
   * The pull can take long; the admin may have cancelled or replaced the window meanwhile.
   *
   * @param {any} request
   */
  async function assertRequestStillCurrent(request) {
    const latest = await readRequest().catch((/** @type {unknown} */ error) => {
      if (error instanceof UnsafeFileError) return null;
      throw error;
    });
    if (latest?.id !== request.id || latest.targetVersion !== request.targetVersion) {
      throw new Error(`Request ${request.id} was withdrawn or replaced before the old container was stopped. Nothing was changed.`);
    }
  }

  /** @param {Journal} initial */
  function createJournal(initial) {
    const data = { ...initial };
    return {
      data,
      /** @param {Partial<Journal>} changes */
      async save(changes) {
        Object.assign(data, changes);
        await writeJsonAtomic(journalFile, data, [config.backupDir]);
      },
    };
  }

  /**
   * @param {{ current: any, fromVersion: string | null, backupMode: "file" | "none",
   *   journal: ReturnType<typeof createJournal>, reporter: ReturnType<typeof createReporter> }} ctx
   */
  async function stopAndBackUp({ current, fromVersion, backupMode, journal, reporter }) {
    try {
      await journal.save({ step: "STOPPING" });
      await docker.stopContainer(current.Id, config.stopTimeoutSec);
      /** @type {import("./backup.mjs").Backup | null} */
      let backup = null;
      if (backupMode === "file") {
        backup = await createBackup({ dbFile: config.dbFile, backupDir: config.backupDir, fromVersion, at: new Date(clock.now()) });
        await reporter.note(`Database backed up to ${backup.path}`);
      } else {
        await reporter.note("No database backup (ALLOW_UPDATE_WITHOUT_BACKUP=true, database is not a SQLite file)");
      }
      await journal.save({ step: "BACKED_UP", backup });
    } catch (error) {
      await restartAfterAbortedBackup(current, error);
      throw error;
    }
  }

  /**
   * @param {any} current
   * @param {unknown} cause
   */
  async function restartAfterAbortedBackup(current, cause) {
    try {
      await docker.startContainer(current.Id);
    } catch (restartError) {
      throw new ManualActionRequired(
        `ROLLBACK FAILED — manual action required: the update was aborted (${messageOf(cause)}) and ` +
          `${containerNameOf(current)} could not be restarted (${messageOf(restartError)}).`,
      );
    }
  }

  /**
   * @param {{ current: any, currentImage: any, image: any, imageRef: string,
   *   journal: ReturnType<typeof createJournal>, reporter: ReturnType<typeof createReporter> }} ctx
   * @returns {Promise<Outcome>}
   */
  async function switchOver({ current, currentImage, image, imageRef, journal, reporter }) {
    const { name, preName } = journal.data;
    try {
      await journal.save({ step: "SWITCHING" });
      await reporter.report("SWITCHING", `Renaming ${name} to ${preName} and creating a new ${name} from ${imageRef} (${image.Id})`);
      await docker.renameContainer(current.Id, preName);
      const { body, extraNetworks } = buildCreateSpec(current, currentImage, image.Id);
      const created = await docker.createContainer(name, body);
      await journal.save({ newId: created.Id });
      for (const network of extraNetworks) await docker.connectNetwork(network.name, created.Id, network.endpointConfig);
      await docker.startContainer(created.Id);
      await journal.save({ step: "STARTED" });

      await reporter.report("HEALTH_CHECK", `Waiting for ${name} (${imageRef}) to become healthy`);
      await waitUntilHealthy(created.Id, name);
      await journal.save({ step: "SWITCHED" });
    } catch (error) {
      return rollBack({ ...journal.data, switchStarted: true, reason: messageOf(error), reporter });
    }
    return completeSwitch({ ...journal.data, prune: true });
  }

  /**
   * The new container is healthy: remove the old one and trim old backups.
   * Pruning happens only now, and never touches the backup of this update.
   *
   * @param {{ oldId: string, preName: string, fromVersion: string | null, targetVersion: string,
   *   backup: import("./backup.mjs").Backup | null, prune?: boolean }} done
   * @returns {Promise<Outcome>}
   */
  async function completeSwitch({ oldId, preName, fromVersion, targetVersion, backup, prune = false }) {
    const notes = [];
    await docker.removeContainer(oldId, { force: true }).then(
      () => notes.push("The previous container was removed."),
      (/** @type {Error & { status?: number }} */ error) => {
        notes.push(
          error.status === 404
            ? "The previous container was already gone."
            : `The previous container ${preName} could not be removed (${error.message}); remove it manually before the next update.`,
        );
      },
    );
    if (prune && backup) {
      await pruneBackups(config.backupDir, config.backupKeep, backup.path).catch((/** @type {Error} */ error) => {
        notes.push(`Old backups could not be pruned (${error.message}).`);
      });
    }
    if (backup) notes.push(`Database backup: ${backup.path}.`);
    return { state: "SUCCEEDED", message: `Updated from ${fromVersion ?? "unknown"} to ${targetVersion}. ${notes.join(" ")}` };
  }

  /**
   * Undoes a failed or interrupted switch, driven by what Docker reports rather
   * than by what the caller thinks happened: replacement container out, database
   * back (only while the old container is stopped), old container renamed and started.
   *
   * @param {Pick<Journal, "oldId" | "name" | "preName" | "newId" | "backup" | "fromVersion" | "targetVersion"> & {
   *   switchStarted: boolean, reason: string, reporter: ReturnType<typeof createReporter> }} failed
   * @returns {Promise<Outcome>}
   */
  async function rollBack({ oldId, name, preName, newId, backup, fromVersion, targetVersion, switchStarted, reason, reporter }) {
    let restored = false;
    try {
      await reporter.note(`Update failed (${reason}); rolling back`);
      await removeReplacement(oldId, name, newId);
      const old = await docker.inspectContainer(oldId);
      if (switchStarted && backup && !old.State.Running) {
        await restoreBackup(config.dbFile, backup);
        restored = true;
      }
      if (containerNameOf(old) !== name) await docker.renameContainer(oldId, name);
      await docker.startContainer(oldId);
      await waitUntilHealthy(oldId, name);
    } catch (rollbackError) {
      throw new ManualActionRequired(
        `ROLLBACK FAILED — manual action required: ${messageOf(rollbackError)}. Original failure: ${reason}. ` +
          `Previous container: ${preName} (or ${name}). Database backup: ${backup?.path ?? "none"}.`,
      );
    }
    const restoredNote = restored ? "database restored from backup, " : "";
    return switchStarted
      ? {
          state: "ROLLED_BACK",
          message: `Update to ${targetVersion} failed (${reason}). Rolled back to ${fromVersion ?? "the previous version"}: ${restoredNote}previous container is running again.`,
        }
      : { state: "FAILED", message: `Update to ${targetVersion} aborted (${reason}). The previous container was started again; nothing was changed.` };
  }

  /**
   * Removes the container that took the managed name after the old one was renamed
   * (and the one the journal knows), provided it is a managed container.
   *
   * @param {string} oldId
   * @param {string} name
   * @param {string | null} newId
   */
  async function removeReplacement(oldId, name, newId) {
    const occupant = await inspectOrNull(name);
    const isManagedReplacement = occupant && occupant.Id !== oldId && occupant.Config?.Labels?.[MANAGED_LABEL] === "true";
    const ids = new Set([newId, isManagedReplacement ? occupant.Id : null].filter((id) => id && id !== oldId));
    for (const id of ids) {
      await ignoreNotFound(docker.stopContainer(/** @type {string} */ (id), ROLLBACK_STOP_TIMEOUT_SEC));
      await ignoreNotFound(docker.removeContainer(/** @type {string} */ (id), { force: true }));
    }
  }

  /**
   * @param {Journal} journal
   * @param {any} status
   */
  async function recoverFromJournal(journal, status) {
    const reporter = createReporter(
      status?.id === journal.requestId
        ? status
        : {
            id: journal.requestId,
            state: "PENDING",
            fromVersion: journal.fromVersion,
            targetVersion: journal.targetVersion,
            message: "",
            updatedAt: "",
            log: [],
          },
    );
    const reason = `updater restarted during step ${journal.step}`;
    try {
      const outcome =
        journal.step === "SWITCHED"
          ? await completeSwitch(journal)
          : await rollBack({ ...journal, switchStarted: SWITCH_STEPS.has(journal.step), reason, reporter });
      await clearJournal();
      await reporter.report(outcome.state, `Recovered after an updater restart. ${outcome.message}`);
    } catch (error) {
      await reporter.report("FAILED", messageOf(error));
    }
  }

  /**
   * Polls until the container reports healthy. Fails when it exits, restarts,
   * turns unhealthy, or is not healthy in time. A container without a
   * HEALTHCHECK counts as healthy once it has stayed running for `noHealthcheckSettleMs`.
   *
   * @param {string} id
   * @param {string} label
   */
  async function waitUntilHealthy(id, label) {
    const deadline = clock.now() + config.healthTimeoutMs;
    /** @type {number | null} */
    let runningSince = null;
    for (;;) {
      const { State: state } = await docker.inspectContainer(id);
      if (!state.Running || state.Restarting) {
        throw new Error(`${label} stopped or restarted (exit code ${state.ExitCode}) before becoming healthy`);
      }
      if (state.Health) {
        if (state.Health.Status === "healthy") return;
        if (state.Health.Status === "unhealthy") throw new Error(`${label} reported unhealthy`);
      } else {
        runningSince ??= clock.now();
        if (clock.now() - runningSince >= config.noHealthcheckSettleMs) return;
      }
      if (clock.now() >= deadline) {
        throw new Error(`${label} was not healthy within ${config.healthTimeoutMs / 1000}s (health: ${state.Health?.Status ?? "no healthcheck"})`);
      }
      await clock.sleep(config.healthIntervalMs);
    }
  }

  /** @param {string} nameOrId */
  async function inspectOrNull(nameOrId) {
    try {
      return await docker.inspectContainer(nameOrId);
    } catch (error) {
      if (/** @type {{ status?: number }} */ (error).status === 404) return null;
      throw error;
    }
  }

  return { processPendingRequest, recoverInterrupted };
}

/** @param {any} value @returns {value is Journal} */
function isJournal(value) {
  return Boolean(value) && ["requestId", "oldId", "name", "preName", "step"].every((key) => typeof value[key] === "string");
}

/**
 * @param {string[] | null | undefined} env `KEY=value` entries
 * @param {string} key
 */
function envValue(env, key) {
  const prefix = `${key}=`;
  return env?.find((entry) => entry.startsWith(prefix))?.slice(prefix.length);
}

/** @param {Promise<unknown>} call */
async function ignoreNotFound(call) {
  try {
    await call;
  } catch (error) {
    if (/** @type {{ status?: number }} */ (error).status !== 404) throw error;
  }
}
