import { db } from "@/lib/db";
import { ok, preflight } from "@/lib/api";
import { groupCreateSchema } from "@/lib/api-group-input";
import { agentGuard, readBody } from "../_itsm";
import { managerOnly } from "../_manage";
import { GROUP_SCALAR_SELECT, GROUP_WHAT, createGroupRecord, groupResponse, groupWriteConflict, prepareGroup, serializeGroup } from "../_groups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** Groups with their member ids, to resolve a `group_id` and pick an assignee who is a member. */
export async function GET(req: Request) {
  const auth = await agentGuard(req, "directory:read");
  if ("response" in auth) return auth.response;
  const rows = await db.group.findMany({
    orderBy: { name: "asc" },
    select: { ...GROUP_SCALAR_SELECT, members: { select: { userId: true, role: true } } },
  });
  return ok(
    rows.map((g) => ({
      ...serializeGroup(g),
      members: g.members.map((m) => ({ user_id: m.userId, role: m.role })),
    })),
  );
}

/**
 * Create a group (MANAGER+, like the console). Names are unique: a duplicate name or `import_ref` is a 409
 * with the existing group's `id`. Members are managed through `/groups/{id}/members`.
 */
export async function POST(req: Request) {
  const auth = await agentGuard(req, "directory:write");
  if ("response" in auth) return auth.response;
  const refused = managerOnly(auth.principal, GROUP_WHAT);
  if (refused) return refused;
  const body = await readBody(req, groupCreateSchema);
  if ("response" in body) return body.response;
  const prepared = await prepareGroup(body.data, null);
  if ("response" in prepared) return prepared.response;
  try {
    const id = await createGroupRecord({ ...prepared.data, name: body.data.name }, auth.principal.userId, "API");
    return groupResponse(id, { status: 201 });
  } catch (err) {
    return groupWriteConflict(err);
  }
}
