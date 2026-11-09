// The update state machine. Docker access, time and free-space lookup are injected
// so the whole flow (including rollback and crash recovery) runs against an
// in-memory fake in tests.
//
//   validate -> space check -> PULLING -> BACKING_UP -> SWITCHING -> HEALTH_CHECK -> SUCCEEDED -> image cleanup (a note)
//                                                          \--> rollback -> ROLLED_BACK (or FAILED if the rollback breaks)
//
// Before the old container is stopped, a journal is written to the updater-only
// backup volume and updated at every step. If the updater dies mid-update, the
// next start finishes or reverts the work from that journal, but only while
// Docker still looks the way the journal says: a container an operator put in
// place is never removed. Whatever needs a human (a failed rollback, a changed
// world) sets the journal aside and blocks further updates until it is deleted.
import { readdir, rename, rm } from "node:fs/promises";
import { join, posix } from "node:path";
import { assertFreeSpace, createBackup, findBackupSources, freeBytesOn, pruneBackups, restoreBackup } from "./backup.mjs";
import { isTransientDockerError, retryWhileUnreachable, withRetries } from "./docker-retry.mjs";
import { describePrune, downloadHint, formatBytes, pruneSupersededImages, pullSpaceNeeded } from "./image-housekeeping.mjs";
import { createLedger } from "./ledger.mjs";
import { UPDATE_REQUEST_LABEL, VERSION_LABEL, containerNameOf, findManagedContainer, installedVersionOf } from "./managed-container.mjs";
import { buildCreateSpec } from "./recreate.mjs";
import { UnsafeFileError, regularFileExists, syncDirectory } from "./safe-fs.mjs";
import { MAX_SMALL_JSON_BYTES, MAX_STATUS_BYTES, readJsonFile, statePaths, writeJsonAtomic } from "./state-files.mjs";
import { compareVersions } from "./versions.mjs";

const TARGET_VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const MAX_VERSION_LENGTH = 128;
const REQUEST_ID = /^[\w-]{1,64}$/;
const ROLLBACK_STOP_TIMEOUT_SEC = 10;
const FUTURE_SKEW_MS = 5 * 60_000;
const JOURNAL_FILE = ".journal.json";
/** The live journal and the ones set aside for an operator (`.journal.manual-<time>.json`). */
const JOURNAL_NAMES = /^\.journal(\.manual-[\w.-]+)?\.json$/;
const MAX_LOG_ENTRIES = 500;
const SHORT_ID_LENGTH = 12;
/**
 * Health polls a new container must pass after its first "healthy" before the
 * switch counts as done: a container that crashes right away (and is restarted
 * by its restart policy) must be rolled back, not kept.
 */
const SOAK_POLLS = 2;
const UPDATER_STATES = new Set(["PENDING", "PULLING", "BACKING_UP", "SWITCHING", "HEALTH_CHECK", "SUCCEEDED", "FAILED", "ROLLED_BACK"]);
const TERMINAL_STATES = new Set(["SUCCEEDED", "FAILED", "ROLLED_BACK"]);
const JOURNAL_STEPS = new Set(["STOPPING", "BACKED_UP", "SWITCHING", "STARTED", "SWITCHED", "RESTORED"]);
/**
 * Journal steps in which the new container may have touched the database and the
 * rollback has not dealt with it yet. `RESTORED` follows them: the backup is back,
 * or there was none to restore.
 */
const RESTORE_STEPS = new Set(["SWITCHING", "STARTED"]);
/** Journal steps in which the old container has not been renamed or replaced. */
const PRE_SWITCH_STEPS = new Set(["STOPPING", "BACKED_UP"]);

/**
 * @typedef {"PENDING" | "PULLING" | "BACKING_UP" | "SWITCHING" | "HEALTH_CHECK" | "SUCCEEDED" | "FAILED" | "ROLLED_BACK"} UpdaterState
 * @typedef {{ now: () => number, sleep: (ms: number) => Promise<void>, timeoutSignal: (ms: number) => AbortSignal }} Clock
 * @typedef {{ id: string, state: UpdaterState }} ActiveRequest the request the updater is working on, reported in the heartbeat
 * @typedef {{ state: UpdaterState, message: string, manual?: boolean, pending?: boolean }} Outcome
 *   `pending`: Docker did not answer, so the update could not be finished or undone yet; the journal stays and it is retried
 * @typedef {{ at: string, state: UpdaterState, message: string }} LogEntry
 * @typedef {{ id: string, state: UpdaterState, fromVersion: string | null, targetVersion: string, message: string,
 *   updatedAt: string, log: LogEntry[] }} Status
 * @typedef {{ Name: string, MaximumRetryCount?: number }} RestartPolicy
 * @typedef {{ startedAt: string, restartCount: number }} ServingInstance the new container as it passed its health check
 * @typedef {"STOPPING" | "BACKED_UP" | "SWITCHING" | "STARTED" | "SWITCHED" | "RESTORED"} JournalStep
 * @typedef {{
 *   requestId: string, targetVersion: string, fromVersion: string | null, name: string, preName: string,
 *   oldId: string, newId: string | null, newImageId: string, oldImageId?: string, restartPolicy: RestartPolicy | null,
 *   backup: import("./backup.mjs").Backup | null, step: JournalStep, served?: ServingInstance,
 * }} JournalData
 *   `oldImageId`: the image the old container ran, kept as rollback target by the cleanup (absent in journals of older updaters)
 * @typedef {{ data: JournalData, save: (changes: Partial<JournalData>) => Promise<void> }} Journal
 */

/** @type {Clock} */
export const systemClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutSignal: (ms) => AbortSignal.timeout(ms),
};

