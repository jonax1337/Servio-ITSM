import type { SyncSource } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import type { GroupMapping } from "./group-mapping";
import { planGroupMembership, planTotals, type DirectoryMapping, type GroupPlan, type PlannedUser } from "./group-plan";
import { fetchDirectoryGroups, type DirectoryClient, type DirectoryGroupConfig } from "./ldap-groups";
import type { SyncLog } from "./types";

/**
 * The group-membership step of a directory sync: read the mapped directory groups, plan the Servio group
 * membership of the users this source imported, and apply the plan. `previewGroupSync` stops after the
 * plan (the "preview" in the sync UI). The rules are in lib/connectors/group-plan.ts, the directory side
 * in lib/connectors/ldap-groups.ts.
 */

export type GroupSyncGroupReport = {
  groupId: string;
  groupName: string;
  directoryGroups: string[];
  adds: PlannedUser[];
  removes: PlannedUser[];
  heldBack: number;
  pendingNew: number;
};

export type GroupSyncReport = {
  groups: GroupSyncGroupReport[];
  /** Mappings that could not be used (directory group not found, Servio group unknown, lookup failed). */
  problems: string[];
};

/** Resolve a Servio group by import ref first, then by id (a ref wins over an id that looks the same). */
export async function resolveServioGroups(refs: readonly string[]): Promise<Map<string, { id: string; name: string }>> {
  const wanted = [...new Set(refs)];
  const rows = wanted.length
    ? await db.group.findMany({
        where: { OR: [{ importRef: { in: wanted } }, { id: { in: wanted } }] },
        select: { id: true, name: true, importRef: true },
      })
    : [];
  const out = new Map<string, { id: string; name: string }>();
  for (const ref of wanted) {
    const row = rows.find((g) => g.importRef === ref) ?? rows.find((g) => g.id === ref);
    if (row) out.set(ref, { id: row.id, name: row.name });
  }
  return out;
}

/** The refs of `mappings` that name no Servio group, for validating a source when it is saved. */
export async function unknownServioGroups(mappings: readonly GroupMapping[]): Promise<string[]> {
  const known = await resolveServioGroups(mappings.map((m) => m.group));
  return [...new Set(mappings.map((m) => m.group))].filter((ref) => !known.has(ref));
}

/** Read the directory and plan the membership. Writes nothing. */
export async function planGroupSync(
  source: Pick<SyncSource, "id">,
  client: DirectoryClient,
  cfg: DirectoryGroupConfig,
  mappings: readonly GroupMapping[],
): Promise<GroupSyncReport> {
  const problems: string[] = [];
  const servio = await resolveServioGroups(mappings.map((m) => m.group));
  const usable = mappings.filter((m) => {
    if (servio.has(m.group)) return true;
    problems.push(`Servio group "${m.group}" (mapped from "${m.directoryGroup}") does not exist.`);
    return false;
  });
  const fetched = await fetchDirectoryGroups(client, cfg, usable);

  const directory: DirectoryMapping[] = fetched.map((f) => {
    const groupId = servio.get(f.mapping.group)!.id;
    if (!f.ok) problems.push(f.error);
    return { groupId, label: f.mapping.directoryGroup, members: f.ok ? f.members : [], complete: f.ok };
  });

  const groupIds = [...new Set(directory.map((d) => d.groupId))];
  const [owned, memberRows] = await Promise.all([
    db.user.findMany({
      where: { syncSourceId: source.id, externalId: { not: null } },
      select: { id: true, externalId: true, email: true, name: true },
    }),
    groupIds.length ? db.groupMember.findMany({ where: { groupId: { in: groupIds } }, select: { groupId: true, userId: true } }) : Promise.resolve([]),
  ]);
  const current = new Map<string, Set<string>>();
  for (const row of memberRows) current.set(row.groupId, (current.get(row.groupId) ?? new Set()).add(row.userId));

  const plans = planGroupMembership({
    mappings: directory,
    owned: owned.map((u) => ({ id: u.id, externalId: u.externalId!, email: u.email, name: u.name })),
    current,
  });
  const names = new Map([...servio.values()].map((g) => [g.id, g.name]));
  return { groups: plans.map((p) => toReport(p, names.get(p.groupId) ?? p.groupId)), problems };
}

function toReport(plan: GroupPlan, groupName: string): GroupSyncGroupReport {
  return { groupId: plan.groupId, groupName, directoryGroups: plan.directoryGroups, adds: plan.adds, removes: plan.removes, heldBack: plan.heldBack, pendingNew: plan.pendingNew };
}

export function reportTotals(report: GroupSyncReport) {
  return planTotals(report.groups);
}

/**
 * Apply a planned membership: add the missing members (role MEMBER) and remove the ones the directory no
 * longer has, one audit entry per group that changed. A race with a manual edit is harmless: adding a
 * membership that exists and removing one that is gone are both no-ops.
 */
export async function applyGroupSync(
  source: Pick<SyncSource, "id" | "name">,
  report: GroupSyncReport,
  log: SyncLog,
  actorId?: string | null,
): Promise<{ added: number; removed: number }> {
  let added = 0;
  let removed = 0;
  for (const g of report.groups) {
    if (g.adds.length === 0 && g.removes.length === 0) continue;
    try {
      let addedHere = 0;
      let removedHere = 0;
      await db.$transaction(async (tx) => {
        for (const u of g.adds) {
          const exists = await tx.groupMember.findUnique({ where: { groupId_userId: { groupId: g.groupId, userId: u.userId } }, select: { id: true } });
          if (exists) continue;
          await tx.groupMember.create({ data: { groupId: g.groupId, userId: u.userId, role: "MEMBER" } });
          addedHere++;
        }
        if (g.removes.length) {
          const res = await tx.groupMember.deleteMany({ where: { groupId: g.groupId, userId: { in: g.removes.map((u) => u.userId) } } });
          removedHere = res.count;
        }
      });
      added += addedHere;
      removed += removedHere;
      if (addedHere || removedHere) {
        await writeAudit({
          userId: actorId ?? null,
          action: "UPDATE",
          entity: "Group",
          entityId: g.groupId,
          summary: `Directory sync "${source.name}" changed the members of "${g.groupName}": ${addedHere} added, ${removedHere} removed`,
          meta: {
            syncSourceId: source.id,
            directoryGroups: g.directoryGroups,
            added: g.adds.map((u) => u.email),
            removed: g.removes.map((u) => u.email),
          },
        });
        log.line(`Group "${g.groupName}": ${addedHere} added, ${removedHere} removed.`);
      }
    } catch (e) {
      log.failed++;
      log.line(`Group "${g.groupName}": the membership could not be updated: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { added, removed };
}

/** The log lines a run writes about the plan: problems (each counts as failed), held-back removals and users to come. */
export function logGroupSyncReport(report: GroupSyncReport, log: SyncLog): void {
  for (const problem of report.problems) {
    log.failed++;
    log.line(`Group mapping skipped: ${problem}`);
  }
  for (const g of report.groups) {
    if (g.heldBack > 0) log.line(`Group "${g.groupName}": ${g.heldBack} removal(s) held back because a mapped directory group could not be read reliably.`);
    if (g.pendingNew > 0) log.line(`Group "${g.groupName}": ${g.pendingNew} directory member(s) are not imported users and cannot be added.`);
  }
}
