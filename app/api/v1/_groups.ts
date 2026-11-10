import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { apiError, ok } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { apiFieldNames, changedColumns } from "@/lib/api-record-diff";
import { groupData, type GroupPatch } from "@/lib/api-group-input";
import { AUTOMATION_EMAIL } from "@/lib/system-user";
import { isAgent, type Role } from "@/lib/session";
import { importRefTaken, isUniqueOn } from "./_manage";

export const GROUP_WHAT = "groups";

/** The group's own columns, as the diff of a write compares them. */
export const GROUP_SCALAR_SELECT = {
  id: true,
  name: true,
  description: true,
  type: true,
  email: true,
  color: true,
  managerId: true,
  autoAssign: true,
  importRef: true,
} as const;

export const GROUP_DETAIL_SELECT = {
  ...GROUP_SCALAR_SELECT,
  members: {
    orderBy: { user: { name: "asc" } },
    select: { role: true, user: { select: { id: true, name: true, email: true, isActive: true } } },
  },
} as const;

type MemberRow = { role: string; user: { id: string; name: string | null; email: string; isActive: boolean } };

export function serializeMember(m: MemberRow) {
  return { user_id: m.user.id, name: m.user.name, email: m.user.email, active: m.user.isActive, role: m.role };
}

type GroupRow = {
  id: string;
  name: string;
  description: string | null;
  type: string;
  email: string | null;
  color: string;
  managerId: string | null;
  autoAssign: string;
  importRef: string | null;
};

/** The group's own fields as the API shows them (shared by the list, the detail and the write responses). */
export function serializeGroup(g: GroupRow) {
  return {
    id: g.id,
    name: g.name,
    description: g.description,
    type: g.type,
    email: g.email,
    color: g.color,
    manager_id: g.managerId,
    auto_assign: g.autoAssign,
    import_ref: g.importRef,
  };
}

export function serializeGroupDetail(g: GroupRow & { members: MemberRow[] }) {
  return { ...serializeGroup(g), members: g.members.map(serializeMember) };
}

export function groupNotFound() {
  return apiError(404, "Group not found");
}

/** One group with its members as the detail endpoints answer it, or null. */
export async function groupDetail(id: string) {
  const group = await db.group.findUnique({ where: { id }, select: GROUP_DETAIL_SELECT });
  return group ? serializeGroupDetail(group) : null;
}

function duplicateName(id?: string) {
  return apiError(409, "A group with that name already exists.", id ? { id } : undefined);
}

type Data = ReturnType<typeof groupData>;

/**
 * The Prisma data for a body on top of `current` (absent on create). 422 for a manager who does not
 * exist, is inactive or is not an agent; 409 for a name or import_ref another group already has.
 */
export async function prepareGroup(
  b: Partial<GroupPatch>,
  current: { id: string; name: string; importRef: string | null } | null,
): Promise<{ data: Data } | { response: ReturnType<typeof apiError> }> {
  const data = groupData(b);
  if (data.managerId) {
    const manager = await db.user.findUnique({ where: { id: data.managerId }, select: { role: true, isActive: true, email: true } });
    if (!manager || !manager.isActive || manager.email === AUTOMATION_EMAIL || !isAgent(manager.role as Role)) {
      return { response: apiError(422, "Validation failed", { manager_id: ["Must be an active agent (AGENT, MANAGER or ADMIN)"] }) };
    }
  }
  if (data.name && data.name !== current?.name) {
    const clash = await db.group.findUnique({ where: { name: data.name }, select: { id: true } });
    if (clash && clash.id !== current?.id) return { response: duplicateName(clash.id) };
  }
  if (data.importRef && data.importRef !== current?.importRef) {
    const taken = await db.group.findUnique({ where: { importRef: data.importRef }, select: { id: true } });
    if (taken && taken.id !== current?.id) return { response: importRefTaken(taken.id) };
  }
  return { data };
}

function touched(id?: string) {
  revalidatePath("/groups");
  if (id) revalidatePath(`/groups/${id}`);
}

export async function createGroupRecord(data: Data & { name: string }, actorId: string, via: string) {
  const group = await db.group.create({ data, select: { id: true, name: true } });
  await writeAudit({ userId: actorId, action: "CREATE", entity: "Group", entityId: group.id, summary: `Created group "${group.name}" via ${via}` });
  touched();
  return group.id;
}

/** Writes the columns that differ from `current`; an unchanged body writes nothing and no audit row. */
export async function updateGroupRecord(current: GroupRow, data: Data, actorId: string, via: string) {
  const columns = changedColumns(current, data);
  const changed = apiFieldNames(columns);
  if (columns.length === 0) return { id: current.id, changed };
  const patch = Object.fromEntries(columns.map((k) => [k, data[k as keyof Data]]));
  const group = await db.group.update({ where: { id: current.id }, data: patch, select: { id: true, name: true } });
  await writeAudit({
    userId: actorId, action: "UPDATE", entity: "Group", entityId: group.id,
    summary: `Updated group "${group.name}" via ${via} (${changed.join(", ")})`, meta: { changed },
  });
  touched(group.id);
  return { id: group.id, changed };
}

export async function groupResponse(id: string, init?: { status?: number; meta?: unknown }) {
  const detail = await groupDetail(id);
  return detail ? ok(detail, init) : groupNotFound();
}

/** 409 for a unique value lost to a concurrent writer; otherwise rethrows. */
export function groupWriteConflict(err: unknown) {
  if (isUniqueOn(err, "importRef")) return importRefTaken();
  if (isUniqueOn(err, "name")) return duplicateName();
  throw err;
}