/** The update cannot be finished or undone automatically; an operator has to act. */
class ManualActionRequired extends Error {}

/** A rollback or recovery stopped only because Docker did not answer; it is resumed from the journal. */
class WaitingForDocker extends Error {}

/** @param {unknown} error */
const messageOf = (error) => (error instanceof Error ? error.message : String(error));

/** @param {string} id */
const shortId = (id) => id.replace(/^sha256:/, "").slice(0, SHORT_ID_LENGTH);

/**
 * @param {{
 *   docker: import("./docker-client.mjs").DockerClient,
 *   config: import("./config.mjs").UpdaterConfig,
 *   clock?: Clock,
 *   log?: (line: string) => void,
 *   freeBytes?: (dir: string) => Promise<number>,
 * }} deps
 */
export function createUpdateFlow({ docker: rawDocker, config, clock = systemClock, log = console.log, freeBytes = freeBytesOn }) {
  const retryOptions = { clock, windowMs: config.dockerRetryWindowMs, intervalMs: config.dockerRetryIntervalMs, log };
  const docker = withRetries(rawDocker, retryOptions);
  const paths = statePaths(config.stateDir);
  const journalFile = join(config.backupDir, JOURNAL_FILE);
  const ledger = createLedger({ backupDir: config.backupDir, now: clock.now });
  let lastIgnored = "";
  /** Request ids this process already started; the ledger covers restarts. */
  const attempted = new Set();
  /** @type {ActiveRequest | null} */
  let active = null;
  /** @type {Status | null} a status whose last write failed (e.g. a full disk); written again on every poll until it lands */
  let unwrittenStatus = null;

  const readRequest = () => readJsonFile(paths.request, MAX_SMALL_JSON_BYTES);
  /** @param {string} file @param {unknown} value */
  const writeState = (file, value) => writeJsonAtomic(file, value, [paths.stateDir, paths.updaterDir]);

  /** @param {string} reason */
  function ignoreOnce(reason) {
    if (reason !== lastIgnored) log(`[updater] ignoring request: ${reason}`);
    lastIgnored = reason;
  }

  /**
   * Runs the request in `request.json` unless it was handled before.
   *
   * @returns {Promise<"idle" | "ignored" | "processed">}
   */
  async function processPendingRequest() {
    await retryUnwrittenStatus();
    if (await regularFileExists(journalFile)) {
      // A rollback that Docker interrupted (or an outcome whose journal could not be set aside).
      await recoverInterrupted();
      return "processed";
    }
    let request;
    try {
      request = await readRequest();
    } catch (error) {
      // Unsafe or unreadable (e.g. the directory was replaced by a file): retried on the next poll.
      ignoreOnce(messageOf(error));
      return "ignored";
    }
    if (request === null) return "idle";
    const id = request?.id;
    if (typeof id !== "string" || !REQUEST_ID.test(id)) {
      ignoreOnce(`no valid id in ${JSON.stringify(request).slice(0, 200)}`);
      return "ignored";
    }
    if (attempted.has(id) || (await ledger.hasHandled(id)) || (await readStatusOrNull())?.id === id) return "idle";

    await ledger.markHandled(id);
    attempted.add(id);
    await runUpdate(request);
    return "processed";
  }

  /**
   * Called once at start-up, before anything reads the shared state directory.
   * Finishes or reverts an update that an earlier updater process left half
   * done, so some managed container is running again.
   */
  async function recoverInterrupted() {
    const journal = await readJsonFile(journalFile, MAX_SMALL_JSON_BYTES);
    if (journal !== null) {
      if (isJournal(journal)) return recoverFromJournal(journal);
      const aside = await setJournalAside();
      log(`[updater] MANUAL ACTION REQUIRED: the update journal is malformed and was moved to ${aside}; check \`docker ps -a\`.`);
      return;
    }

    const status = await readStatusOrNull();
    if (!status || TERMINAL_STATES.has(status.state)) return;
    const message =
      `Updater restarted while the update was in state ${status.state}. The container state is unknown: ` +
      "check `docker ps -a` and restore the previous container if the application is down.";
    await createReporter(status).report("FAILED", message);
  }

  /** @param {any} request */
  async function runUpdate(request) {
    active = { id: request.id, state: "PENDING" };
    // A status of an earlier request that never landed must not overwrite this one's.
    unwrittenStatus = null;
    const run = {
      reporter: createReporter(newStatus(request.id, String(request.targetVersion).slice(0, MAX_VERSION_LENGTH), null)),
      /** @type {Journal | null} set once the journal exists, i.e. once the app may be taken down */
      journal: null,
    };
    const outcome = await settle(performUpdate(request, run));
    await finish(outcome, run.reporter, run.journal);
  }

  /**
   * Ends an update. A manual-action outcome sets the journal aside before it is
   * reported; any other outcome is reported before the journal goes away. A crash
   * in between therefore leaves either a set-aside journal or a (harmless) replay.
   *
   * @param {Outcome} outcome
   * @param {ReturnType<typeof createReporter>} reporter
   * @param {Journal | null} journal null when the update ended before the app was touched
   */
  async function finish(outcome, reporter, journal) {
    let { message } = outcome;
    if (outcome.pending) {
      await reporter.note(message);
      return;
    }
    if (outcome.manual) message += await setJournalAsideNote();
    message += await pruneOldBackups(journal?.data.backup?.path ?? null);
    await reporter.report(outcome.state, message);
    if (journal && outcome.state !== "SUCCEEDED") await startCooldown(journal.data.targetVersion);
    if (!outcome.manual) {
      await rm(journalFile, { force: true });
      await syncDirectory(config.backupDir);
    }
    // The update is done once it is reported; the cleanup only adds a note and can never undo the success.
    if (outcome.state === "SUCCEEDED" && journal) {
      const cleanup = await pruneImagesAfterSuccess(journal.data);
      if (cleanup) await reporter.note(message + cleanup);
    }
  }

  /** Writes a status whose earlier write failed; quiet while it keeps failing. */
  async function retryUnwrittenStatus() {
    const pending = unwrittenStatus;
    if (!pending) return;
    try {
      await writeState(paths.status, pending);
    } catch {
      return;
    }
    unwrittenStatus = null;
    log(`[updater] status.json written after an earlier failure (${pending.state})`);
  }

  /**
   * After a successful update: removes superseded Servio and updater images,
   * keeping the image the old container ran (the rollback target, by id) and the
   * newest others up to UPDATER_KEEP_IMAGES. Never fails the update.
   *
   * @param {JournalData} data
   * @returns {Promise<string>} a note for the status
   */
  async function pruneImagesAfterSuccess(data) {
    if (!config.pruneImages) return "";
    return pruneImages([
      { repository: config.image, runningVersion: data.targetVersion, protectedIds: [data.newImageId], rollbackImageId: data.oldImageId ?? null },
      { repository: config.updaterImage, runningVersion: config.updaterVersion, protectedIds: [], rollbackImageId: null },
    ]);
  }

  /**
   * @param {Array<{ repository: string, runningVersion: string | null, protectedIds: string[], rollbackImageId: string | null }>} targets
   * @returns {Promise<string>} a note for the status ("" when nothing was removed or kept)
   */
  async function pruneImages(targets) {
    const notes = [];
    for (const target of targets) {
      try {
        const result = await pruneSupersededImages({ docker, keep: config.keepImages, ...target });
        const note = describePrune(result);
        if (note) notes.push(note);
      } catch (error) {
        notes.push(`Superseded images of ${target.repository} could not be cleaned up (${messageOf(error)}).`);
      }
    }
    return notes.length > 0 ? ` ${notes.join(" ")}` : "";
  }

  /**
   * Refuses to pull when Docker's data root lacks room for the image: a pull that
   * runs out of space fails half-way and can leave the host with a full disk.
   * When space is short, superseded images are cleaned up first and the space is
   * measured again. An image that is already present needs no room.
   *
   * @param {{ request: any, imageRef: string, current: any, currentImage: any, fromVersion: string | null,
   *   reporter: ReturnType<typeof createReporter> }} ctx
   */
  async function assertRoomForPull({ request, imageRef, current, currentImage, fromVersion, reporter }) {
    if (!config.pullSpaceCheck || (await imageIsPresent(imageRef))) return;
    const hint = downloadHint(request.downloadBytes);
    const need = pullSpaceNeeded({
      downloadBytes: hint,
      imageBytes: downloadHint(request.imageBytes),
      installedBytes: currentImage.Size,
      marginBytes: config.pullSpaceMarginBytes,
    });
    let free = await freeBytes(config.pullSpaceProbeDir);
    if (free >= need.total) return;
    if (config.pruneImages) {
      const note = await pruneImages([
        { repository: config.image, runningVersion: fromVersion, protectedIds: [current.Image], rollbackImageId: null },
        { repository: config.updaterImage, runningVersion: config.updaterVersion, protectedIds: [], rollbackImageId: null },
      ]);
      if (note) await reporter.note(`Low on space before the pull.${note}`);
      free = await freeBytes(config.pullSpaceProbeDir);
      if (free >= need.total) return;
    }
    throw new Error(
      `Not enough free space for the image pull: ${formatBytes(free)} free on the filesystem of ${config.pullSpaceProbeDir} ` +
        `(Docker's data root), ${formatBytes(need.total)} needed for ${imageRef} (${formatBytes(need.download)} ` +
        `${hint === null ? "estimated download" : "download"}, ${formatBytes(need.unpacked)} unpacked, ${formatBytes(need.margin)} margin). ` +
        "Free up space (for example remove unused images with `docker image prune`) and schedule the update again, " +
        "or adjust PULL_SPACE_MARGIN_MB. Nothing was changed.",
    );
  }

  /** @param {string} imageRef */
  async function imageIsPresent(imageRef) {
    try {
      await docker.inspectImage(imageRef);
      return true;
    } catch (error) {
      if (/** @type {{ status?: number }} */ (error).status === 404) return false;
      throw error;
    }
  }

  /**
   * @param {string | null} protectedPath the backup of this update, which is never pruned
   * @returns {Promise<string>} a note for the status when pruning failed
   */
  async function pruneOldBackups(protectedPath) {
    try {
      await pruneBackups(config.backupDir, config.backupKeep, protectedPath);
      return "";
    } catch (error) {
      return ` Old backups could not be pruned (${messageOf(error)}).`;
    }
  }

  /** A missing cooldown only allows an earlier retry; it must not stop the update from ending. @param {string} version */
  async function startCooldown(version) {
    try {
      await ledger.startCooldown(version, config.retryCooldownMs);
    } catch (error) {
      log(`[updater] could not record the retry cooldown for ${version}: ${messageOf(error)}`);
    }
  }

  /** @returns {Promise<string>} where the journal is now, for the report; the report is written even if this fails */
  async function setJournalAsideNote() {
    try {
      const aside = await setJournalAside();
      return aside ? ` The update journal is kept at ${aside}.` : "";
    } catch (error) {
      return (
        ` The update journal could not be set aside (${messageOf(error)}) and is still at ${journalFile}: ` +
        "the updater replays it on every poll until it is moved away."
      );
    }
  }

  /** @returns {Promise<string | null>} where the journal now is, or null when there was none */
  async function setJournalAside() {
    const stamp = new Date(clock.now()).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const aside = join(config.backupDir, `.journal.manual-${stamp}.json`);
    try {
      await rename(journalFile, aside);
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return null;
      throw error;
    }
    await syncDirectory(config.backupDir);
    return aside;
  }

  /**
   * @param {Promise<Outcome>} work
   * @returns {Promise<Outcome>}
   */
  async function settle(work) {
    try {
      return await work;
    } catch (error) {
      return {
        state: "FAILED",
        message: messageOf(error),
        manual: error instanceof ManualActionRequired,
        pending: error instanceof WaitingForDocker,
      };
    }
  }

  /** @returns {Promise<Status | null>} status.json when it is a readable status, else null */
  async function readStatusOrNull() {
    try {
      return parseStatus(await readJsonFile(paths.status, MAX_STATUS_BYTES));
    } catch (error) {
      log(`[updater] ignoring status.json: ${messageOf(error)}`);
      return null;
    }
  }

  /** @param {Status} status */
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
        status.log = [...status.log, { at, state, message }].slice(-MAX_LOG_ENTRIES);
        Object.assign(status, { state, message, updatedAt: at });
        log(`[updater] ${state}: ${message}`);
        active = TERMINAL_STATES.has(state) ? null : { id: status.id, state };
        // Best effort: an unwritable status file (e.g. a swapped directory, a full disk) must not stop a
        // rollback. It is written again on every poll, so the app still learns the outcome once it can be.
        try {
          await writeState(paths.status, status);
          // Any status that lands is newer than one that did not, which must not overwrite it later.
          unwrittenStatus = null;
        } catch (error) {
          unwrittenStatus = status;
          log(`[updater] could not write status.json (retried on every poll): ${messageOf(error)}`);
        }
      },
      /** Log a step without changing the state. @param {string} message */
      note(message) {
        return this.report(status.state, message);
      },
    };
  }

  /**
   * @param {any} request
   * @param {{ reporter: ReturnType<typeof createReporter>, journal: Journal | null }} run
   * @returns {Promise<Outcome>}
   */
  async function performUpdate(request, run) {
    const { reporter } = run;
    const targetVersion = validateRequest(request);
    await assertNoJournal();
    await assertNotCoolingDown(targetVersion);
    const imageRef = `${config.image}:${targetVersion}`;

    const current = await findManagedContainer(docker, config.containerName);
    const name = containerNameOf(current);
    const fromVersion = installedVersionOf(current);
    reporter.setFromVersion(fromVersion);
    assertUpgrade(fromVersion, targetVersion);
    const backupMode = backupModeFor(current);
    if (backupMode === "file") await findBackupSources(config.dbFile);
    assertBindMountsAllowed(current);
    const preName = `${name}-pre-${(fromVersion ?? "unknown").replace(/[^0-9A-Za-z.-]/g, "_")}`;
    await assertNameFree(preName);
    const currentImage = await docker.inspectImage(current.Image);
    await assertRoomForPull({ request, imageRef, current, currentImage, fromVersion, reporter });

    const image = await pullAndPin(imageRef, targetVersion, reporter);
    await assertRequestStillCurrent(request);
    if (backupMode === "file") await assertFreeSpace({ dbFile: config.dbFile, backupDir: config.backupDir, freeBytes });
    const latest = await assertUnchangedSincePull(current);

    const journal = journalFor({
      requestId: request.id,
      targetVersion,
      fromVersion,
      name,
      preName,
      oldId: current.Id,
      newId: null,
      newImageId: image.Id,
      oldImageId: current.Image,
      restartPolicy: latest.HostConfig?.RestartPolicy ?? null,
      backup: null,
      step: "STOPPING",
    });
    await journal.save({});
    run.journal = journal;
    await reporter.report("BACKING_UP", `Stopping ${name} and backing up the database`);
    await stopAndBackUp({ current: latest, backupMode, journal, reporter });

    return switchOver({ current: latest, currentImage, image, imageRef, journal, reporter });
  }

  /**
   * The pull can take many minutes; an operator may have recreated the container
   * meanwhile. Everything after this point works on the container as it is now.
   *
   * @param {any} current the container as inspected before the pull
   * @returns {Promise<any>} the same container, inspected again
   */
  async function assertUnchangedSincePull(current) {
    const name = containerNameOf(current);
    const latest = await inspectOrNull(name);
    if (latest?.Id !== current.Id) {
      throw new Error(
        `${name} was ${latest ? `replaced by container ${shortId(latest.Id)}` : "removed"} while the image was pulling. Nothing was changed.`,
      );
    }
    return latest;
  }

  /**
   * The socket proxy refuses host bind mounts outside its `-allowbindmountfrom`
   * when the new container is created; finding that out after the old container
   * stopped would mean downtime and a rollback.
   *
   * @param {any} container
   */
  function assertBindMountsAllowed(container) {
    const sources = [
      ...(container.HostConfig?.Binds ?? []).map((/** @type {string} */ bind) => bind.split(":")[0]).filter((source) => source.startsWith("/")),
      ...(container.HostConfig?.Mounts ?? []).filter((/** @type {any} */ mount) => mount.Type === "bind").map((/** @type {any} */ mount) => String(mount.Source)),
    ].map((source) => posix.normalize(source));
    const refused = sources.filter(
      (source) => !config.allowedBindSources.some((dir) => dir === "/" || source === dir || source.startsWith(`${dir}/`)),
    );
    if (refused.length > 0) {
      throw new Error(
        `${containerNameOf(container)} bind-mounts host paths (${refused.join(", ")}), which the socket proxy refuses for the new ` +
          "container. Use named volumes, or list the directories in the proxy's -allowbindmountfrom and the updater's " +
          "ALLOW_BIND_MOUNTS_FROM. Nothing was changed.",
      );
    }
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
    if (targetVersion.includes("-") && !config.allowPrerelease) {
      throw new Error(`Rejected: ${targetVersion} is a prerelease. Set ALLOW_PRERELEASE=true on the updater to install prereleases.`);
    }
    const age = clock.now() - Date.parse(request.requestedAt);
    if (Number.isNaN(age)) throw new Error("Rejected: requestedAt is missing or not a date");
    if (age > config.requestMaxAgeMs) {
      throw new Error(`Rejected: the request is ${Math.round(age / 1000)}s old (limit REQUEST_MAX_AGE_SECONDS=${config.requestMaxAgeMs / 1000})`);
    }
    if (age < -FUTURE_SKEW_MS) throw new Error("Rejected: requestedAt lies in the future");
    return targetVersion;
  }

  /** A journal left from an earlier update (live or set aside) means someone has to look first. */
  async function assertNoJournal() {
    const leftover = (await readdir(config.backupDir)).find((entry) => JOURNAL_NAMES.test(entry));
    if (leftover) {
      throw new Error(
        `An earlier update needs manual attention (${join(config.backupDir, leftover)}). Check the containers, ` +
          "then delete that file to allow updates again. Nothing was changed.",
      );
    }
  }

  /** @param {string} targetVersion */
  async function assertNotCoolingDown(targetVersion) {
    const until = await ledger.cooldownUntil(targetVersion);
    if (until !== null) {
      throw new Error(
        `Rejected: an update to ${targetVersion} failed recently; it can be retried after ${new Date(until).toISOString()} ` +
          "(RETRY_COOLDOWN_SECONDS). Nothing was changed.",
      );
    }
  }

  /**
   * Only upgrades are allowed unless ALLOW_DOWNGRADE=true, and an installed
   * version that cannot be determined counts as "maybe newer".
   *
   * @param {string | null} installed
   * @param {string} target
   */
  function assertUpgrade(installed, target) {
    if (config.allowDowngrade) return;
    const order = installed ? compareVersions(target, installed) : null;
    if (order === null) {
      throw new Error(
        `Refusing to install ${target}: the installed version is unknown (${installed ?? "no version label"}), so it cannot be ` +
          "checked that the target is newer. Set ALLOW_DOWNGRADE=true on the updater to update anyway. Nothing was changed.",
      );
    }
    if (order <= 0) {
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
   * The image must say it is the requested release.
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
    const labelled = image.Config?.Labels?.[VERSION_LABEL];
    if (labelled !== targetVersion) {
      throw new Error(
        `Refusing ${imageRef}: its ${VERSION_LABEL} label is ${labelled ? `"${labelled}"` : "missing"}, not ${targetVersion}. Nothing was changed.`,
      );
    }
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

  /**
   * The in-memory copy changes only once the journal is on disk, so a failed
   * write never makes the flow believe it is further along than the journal says.
   *
   * @param {JournalData} initial
   * @returns {Journal}
   */
  function journalFor(initial) {
    const data = { ...initial };
    return {
      data,
      async save(changes) {
        await writeJsonAtomic(journalFile, { ...data, ...changes }, [config.backupDir]);
        Object.assign(data, changes);
      },
    };
  }

  /**
   * @param {{ current: any, backupMode: "file" | "none", journal: Journal, reporter: ReturnType<typeof createReporter> }} ctx
   */
  async function stopAndBackUp({ current, backupMode, journal, reporter }) {
    try {
      await suspendRestartPolicy(journal.data);
      await docker.stopContainer(current.Id, config.stopTimeoutSec);
      /** @type {import("./backup.mjs").Backup | null} */
      let backup = null;
      if (backupMode === "file") {
        backup = await createBackup({ dbFile: config.dbFile, backupDir: config.backupDir, fromVersion: journal.data.fromVersion, at: new Date(clock.now()) });
        await reporter.note(`Database backed up to ${backup.path}`);
      } else {
        await reporter.note("No database backup (ALLOW_UPDATE_WITHOUT_BACKUP=true, database is not a SQLite file)");
      }
      await journal.save({ step: "BACKED_UP", backup });
    } catch (error) {
      if (await isGone(journal.data.oldId)) {
        throw new Error(`${journal.data.name} disappeared before the update could stop it (${messageOf(error)}). Nothing was changed.`);
      }
      await restartAfterAbortedBackup(journal.data, error, reporter);
      throw error;
    }
  }

  /**
   * @param {string} id
   * @returns {Promise<boolean>} true only when Docker says the container does not exist;
   *   when Docker cannot tell, the caller must assume it is still there
   */
  async function isGone(id) {
    return inspectOrNull(id).then(
      (container) => container === null,
      () => false,
    );
  }

  /**
   * A restart policy of `always` would let Docker start the old container again
   * (after a daemon restart) while the new one runs on the same database, so the
   * old container runs without one for the duration of the update.
   *
   * @param {JournalData} data
   */
  async function suspendRestartPolicy(data) {
    if (!hasRestartPolicy(data.restartPolicy)) return;
    await docker.updateContainer(data.oldId, { RestartPolicy: { Name: "no" } });
  }

  /**
   * @param {JournalData} data
   * @returns {Promise<string | null>} a note for the operator when the policy could not be put back
   */
  async function reinstateRestartPolicy(data) {
    if (!hasRestartPolicy(data.restartPolicy)) return null;
    try {
      await docker.updateContainer(data.oldId, { RestartPolicy: data.restartPolicy });
      return null;
    } catch (error) {
      return `The restart policy of ${data.name} could not be restored (${messageOf(error)}); run \`${restartCommand(data)}\`.`;
    }
  }

  /**
   * @param {JournalData} data
   * @param {unknown} cause
   * @param {ReturnType<typeof createReporter>} reporter
   */
  async function restartAfterAbortedBackup(data, cause, reporter) {
    try {
      const policyNote = await reinstateRestartPolicy(data);
      if (policyNote) await reporter.note(policyNote);
      await docker.startContainer(data.oldId);
    } catch (restartError) {
      throw new ManualActionRequired(
        `ROLLBACK FAILED — manual action required: the update was aborted (${messageOf(cause)}) and ` +
          `${data.name} could not be restarted (${messageOf(restartError)}).${restartPolicyHint(data)}`,
      );
    }
  }

  /**
   * @param {{ current: any, currentImage: any, image: any, imageRef: string, journal: Journal,
   *   reporter: ReturnType<typeof createReporter> }} ctx
   * @returns {Promise<Outcome>}
   */
  async function switchOver({ current, currentImage, image, imageRef, journal, reporter }) {
    const { name, preName, requestId } = journal.data;
    try {
      await journal.save({ step: "SWITCHING" });
      await reporter.report("SWITCHING", `Renaming ${name} to ${preName} and creating a new ${name} from ${imageRef} (${image.Id})`);
      await docker.renameContainer(current.Id, preName);
      // By tag, so `docker ps`, compose and monitoring show the release; the check below
      // keeps the guarantee that the pulled image (by id) is what runs.
      const { body, extraNetworks } = buildCreateSpec(current, currentImage, imageRef);
      body.Labels = { ...body.Labels, [UPDATE_REQUEST_LABEL]: requestId };
      const created = await docker.createContainer(name, body);
      await journal.save({ newId: created.Id });
      await assertCreatedFromPulledImage(created.Id, imageRef, image.Id);
      for (const network of extraNetworks) await docker.connectNetwork(network.name, created.Id, network.endpointConfig);
      await docker.startContainer(created.Id);
      await journal.save({ step: "STARTED" });

      await reporter.report("HEALTH_CHECK", `Waiting for ${name} (${imageRef}) to become healthy`);
      const served = await waitUntilHealthy(created.Id, name);
      await soakNewContainer(journal.data, served);
      await journal.save({ step: "SWITCHED", served });
    } catch (error) {
      return rollBack(journal, messageOf(error), reporter);
    }
    return completeSwitch(journal.data);
  }

  /**
   * The tag could have been moved (a pull by someone else) between our pull and the
   * create; the new container must run exactly the image that was pulled and checked.
   *
   * @param {string} id
   * @param {string} imageRef
   * @param {string} imageId
   */
  async function assertCreatedFromPulledImage(id, imageRef, imageId) {
    const created = await docker.inspectContainer(id);
    if (created.Image !== imageId) {
      throw new Error(
        `${imageRef} pointed at image ${shortId(String(created.Image))} instead of the pulled ${shortId(imageId)} when the container was created`,
      );
    }
  }

  /**
   * The new container must keep serving for a few more health polls, as the same
   * instance: one that crashed right after its health check (and was restarted by
   * its restart policy) is a failed update, rolled back with the database.
   *
   * @param {JournalData} data
   * @param {ServingInstance} served
   */
  async function soakNewContainer(data, served) {
    for (let poll = 0; poll < SOAK_POLLS; poll += 1) {
      await clock.sleep(config.healthIntervalMs);
      const occupant = await inspectOrNull(data.name);
      if (occupant?.Id !== data.newId) throw new Error(`${data.name} was replaced right after becoming healthy`);
      const problem = servingProblem(occupant, served);
      if (problem) throw new Error(`${data.name} ${problem} right after becoming healthy`);
    }
  }

  /**
   * The new container is healthy: remove the old one.
   *
   * @param {JournalData} data
   * @returns {Promise<Outcome>}
   */
  async function completeSwitch(data) {
    const { oldId, preName, fromVersion, targetVersion, backup } = data;
    await assertSwitchStillInPlace(data);
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
    if (backup) notes.push(`Database backup: ${backup.path}.`);
    return { state: "SUCCEEDED", message: `Updated from ${fromVersion ?? "unknown"} to ${targetVersion}. ${notes.join(" ")}` };
  }

  /**
   * Undoes a failed or interrupted switch: replacement container out, database
   * back (unless an earlier attempt already restored it), old container renamed,
   * its restart policy restored, started. Every step is idempotent, so a recovery
   * can repeat it after a crash at any point, and Docker calls are retried while
   * Docker does not answer, so a restarting proxy does not leave the app down.
   *
   * @param {Journal} journal
   * @param {string} reason
   * @param {ReturnType<typeof createReporter>} reporter
   * @returns {Promise<Outcome>}
   */
  async function rollBack(journal, reason, reporter) {
    const { oldId, name, preName, backup, fromVersion, targetVersion, step } = journal.data;
    const notes = [];
    try {
      await reporter.note(`Update failed (${reason}); rolling back`);
      await docker.ping();
      await assertRollbackStillPossible(journal.data);
      await removeReplacement(journal.data);
      if (RESTORE_STEPS.has(step)) {
        if (backup) await restoreBackup(config.dbFile, backup);
        await journal.save({ step: "RESTORED" });
      }
      await renameBack(oldId, name);
      const policyNote = await reinstateRestartPolicy(journal.data);
      if (policyNote) notes.push(policyNote);
      await docker.startContainer(oldId);
      await waitUntilHealthy(oldId, name);
    } catch (rollbackError) {
      if (rollbackError instanceof ManualActionRequired) throw rollbackError;
      if (isTransientDockerError(rollbackError)) {
        throw new WaitingForDocker(
          `Docker did not answer while rolling back (${messageOf(rollbackError)}). Original failure: ${reason}. ` +
            "The rollback is retried from the journal until Docker answers; updates stay blocked until then.",
        );
      }
      throw new ManualActionRequired(
        `ROLLBACK FAILED — manual action required: ${messageOf(rollbackError)}. Original failure: ${reason}. ` +
          `Previous container: ${preName} (or ${name}). Database backup: ${backup?.path ?? "none"}.${restartPolicyHint(journal.data)}`,
      );
    }
    if (PRE_SWITCH_STEPS.has(step)) {
      return {
        state: "FAILED",
        message: `Update to ${targetVersion} aborted (${reason}). The previous container was started again; nothing was changed. ${notes.join(" ")}`.trim(),
      };
    }
    const restoredNote = backup ? "database restored from backup, " : "";
    return {
      state: "ROLLED_BACK",
      message: `Update to ${targetVersion} failed (${reason}). Rolled back to ${fromVersion ?? "the previous version"}: ${restoredNote}previous container is running again. ${notes.join(" ")}`.trim(),
    };
  }

  /**
   * Docker must still look like this update left it; otherwise an operator (or
   * something else) changed it and nothing may be removed or restored.
   *
   * @param {JournalData} data
   */
  async function assertRollbackStillPossible(data) {
    const old = await inspectOrNull(data.oldId);
    if (!old) throw worldChanged(data, `the previous container ${shortId(data.oldId)} no longer exists`);
    const occupant = await inspectOrNull(data.name);
    if (occupant && occupant.Id !== data.oldId && !isOurReplacement(occupant, data)) {
      throw worldChanged(data, `${data.name} is now container ${shortId(occupant.Id)}, which this update did not create`);
    }
    if (old.State?.Running && RESTORE_STEPS.has(data.step)) {
      throw worldChanged(data, `the previous container ${containerNameOf(old)} is running although the update had stopped it`);
    }
  }

  /**
   * Gives the old container its name back. Checked and repeated as one step: a
   * rename whose answer was lost would otherwise fail when retried.
   *
   * @param {string} oldId
   * @param {string} name
   */
  async function renameBack(oldId, name) {
    await retryWhileUnreachable(async () => {
      if (containerNameOf(await docker.inspectContainer(oldId)) !== name) await docker.renameContainer(oldId, name);
    }, retryOptions);
  }

  /**
   * The old container is about to be removed: only if the new one still serves,
   * as the instance that passed the health check. Without an answer from Docker
   * nothing is removed and the journal stays.
   *
   * @param {JournalData} data
   */
  async function assertSwitchStillInPlace(data) {
    let occupant;
    let old;
    try {
      occupant = await inspectOrNull(data.name);
      old = await inspectOrNull(data.oldId);
    } catch (error) {
      if (!isTransientDockerError(error)) throw worldChanged(data, `the containers could not be inspected (${messageOf(error)})`);
      throw new WaitingForDocker(
        `Docker did not answer while finishing the switch (${messageOf(error)}). It is retried from the journal until Docker answers.`,
      );
    }
    if (occupant?.Id !== data.newId) {
      throw worldChanged(data, `${data.name} is no longer the container ${shortId(data.newId ?? "")} this update created`);
    }
    const problem = servingProblem(occupant, data.served ?? null);
    if (problem) throw worldChanged(data, `the new container ${data.name} ${problem} after the switch`);
    if (old?.State?.Running) throw worldChanged(data, `the previous container ${containerNameOf(old)} is running again`);
  }

  /**
   * @param {JournalData} data
   * @param {string} detail
   */
  function worldChanged(data, detail) {
    return new ManualActionRequired(
      `MANUAL ACTION REQUIRED — the containers no longer match the update journal: ${detail}. ` +
        "The updater left them alone. Fix them by hand, then delete the set-aside journal to allow updates again. " +
        `Database backup: ${data.backup?.path ?? "none"}.${restartPolicyHint(data)}`,
    );
  }

  /**
   * Removes the replacement this update created: the one the journal recorded
   * and, if the updater died before recording it, the one holding the managed
   * name that carries this request's label and image.
   *
   * @param {JournalData} data
   */
  async function removeReplacement(data) {
    const occupant = await inspectOrNull(data.name);
    const unrecorded = occupant && occupant.Id !== data.oldId && isOurReplacement(occupant, data) ? occupant.Id : null;
    const ids = new Set([data.newId, unrecorded].filter((id) => id && id !== data.oldId));
    for (const id of ids) {
      await ignoreNotFound(docker.stopContainer(/** @type {string} */ (id), ROLLBACK_STOP_TIMEOUT_SEC));
      await ignoreNotFound(docker.removeContainer(/** @type {string} */ (id), { force: true }));
    }
  }

  /** @param {JournalData} data */
  async function recoverFromJournal(data) {
    active = { id: data.requestId, state: "SWITCHING" };
    const status = await readStatusOrNull();
    const ours = status?.id === data.requestId ? status : null;
    const reporter = createReporter({
      ...newStatus(data.requestId, data.targetVersion, data.fromVersion, ours?.log ?? []),
      // A resumed rollback keeps showing the step it was in until it ends.
      ...(ours && !TERMINAL_STATES.has(ours.state) ? { state: ours.state } : {}),
    });
    const reason = `updater restarted during step ${data.step}`;
    const journal = journalFor(data);
    const outcome = await settle(data.step === "SWITCHED" ? completeSwitch(data) : rollBack(journal, reason, reporter));
    const prefix = outcome.manual ? `After an updater restart (${reason}): ` : "Recovered after an updater restart. ";
    await finish({ ...outcome, message: prefix + outcome.message }, reporter, journal);
  }

  /**
   * Polls until the container reports healthy. Fails when it exits, restarts,
   * turns unhealthy, or is not healthy in time. A container without a
   * HEALTHCHECK counts as healthy once it has stayed running for `noHealthcheckSettleMs`.
   *
   * @param {string} id
   * @param {string} label
   * @returns {Promise<ServingInstance>} the instance that passed
   */
  async function waitUntilHealthy(id, label) {
    const deadline = clock.now() + config.healthTimeoutMs;
    /** @type {number | null} */
    let runningSince = null;
    for (;;) {
      const container = await docker.inspectContainer(id);
      const { State: state } = container;
      if (!state.Running || state.Restarting) {
        throw new Error(`${label} stopped or restarted (exit code ${state.ExitCode}) before becoming healthy`);
      }
      const served = { startedAt: state.StartedAt, restartCount: container.RestartCount };
      if (state.Health) {
        if (state.Health.Status === "healthy") return served;
        if (state.Health.Status === "unhealthy") throw new Error(`${label} reported unhealthy`);
      } else {
        runningSince ??= clock.now();
        if (clock.now() - runningSince >= config.noHealthcheckSettleMs) return served;
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

  /** @returns {ActiveRequest | null} the request being worked on (including a rollback waiting for Docker) */
  const activeRequest = () => (active ? { ...active } : null);

  return { processPendingRequest, recoverInterrupted, activeRequest };
}

/**
 * @param {string} id
 * @param {string} targetVersion
 * @param {string | null} fromVersion
 * @param {LogEntry[]} [log]
 * @returns {Status}
 */
function newStatus(id, targetVersion, fromVersion, log = []) {
  return { id, state: "PENDING", fromVersion, targetVersion, message: "", updatedAt: "", log };
}

/**
 * Keeps only the documented fields of an attacker-writable status.json.
 *
 * @param {any} raw
 * @returns {Status | null}
 */
function parseStatus(raw) {
  if (typeof raw?.id !== "string" || !REQUEST_ID.test(raw.id) || !UPDATER_STATES.has(raw.state)) return null;
  const text = (/** @type {unknown} */ value) => (typeof value === "string" ? value.slice(0, MAX_VERSION_LENGTH) : null);
  const log = Array.isArray(raw.log)
    ? raw.log
        .filter((/** @type {any} */ entry) => typeof entry?.at === "string" && UPDATER_STATES.has(entry.state) && typeof entry.message === "string")
        .map((/** @type {any} */ entry) => ({ at: entry.at, state: entry.state, message: entry.message }))
        .slice(-MAX_LOG_ENTRIES)
    : [];
  return { ...newStatus(raw.id, text(raw.targetVersion) ?? "unknown", text(raw.fromVersion), log), state: raw.state };
}

/**
 * @param {any} container inspected
 * @param {ServingInstance | null} served the instance that passed the health check, if known
 * @returns {string | null} why the container is not (or no longer) that healthy instance
 */
function servingProblem(container, served) {
  const state = container.State ?? {};
  if (state.Restarting) return "is restarting";
  if (!state.Running) return `stopped (exit code ${state.ExitCode})`;
  if (served && (container.RestartCount !== served.restartCount || state.StartedAt !== served.startedAt)) return "was restarted";
  if (state.Health && state.Health.Status !== "healthy") return `is ${state.Health.Status}`;
  return null;
}

/** @param {any} value @returns {value is JournalData} */
function isJournal(value) {
  const strings = ["requestId", "targetVersion", "oldId", "name", "preName", "newImageId"];
  const optionalString = (/** @type {unknown} */ field) => field === null || typeof field === "string";
  const backup = value?.backup;
  return (
    strings.every((key) => typeof value?.[key] === "string") &&
    JOURNAL_STEPS.has(value.step) &&
    optionalString(value.newId) &&
    optionalString(value.fromVersion) &&
    (value.oldImageId === undefined || typeof value.oldImageId === "string") &&
    (value.restartPolicy === null || typeof value.restartPolicy?.Name === "string") &&
    (value.served === undefined || (typeof value.served?.startedAt === "string" && Number.isInteger(value.served.restartCount))) &&
    (backup === null || (typeof backup?.path === "string" && Array.isArray(backup.sidecars) && backup.sidecars.every((/** @type {unknown} */ s) => typeof s === "string")))
  );
}

/**
 * Only a container this request created may be removed: the label alone could
 * be copied by hand, so the image must match too.
 *
 * @param {any} container
 * @param {JournalData} data
 */
function isOurReplacement(container, data) {
  if (container.Id === data.newId) return true;
  return container.Config?.Labels?.[UPDATE_REQUEST_LABEL] === data.requestId && container.Image === data.newImageId;
}

/** @param {RestartPolicy | null} policy */
function hasRestartPolicy(policy) {
  return Boolean(policy?.Name) && policy?.Name !== "no";
}

/** @param {JournalData} data the command that gives the old container its restart policy back */
function restartCommand(data) {
  const { Name, MaximumRetryCount } = /** @type {RestartPolicy} */ (data.restartPolicy);
  return `docker update --restart ${Name}${MaximumRetryCount ? `:${MaximumRetryCount}` : ""} ${shortId(data.oldId)}`;
}

/**
 * The update set the old container's restart policy to "no"; an operator taking
 * over must know to put it back.
 *
 * @param {JournalData} data
 */
function restartPolicyHint(data) {
  if (!hasRestartPolicy(data.restartPolicy)) return "";
  return ` The previous container may still have restart policy "no": once it is the one you keep, run \`${restartCommand(data)}\`.`;
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
