import type { SyncSource } from "@prisma/client";
import { db } from "@/lib/db";
import { releaseOwnSecondary } from "@/lib/user-emails";
import { SyncLog } from "./types";

/**
 * The normalised shape every connector maps its source records onto. `undefined`
 * on an optional field means "leave the existing value untouched" (Prisma
 * ignores undefined on update); `null` means "clear it" (the source is
 * authoritative and returned it empty).
 */
export type ImportUser = {
  externalId: string;
  /**
   * Ids an earlier release stored for the same record (e.g. an objectGUID as raw
   * hex). A user still carrying one is matched by it and moved to `externalId`.
   */
  legacyExternalIds?: string[];
  email: string;
  name: string | null;
  jobTitle?: string | null;
  phone?: string | null;
  department?: string | null;
};

/**
 * The subset of `desired` that differs from `current`. `undefined` means "leave untouched"
 * and is never a change; `null` is a real value (clear it). Empty result = nothing to write.
 */
export function changedFields<T extends Record<string, unknown>>(
  current: Record<string, unknown>,
  desired: T,
): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(desired) as [keyof T & string, unknown][]) {
    if (value === undefined) continue;
    if (current[key] !== value) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/** A record that could not be mapped (missing required field, etc.). */
export type ImportError = { error: string; ref?: string };

export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** What the sync compares an owned account against (see changedFields). */
const OWNED_SELECT = {
  id: true,
  email: true,
  name: true,
  jobTitle: true,
  phone: true,
  department: true,
  isActive: true,
  syncSourceId: true,
  externalId: true,
} as const;

/**
 * Upsert a batch of users for a sync source and optionally deactivate the ones
 * that vanished. Shared by every user-import connector. Mutates `log` counters
 * and appends a final summary line.
 */
export async function importUsers(
  source: SyncSource,
  records: (ImportUser | ImportError)[],
  deactivateMissing: boolean,
  log: SyncLog,
): Promise<void> {
  const seen: string[] = [];
  // In-code de-dup: a source returning the same externalId twice would otherwise
  // race two upserts against the (syncSourceId, externalId) unique constraint.
  const seenExternalIds = new Set<string>();

  for (const rec of records) {
    if ("error" in rec) {
      log.failed++;
      log.line(`Skipped ${rec.ref ?? "record"}: ${rec.error}.`);
      continue;
    }
    if (seenExternalIds.has(rec.externalId)) {
      log.line(`Skipped ${rec.email}: duplicate externalId "${rec.externalId}" in this batch.`);
      continue;
    }
    seenExternalIds.add(rec.externalId);
    seen.push(rec.externalId);
    // A legacy id is "seen" too: deactivation must never hit a user whose move failed.
    const legacyIds = (rec.legacyExternalIds ?? []).filter((id) => id && id !== rec.externalId);
    seen.push(...legacyIds);

    const profile = {
      name: rec.name,
      jobTitle: rec.jobTitle,
      phone: rec.phone,
      department: rec.department,
    };

    try {
      // Prefer the identity this source already owns (unique key). Only fall back
      // to email adoption for a record we have never seen before.
      const current = await db.user.findUnique({
        where: { syncSourceId_externalId: { syncSourceId: source.id, externalId: rec.externalId } },
        select: OWNED_SELECT,
      });
      const legacy =
        !current && legacyIds.length > 0
          ? await db.user.findFirst({
              where: { syncSourceId: source.id, externalId: { in: legacyIds } },
              select: OWNED_SELECT,
            })
          : null;
      const owned = current ?? legacy;
      // An address is unique across primary AND secondary addresses: one that is
      // another person's secondary address is never taken over by the sync.
      const secondaryOwner = await db.userEmail.findUnique({ where: { email: rec.email }, select: { userId: true } });
      if (secondaryOwner && secondaryOwner.userId !== owned?.id) {
        log.failed++;
        log.line(`Skipped ${rec.email}: another person uses this address as a secondary address.`);
        continue;
      }

      if (owned) {
        // The source made one of this person's secondary addresses the primary one.
        if (secondaryOwner) await releaseOwnSecondary(owned.id, rec.email);
        // Write (and count) only real changes: a run over an unchanged directory
        // reports everything as unchanged instead of "updated" for every account.
        const changes = changedFields(owned, {
          ...profile,
          email: rec.email,
          isActive: true,
          syncSourceId: source.id,
          externalId: rec.externalId,
        });
        if (Object.keys(changes).length === 0) {
          log.unchanged++;
          continue;
        }
        await db.user.update({ where: { id: owned.id }, data: changes });
        if (legacy) log.line(`Moved ${rec.email} from external id "${legacy.externalId}" to "${rec.externalId}".`);
        log.updated++;
        continue;
      }

      // Adopt-by-email, but never take over a local or foreign-owned account.
      const byEmail = await db.user.findFirst({
        where: { email: rec.email },
        select: { id: true, passwordHash: true, role: true, syncSourceId: true },
      });

      if (byEmail) {
        if (
          byEmail.passwordHash != null ||
          byEmail.role !== "USER" ||
          (byEmail.syncSourceId != null && byEmail.syncSourceId !== source.id)
        ) {
          log.failed++;
          log.line(
            `Skipped ${rec.email}: an existing ${
              byEmail.passwordHash != null
                ? "password-protected"
                : byEmail.role !== "USER"
                  ? `privileged (${byEmail.role})`
                  : "foreign-synced"
            } account already owns this email — not adopting.`,
          );
          continue;
        }
        // Local, USER-role, unsynced (or already ours): safe to adopt. Do NOT
        // force isActive:true when adopting — respect the account's current state.
        await db.user.update({
          where: { id: byEmail.id },
          data: {
            ...profile,
            email: rec.email,
            syncSourceId: source.id,
            externalId: rec.externalId,
          },
        });
        log.updated++;
        continue;
      }

      await db.user.create({
        data: {
          email: rec.email,
          role: "USER",
          isActive: true,
          syncSourceId: source.id,
          externalId: rec.externalId,
          ...profile,
        },
      });
      log.created++;
    } catch (e) {
      log.failed++;
      log.line(`Failed ${rec.email}: ${errMessage(e)}`);
    }
  }

  if (deactivateMissing) {
    if (seen.length === 0) {
      log.line(
        "Skipped deactivation: the source returned no users (guarding against mass-deactivation from a misconfiguration).",
      );
    } else {
      // Only ever deactivate accounts THIS source owns (syncSourceId scopes the
      // updateMany), and never the last remaining active admin.
      const activeAdmins = await db.user.count({
        where: { role: "ADMIN", isActive: true },
      });
      const staleAdmins = await db.user.findMany({
        where: {
          syncSourceId: source.id,
          externalId: { notIn: seen },
          isActive: true,
          role: "ADMIN",
        },
        select: { id: true },
      });
      // If deactivating the stale synced admins would leave no active admin,
      // keep them and log the guard instead.
      const protectLastAdmin = staleAdmins.length > 0 && activeAdmins - staleAdmins.length < 1;

      const res = await db.user.updateMany({
        where: {
          syncSourceId: source.id,
          externalId: { notIn: seen },
          isActive: true,
          ...(protectLastAdmin ? { id: { notIn: staleAdmins.map((u) => u.id) } } : {}),
        },
        data: { isActive: false },
      });
      if (res.count)
        log.line(`Deactivated ${res.count} user(s) no longer present in the source.`);
      if (protectLastAdmin)
        log.line(
          `Kept ${staleAdmins.length} admin account(s) active: deactivating them would remove the last active administrator.`,
        );
    }
  }

  log.line(`Done: ${log.created} created, ${log.updated} updated, ${log.unchanged} unchanged, ${log.failed} failed.`);
}

/**
 * The normalised asset shape connectors map onto. `type`/`status` are never set
 * to null (they are non-null enum columns) — an empty mapping leaves them at the
 * DB default (create) or unchanged (update); other empty-but-mapped fields clear.
 */
export type ImportAsset = {
  externalId: string;
  name: string;
  assetTag?: string | null;
  serial?: string | null;
  model?: string | null;
  manufacturer?: string | null;
  type?: string;
  status?: string;
  ipAddress?: string | null;
  macAddress?: string | null;
  os?: string | null;
  location?: string | null;
};

const ASSET_SELECT = {
  id: true,
  name: true,
  assetTag: true,
  serial: true,
  model: true,
  manufacturer: true,
  ipAddress: true,
  macAddress: true,
  os: true,
  location: true,
  type: true,
  status: true,
  syncSourceId: true,
  externalId: true,
} as const;

/**
 * Upsert a batch of assets for a sync source and stamp `lastSeenAt`. Assets that
 * vanished are retired (status=RETIRED) when `deactivateMissing` is on — never
 * deleted. Keyed by (syncSourceId, externalId), falling back to the unique
 * assetTag so a manually-created asset can be adopted.
 */
export async function importAssets(
  source: SyncSource,
  records: (ImportAsset | ImportError)[],
  deactivateMissing: boolean,
  log: SyncLog,
): Promise<void> {
  const seen: string[] = [];
  const seenExternalIds = new Set<string>();
  const now = new Date();

  for (const rec of records) {
    if ("error" in rec) {
      log.failed++;
      log.line(`Skipped ${rec.ref ?? "record"}: ${rec.error}.`);
      continue;
    }
    if (seenExternalIds.has(rec.externalId)) {
      log.line(`Skipped ${rec.name}: duplicate externalId "${rec.externalId}" in this batch.`);
      continue;
    }
    seenExternalIds.add(rec.externalId);
    seen.push(rec.externalId);

    // Only enum columns get special-cased (never null); the rest pass through.
    const data = {
      name: rec.name,
      assetTag: rec.assetTag,
      serial: rec.serial,
      model: rec.model,
      manufacturer: rec.manufacturer,
      ipAddress: rec.ipAddress,
      macAddress: rec.macAddress,
      os: rec.os,
      location: rec.location,
      ...(rec.type ? { type: rec.type } : {}),
      ...(rec.status ? { status: rec.status } : {}),
    };

    try {
      // The assetTag fallback must never let a source silently claim a
      // manually-created (unsynced) asset — restrict it to assets THIS source
      // already owns so it only reconciles a tag/externalId change of our own.
      const existing = await db.asset.findFirst({
        where: {
          OR: [
            { syncSourceId: source.id, externalId: rec.externalId },
            ...(rec.assetTag ? [{ syncSourceId: source.id, assetTag: rec.assetTag }] : []),
          ],
        },
        select: ASSET_SELECT,
      });
      if (existing) {
        const changes = changedFields(existing, { ...data, syncSourceId: source.id, externalId: rec.externalId });
        // lastSeenAt is bookkeeping for "vanished" detection, not a change of the asset.
        await db.asset.update({ where: { id: existing.id }, data: { ...changes, lastSeenAt: now } });
        if (Object.keys(changes).length === 0) log.unchanged++;
        else log.updated++;
      } else {
        await db.asset.create({
          data: { ...data, syncSourceId: source.id, externalId: rec.externalId, lastSeenAt: now },
        });
        log.created++;
      }
    } catch (e) {
      log.failed++;
      log.line(`Failed ${rec.name}: ${errMessage(e)}`);
    }
  }

  if (deactivateMissing) {
    if (seen.length === 0) {
      log.line(
        "Skipped retirement: the source returned no assets (guarding against mass-retirement from a misconfiguration).",
      );
    } else {
      const res = await db.asset.updateMany({
        where: {
          syncSourceId: source.id,
          externalId: { notIn: seen },
          status: { not: "RETIRED" },
        },
        data: { status: "RETIRED" },
      });
      if (res.count) log.line(`Retired ${res.count} asset(s) no longer present in the source.`);
    }
  }

  log.line(`Done: ${log.created} created, ${log.updated} updated, ${log.unchanged} unchanged, ${log.failed} failed.`);
}
