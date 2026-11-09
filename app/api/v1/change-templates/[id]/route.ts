import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { ok, preflight } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { changeTemplatePatchSchema } from "@/lib/api-change-template-input";
import { agentGuard, readBody } from "../../_itsm";
import { managerOnly } from "../../_manage";
import {
  TEMPLATE_WHAT, prepareChangeTemplate, templateNotFound, templateResponse, templateWriteConflict, updateTemplateRecord,
} from "../../_change-templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "catalog:read");
  if ("response" in auth) return auth.response;
  const template = await db.changeTemplate.findUnique({ where: { id: (await ctx.params).id } });
  if (!template) return templateNotFound();
  return templateResponse(template);
}

/** Edit a change template (MANAGER+). Fields left out keep their value; `null` clears a nullable one; `meta.changed` lists what changed. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "catalog:write");
  if ("response" in auth) return auth.response;
  const refused = managerOnly(auth.principal, TEMPLATE_WHAT);
  if (refused) return refused;
  const current = await db.changeTemplate.findUnique({ where: { id: (await ctx.params).id } });
  if (!current) return templateNotFound();
  const body = await readBody(req, changeTemplatePatchSchema);
  if ("response" in body) return body.response;
  const prepared = await prepareChangeTemplate(body.data, current, auth.principal.role);
  if ("response" in prepared) return prepared.response;

  try {
    const { template, changed } = await updateTemplateRecord(current, prepared.data, auth.principal.userId, "API");
    return templateResponse(template, { meta: { changed } });
  } catch (err) {
    return templateWriteConflict(err);
  }
}

/** Delete a change template (MANAGER+). Changes created from it stay and lose the link. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "catalog:write");
  if ("response" in auth) return auth.response;
  const refused = managerOnly(auth.principal, TEMPLATE_WHAT);
  if (refused) return refused;
  const { id } = await ctx.params;
  const template = await db.changeTemplate.findUnique({ where: { id }, select: { name: true } });
  if (!template) return templateNotFound();
  // deleteMany: a concurrent delete between the lookup and here is a 404, not a 500.
  const { count } = await db.changeTemplate.deleteMany({ where: { id } });
  if (count === 0) return templateNotFound();
  await writeAudit({ userId: auth.principal.userId, action: "DELETE", entity: "ChangeTemplate", entityId: id, summary: `Deleted change template "${template.name}" via API` });
  revalidatePath("/changes/templates");
  return ok({ id, deleted: true });
}
