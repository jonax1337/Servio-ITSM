import { cache } from "react";
import { db } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { parseSelfApprovalMode, type ChangeSelfApprovalMode } from "@/lib/approval-rules";
import { TICKET_AUTO_CLOSE_DAYS_SETTING, normalizeAutoCloseDays } from "@/lib/auto-close-rules";

/**
 * Central runtime-config service. Precedence for every key:
 *
 *   DB AppSetting row  →  process.env  →  caller fallback
 *
 * So an empty AppSetting table means everything falls back to `.env` (nothing
 * breaks), and an admin override in the DB wins once set. Secret rows are stored
 * encrypted and decrypted on read; a decrypt failure falls back to env so a lost
 * or rotated key never takes mail/AI offline.
 *
 * loadAll is React-cached, so all reads within one request hit the DB at most
 * once. Note: this is per-request only — a multi-instance deployment sees a
 * change on each process's next request, which is fine for a single server.
 *
 * Server-only — never import from a "use client" module (pulls in Prisma).
 */

type Row = { value: string; encrypted: boolean };

const loadAll = cache(async (): Promise<Record<string, Row>> => {
  try {
    const rows = await db.appSetting.findMany();
    return Object.fromEntries(
      rows.map((r) => [r.key, { value: r.value, encrypted: r.encrypted }]),
    );
  } catch {
    // DB unreachable / table missing (e.g. pre-migration) → pure env fallback.
    return {};
  }
});

export async function getSetting(
  key: string,
  fallback?: string,
): Promise<string | null> {
  const all = await loadAll();
  const row = all[key];
  if (row !== undefined) {
    if (row.encrypted) {
      const dec = decryptSecret(row.value);
      if (dec !== null && dec !== "") return dec;
      // decrypt failed → fall through to env
    } else if (row.value !== "") {
      return row.value;
    }
  }
  const env = process.env[key];
  if (env !== undefined && env !== "") return env;
  return fallback ?? null;
}

export async function getBoolSetting(key: string, fallback = false): Promise<boolean> {
  const v = await getSetting(key);
  if (v === null) return fallback;
  return v === "true" || v === "1" || v === "on" || v === "yes";
}

export async function getNumberSetting(key: string, fallback: number): Promise<number> {
  const v = await getSetting(key);
  if (v === null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Per-file upload cap in MB (Admin Settings › Uploads, env `MAX_UPLOAD_MB` fallback). */
export async function getMaxUploadMb(): Promise<number> {
  return getNumberSetting("MAX_UPLOAD_MB", 15);
}

export const CHANGE_SELF_APPROVAL_SETTING = "CHANGE_SELF_APPROVAL";

/** Whether (and when) a change's requester or owner may approve it (Settings › Change management; default OFF). */
export async function getChangeSelfApprovalMode(): Promise<ChangeSelfApprovalMode> {
  return parseSelfApprovalMode(await getSetting(CHANGE_SELF_APPROVAL_SETTING));
}

/** Days a ticket stays RESOLVED before it is closed automatically (Settings › Tickets; 0 = off, the default). */
export async function getTicketAutoCloseDays(): Promise<number> {
  return normalizeAutoCloseDays(await getNumberSetting(TICKET_AUTO_CLOSE_DAYS_SETTING, 0));
}

/**
 * True when a value exists (DB override or env) and is non-empty. Used to show a
 * "configured" state for secret fields WITHOUT ever returning the secret itself.
 * An encrypted row that can no longer be DECRYPTED (e.g. after a key rotation)
 * does not count as set — the override is dead and silently falls back to env,
 * so the UI must not claim the secret is configured.
 */
export async function settingIsSet(key: string): Promise<boolean> {
  const all = await loadAll();
  const row = all[key];
  if (row && row.value !== "") {
    if (row.encrypted) return decryptSecret(row.value) !== null;
    return true;
  }
  const env = process.env[key];
  return env !== undefined && env !== "";
}

export async function setSetting(
  key: string,
  value: string,
  opts?: { encrypted?: boolean; userId?: string },
): Promise<void> {
  const encrypted = opts?.encrypted ?? false;
  const trimmed = value ?? "";
  if (trimmed === "") {
    // Empty → drop the override so the key falls back to env/default.
    await db.appSetting.deleteMany({ where: { key } });
    return;
  }
  const stored = encrypted ? encryptSecret(trimmed) : trimmed;
  await db.appSetting.upsert({
    where: { key },
    create: { key, value: stored, encrypted, updatedById: opts?.userId ?? null },
    update: { value: stored, encrypted, updatedById: opts?.userId ?? null },
  });
}
