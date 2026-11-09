import { db } from "@/lib/db";
import { apiError, ok, preflight } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { categoryCreateSchema, categoryData } from "@/lib/api-category-input";
import { agentGuard, readBody } from "../_itsm";
import { CATEGORY_SELECT, DUPLICATE_NAME, categoryWriteErrors, isDuplicateName, serializeCategory } from "../_categories";
import { managerOnly } from "../_manage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** Categories (shared by tickets, problems and changes), to resolve a `category_id`. `include_archived=true` adds archived ones. */
export async function GET(req: Request) {
  const auth = await agentGuard(req, "catalog:read");
  if ("response" in auth) return auth.response;
  const includeArchived = new URL(req.url).searchParams.get("include_archived") === "true";
  const rows = await db.category.findMany({
    where: includeArchived ? {} : { archived: false },
    orderBy: { name: "asc" },
    select: CATEGORY_SELECT,
  });
  return ok(rows.map(serializeCategory));
}

/** Create a category (MANAGER+). A name already used under the same parent is a 409 with the existing `id`. */
export async function POST(req: Request) {
  const auth = await agentGuard(req, "catalog:write");
  if ("response" in auth) return auth.response;
  const refused = managerOnly(auth.principal, "categories");
  if (refused) return refused;
  const body = await readBody(req, categoryCreateSchema);
  if ("response" in body) return body.response;
  const invalid = await categoryWriteErrors(body.data);
  if (invalid) return invalid;

  try {
    const category = await db.category.create({
      data: { ...categoryData(body.data), name: body.data.name },
      select: CATEGORY_SELECT,
    });
    await writeAudit({ userId: auth.principal.userId, action: "CREATE", entity: "Category", entityId: category.id, summary: `Created category "${category.name}" via API` });
    return ok(serializeCategory(category), { status: 201 });
  } catch (err) {
    if (isDuplicateName(err)) return apiError(409, DUPLICATE_NAME);
    throw err;
  }
}
