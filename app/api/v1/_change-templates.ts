import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { apiError, ok } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { apiFieldNames, changedColumns } from "@/lib/api-record-diff";
import { catalogReferenceError } from "@/lib/catalog-items";
import {
  CHANGE_TEMPLATE_FIELD_RENAMES, changeTemplateData, changeTemplateProblem, serializeChangeTemplate,
  type ChangeTemplatePatch, type ChangeTemplateRow,
} from "@/lib/api-change-template-input";
import { importRefTaken, isUniqueOn } from "./_manage";

/** Shared plumbing of the /change-templates endpoints. */

export const TEMPLATE_WHAT = "change templates";

export function templateNotFound() {
  return apiError(404, "Change template not found");
}

type Data = ReturnType<typeof changeTemplateData>;

/**
 * The Prisma data for a body on top of `current` (absent on create): 422 for an
 * unknown category, service or team, or a STANDARD template without both plans;
 * 409 for a name another template already has.
 */
export async function prepareChangeTemplate(
  b: Partial<ChangeTemplatePatch>,
  current: ChangeTemplateRow | null,
): Promise<{ data: Data } | { response: ReturnType<typeof apiError> }> {
  const data = changeTemplateData(b);
  const missing = await catalogReferenceError(data);
  if (missing) return { response: apiError(422, "Validation failed", { [missing.field]: [missing.message] }) };
  const problem = changeTemplateProblem(current, data);
  if (problem) return { response: apiError(422, "Validation failed", problem) };
  if (data.name && data.name !== current?.name) {
    const clash = await db.changeTemplate.findUnique({ where: { name: data.name }, select: { id: true } });
    if (clash && clash.id !== current?.id) return { response: duplicateName(clash.id) };
  }
  if (data.importRef && data.importRef !== current?.importRef) {
    const taken = await db.changeTemplate.findUnique({ where: { importRef: data.importRef }, select: { id: true } });
    if (taken && taken.id !== current?.id) return { response: importRefTaken(taken.id) };
  }
  return { data };
}

function duplicateName(id?: string) {
  return apiError(409, "A change template with this name already exists.", id ? { id } : undefined);
}

export async function createTemplateRecord(data: Data & { name: string; title: string }, actorId: string, via: string) {
  const template = await db.changeTemplate.create({ data: data as Prisma.ChangeTemplateUncheckedCreateInput });
  await writeAudit({ userId: actorId, action: "CREATE", entity: "ChangeTemplate", entityId: template.id, summary: `Created change template "${template.name}" via ${via}` });
  revalidatePath("/changes/templates");
  return template;
}

/** Write the columns that differ from `current`; an unchanged body writes nothing and no audit row. */
export async function updateTemplateRecord(current: ChangeTemplateRow, data: Data, actorId: string, via: string) {
  const columns = changedColumns(current, data);
  const changed = apiFieldNames(columns, CHANGE_TEMPLATE_FIELD_RENAMES);
  if (columns.length === 0) return { template: current, changed };
  const patch = Object.fromEntries(columns.map((k) => [k, data[k as keyof Data]]));
  const template = await db.changeTemplate.update({ where: { id: current.id }, data: patch });
  await writeAudit({
    userId: actorId, action: "UPDATE", entity: "ChangeTemplate", entityId: template.id,
    summary: `Updated change template "${template.name}" via ${via} (${changed.join(", ")})`, meta: { changed },
  });
  revalidatePath("/changes/templates");
  revalidatePath(`/changes/templates/${template.id}`);
  return { template, changed };
}

export function templateResponse(t: ChangeTemplateRow, init?: { status?: number; meta?: unknown }) {
  return ok(serializeChangeTemplate(t), init);
}

/** 409 for a unique value lost to a concurrent writer; otherwise rethrows. */
export function templateWriteConflict(err: unknown) {
  if (isUniqueOn(err, "importRef")) return importRefTaken();
  if (isUniqueOn(err, "name")) return duplicateName();
  throw err;
}
