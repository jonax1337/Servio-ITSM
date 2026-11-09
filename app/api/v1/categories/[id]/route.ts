import { db } from "@/lib/db";
import { apiError, ok, preflight } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { categoryData, categoryPatchSchema } from "@/lib/api-category-input";
import { agentGuard, readBody } from "../../_itsm";
import { CATEGORY_SELECT, DUPLICATE_NAME, categoryWriteErrors, isDuplicateName, serializeCategory } from "../../_categories";
import { managerOnly } from "../../_manage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "catalog:read");
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const category = await db.category.findUnique({ where: { id }, select: CATEGORY_SELECT });
  if (!category) return apiError(404, "Category not found");
  return ok(serializeCategory(category));
}

/** Update a category (MANAGER+). Only the fields sent change; `null` clears parent, group, description and icon. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "catalog:write");
  if ("response" in auth) return auth.response;
  const refused = managerOnly(auth.principal, "categories");
  if (refused) return refused;
  const { id } = await ctx.params;
  const current = await db.category.findUnique({ where: { id }, select: { id: true, name: true, parentId: true } });
  if (!current) return apiError(404, "Category not found");
  const body = await readBody(req, categoryPatchSchema);
  if ("response" in body) return body.response;
  const invalid = await categoryWriteErrors(body.data, current);
  if (invalid) return invalid;

  try {
    const category = await db.category.update({ where: { id }, data: categoryData(body.data), select: CATEGORY_SELECT });
    await writeAudit({
      userId: auth.principal.userId, action: "UPDATE", entity: "Category", entityId: id,
      summary: `Updated category "${category.name}" via API (${Object.keys(body.data).join(", ")})`,
    });
    return ok(serializeCategory(category));
  } catch (err) {
    if (isDuplicateName(err)) return apiError(409, DUPLICATE_NAME);
    throw err;
  }
}
