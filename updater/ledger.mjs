// What the updater has already done, kept on the updater-only backup volume.
// status.json is writable by the app (and so by an attacker in it), so it can
// neither be what stops a handled request from running again nor what limits
// how often a failing update may take the app down.
import { join } from "node:path";
import { MAX_SMALL_JSON_BYTES, readJsonFile, writeJsonAtomic } from "./state-files.mjs";

const LEDGER_FILE = ".ledger.json";
/** Request ids are window ids; remembering the last few hundred covers any realistic backlog. */
const MAX_HANDLED_IDS = 200;

/**
 * @typedef {{ handled: string[], cooldowns: Array<{ version: string, until: number }> }} LedgerData
 */

/**
 * @param {{ backupDir: string, now: () => number }} options
 */
export function createLedger({ backupDir, now }) {
  const file = join(backupDir, LEDGER_FILE);

  /** @returns {Promise<LedgerData>} */
  async function read() {
    return parseLedger(await readJsonFile(file, MAX_SMALL_JSON_BYTES));
  }

  /** @param {LedgerData} data */
  function write(data) {
    return writeJsonAtomic(file, data, [backupDir]);
  }

  return {
    /** @param {string} id */
    async hasHandled(id) {
      return (await read()).handled.includes(id);
    },

    /**
     * Records `id` before its update starts, so neither a restart nor a lost
     * status file can run it twice.
     *
     * @param {string} id
     */
    async markHandled(id) {
      const data = await read();
      await write({ ...data, handled: [...data.handled.filter((known) => known !== id), id].slice(-MAX_HANDLED_IDS) });
    },

    /**
     * @param {string} version
     * @returns {Promise<number | null>} epoch ms until which updates to `version` are refused, or null
     */
    async cooldownUntil(version) {
      const entry = (await read()).cooldowns.find((cooldown) => cooldown.version === version);
      return entry && entry.until > now() ? entry.until : null;
    },

    /**
     * @param {string} version
     * @param {number} durationMs
     */
    async startCooldown(version, durationMs) {
      const data = await read();
      const active = data.cooldowns.filter((cooldown) => cooldown.version !== version && cooldown.until > now());
      await write({ ...data, cooldowns: [...active, { version, until: now() + durationMs }] });
    },
  };
}

/**
 * @param {any} raw
 * @returns {LedgerData} an empty ledger for a missing or malformed file
 */
function parseLedger(raw) {
  const handled = Array.isArray(raw?.handled) ? raw.handled.filter((/** @type {unknown} */ id) => typeof id === "string") : [];
  const cooldowns = Array.isArray(raw?.cooldowns)
    ? raw.cooldowns.filter(
        (/** @type {any} */ entry) => typeof entry?.version === "string" && Number.isFinite(entry?.until),
      )
    : [];
  return { handled, cooldowns };
}
