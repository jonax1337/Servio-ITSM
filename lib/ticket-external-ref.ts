import { z } from "zod";

/**
 * External references on tickets: the key a monitoring integration (Zabbix,
 * Wazuh, …) sends with every alert so repeated alerts land in ONE open ticket.
 *
 * Two columns carry it (prisma/schema.prisma):
 * - `externalRef` — set at creation and kept for good (history, lookup).
 * - `openExternalRef` — the same value while the ticket is open, `null` once it
 *   reaches a terminal status. It is `@unique`, which gives "unique among OPEN
 *   tickets" without a partial index (Prisma can't express one, and the CI
 *   migration-drift check would flag a hand-written one).
 *
 * The release on a terminal status is applied centrally by the Prisma client
 * extension in lib/db.ts ({@link releaseExternalRef}), so every write path —
 * console actions, API PATCH, automations, macros, merges, approvals — frees
 * the key without having to remember it. A reopened ticket does NOT reclaim its
 * key: by then a newer alert may own it, and a human reopening a resolved alert
 * ticket is a different occurrence from the monitor's point of view.
 *
 * Pure module: no database access, so lib/db.ts can import it and it is unit-tested directly.
 */

/** Same charset as the asset origin reference: no "/", so it is safe as one URL path segment. */
export const EXTERNAL_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,199}$/;
export const EXTERNAL_REF_HINT = "1-200 characters: letters, digits and . _ : @ -, starting with a letter or digit";

export const externalRefSchema = z.string().regex(EXTERNAL_REF_RE, EXTERNAL_REF_HINT);

/** A route segment as an external reference, or null when it isn't a valid one (callers answer 404/422). */
export function parseExternalRef(raw: string): string | null {
  let ref: string;
  try {
    ref = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return EXTERNAL_REF_RE.test(ref) ? ref : null;
}

/**
 * Statuses that keep the key claimed. Mirrors OPEN_TICKET_STATUSES in
 * lib/constants.ts (a unit test pins the two together); duplicated so lib/db.ts
 * doesn't pull the icon-laden constants module into every server bundle.
 */
export const EXTERNAL_REF_OPEN_STATUSES: readonly string[] = ["NEW", "OPEN", "IN_PROGRESS", "PENDING", "ON_HOLD"];

export function holdsExternalRef(status: string): boolean {
  return EXTERNAL_REF_OPEN_STATUSES.includes(status);
}

/** The status a Prisma write sets: a plain string or `{ set: "…" }`; undefined when the write leaves it alone. */
function writtenStatus(data: Record<string, unknown>): string | undefined {
  const s = data.status;
  if (typeof s === "string") return s;
  if (s && typeof s === "object" && typeof (s as { set?: unknown }).set === "string") return (s as { set: string }).set;
  return undefined;
}

/**
 * The write data with `openExternalRef: null` added when it moves the ticket into
 * a terminal status (RESOLVED, CLOSED, CANCELLED — anything not open). Data that
 * doesn't touch `status`, or moves to an open one, comes back unchanged (same object).
 */
export function releaseExternalRef<T>(data: T): T {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const status = writtenStatus(data as Record<string, unknown>);
  if (status === undefined || holdsExternalRef(status)) return data;
  return { ...data, openExternalRef: null };
}

/** {@link releaseExternalRef} for `create`/`createMany` data, which may be one record or a list. */
export function releaseExternalRefMany<T>(data: T): T {
  return (Array.isArray(data) ? data.map((d) => releaseExternalRef(d)) : releaseExternalRef(data)) as T;
}

/** Whether a Prisma unique violation (P2002) is the one on `openExternalRef`. */
export function isOpenExternalRefConflict(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; meta?: { target?: unknown } };
  if (e.code !== "P2002") return false;
  const target = e.meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : [String(target ?? "")];
  return fields.some((f) => f === "openExternalRef" || f.includes("openExternalRef"));
}
