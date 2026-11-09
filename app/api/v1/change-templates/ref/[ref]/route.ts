import { db } from "@/lib/db";
import { apiError, preflight, type ApiPrincipal } from "@/lib/api";
import { CHANGE_TEMPLATE_FIELD_RENAMES, changeTemplateUpsertSchema, type ChangeTemplateUpsert } from "@/lib/api-change-template-input";
import { apiFieldNames } from "@/lib/api-record-diff";
import { agentGuard, readBody } from "../../../_itsm";
import { invalidRef, isUniqueOn, managerOnly, refOf } from "../../../_manage";
import {
  TEMPLATE_WHAT, createTemplateRecord, prepareChangeTemplate, templateNotFound, templateResponse, templateWriteConflict, updateTemplateRecord,
} from "../../../_change-templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** The change template with this origin reference (e.g. `runbook:patch-linux`), or 404. */
export async function GET(req: Request, ctx: { params: Promise<{ ref: string }> }) {
  const auth = await agentGuard(req, "read");
  if ("response" in auth) return auth.response;
  const ref = await refOf(ctx);
  const template = ref ? await db.changeTemplate.findUnique({ where: { importRef: ref } }) : null;
  if (!template) return templateNotFound();
  return templateResponse(template);
}

/**
 * Upsert by origin reference (MANAGER+), for keeping standard changes in step
 * with a source such as a runbook collection. Creates the template (201; `name`
 * and `title` required) when the reference is new, otherwise writes only the
 * fields sent (200). Unchanged fields write nothing and no audit row.
 */
export async function PUT(req: Request, ctx: { params: Promise<{ ref: string }> }) {
  const auth = await agentGuard(req, "write");
  if ("response" in auth) return auth.response;
  const refused = managerOnly(auth.principal, TEMPLATE_WHAT);
  if (refused) return refused;
  const ref = await refOf(ctx);
  if (!ref) return invalidRef();
  const body = await readBody(req, changeTemplateUpsertSchema);
  if ("response" in body) return body.response;

  try {
    return await upsert(auth.principal, ref, body.data);
  } catch (err) {
    // Two runs creating the same ref at once: the loser retries as an update.
    if (isUniqueOn(err, "importRef")) return upsert(auth.principal, ref, body.data).catch(templateWriteConflict);
    return templateWriteConflict(err);
  }
}

async function upsert(principal: ApiPrincipal, ref: string, b: ChangeTemplateUpsert) {
  const current = await db.changeTemplate.findUnique({ where: { importRef: ref } });
  if (!current && (!b.name || !b.title)) {
    return apiError(422, "Validation failed", {
      ...(!b.name && { name: ["Required to create a new change template"] }),
      ...(!b.title && { title: ["Required to create a new change template"] }),
    });
  }
  const prepared = await prepareChangeTemplate(b, current);
  if ("response" in prepared) return prepared.response;
  const via = `API (${ref})`;
  if (!current) {
    const template = await createTemplateRecord({ ...prepared.data, name: b.name!, title: b.title!, importRef: ref }, principal.userId, via);
    return templateResponse(template, {
      status: 201,
      meta: { created: true, changed: apiFieldNames(Object.keys(prepared.data), CHANGE_TEMPLATE_FIELD_RENAMES) },
    });
  }
  const { template, changed } = await updateTemplateRecord(current, prepared.data, principal.userId, via);
  return templateResponse(template, { meta: { created: false, changed } });
}
