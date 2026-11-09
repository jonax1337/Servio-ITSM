import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok, apiError, preflight, paginate, pageMeta } from "@/lib/api";
import { createChange } from "@/lib/actions/changes";
import { changeCreateForm, changeCreateSchema, snakeKeys } from "@/lib/api-itsm-input";
import { SETTLED_CHANGE_STATUSES } from "@/lib/asset-link-rules";
import { CHANGE_INCLUDE, serializeChange } from "../_serializers";
import { agentGuard, asActor, readBody, refusal } from "../_itsm";
import { createChangeFromTemplateRequest } from "../_change-from-template";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/**
 * List changes. Filters: `status` (a status, or `open` = not closed/rejected/
 * failed/cancelled), `type`, `risk`, `assignee_id`, `group_id`, `category_id`,
 * `problem_id`, `updated_since` (ISO time), and `q` — a substring search over
 * title, description, reason, both plans, closure notes and comments.
 */
export async function GET(req: Request) {
  const auth = await agentGuard(req, "changes:read");
  if ("response" in auth) return auth.response;

  const url = new URL(req.url);
  const { page, perPage, skip, take } = paginate(url.searchParams);
  const p = url.searchParams;

  const where: Prisma.ChangeWhereInput = {};
  const status = p.get("status");
  if (status === "open") where.status = { notIn: [...SETTLED_CHANGE_STATUSES] };
  else if (status) where.status = status;
  if (p.get("type")) where.type = p.get("type")!;
  if (p.get("risk")) where.risk = p.get("risk")!;
  if (p.get("assignee_id")) where.assigneeId = p.get("assignee_id")!;
  if (p.get("group_id")) where.groupId = p.get("group_id")!;
  if (p.get("category_id")) where.categoryId = p.get("category_id")!;
  if (p.get("problem_id")) {
    const problemId = Number(p.get("problem_id"));
    if (!Number.isInteger(problemId)) return apiError(422, "Validation failed", { problem_id: ["Must be an integer"] });
    where.problemId = problemId;
  }
  if (p.get("import_ref")) where.importRef = p.get("import_ref")!;
  const since = p.get("updated_since");
  if (since) {
    const d = new Date(since);
    if (Number.isNaN(d.getTime())) return apiError(422, "Validation failed", { updated_since: ["Must be an ISO date/time"] });
    where.updatedAt = { gte: d };
  }
  const q = p.get("q")?.trim();
  if (q) {
    where.OR = [
      { title: { contains: q } },
      { description: { contains: q } },
      { reason: { contains: q } },
      { implementationPlan: { contains: q } },
      { rollbackPlan: { contains: q } },
      { closureNotes: { contains: q } },
      { comments: { some: { body: { contains: q } } } },
    ];
  }

  const [total, changes] = await Promise.all([
    db.change.count({ where }),
    db.change.findMany({ where, include: CHANGE_INCLUDE, orderBy: { updatedAt: "desc" }, skip, take }),
  ]);
  return ok(changes.map(serializeChange), { meta: pageMeta(page, perPage, total) });
}

/**
 * Create a change (always in DRAFT), through the console's createChange action:
 * the same validation (standard-type rule, planned window, required custom
 * fields, affected CIs), audit row and assignee notification. With
 * `template_id` / `template_ref` it is the console's "new change from template"
 * instead (see _change-from-template.ts): a STANDARD template's change is
 * pre-approved by the same path as there.
 */
export async function POST(req: Request) {
  const auth = await agentGuard(req, "changes:write");
  if ("response" in auth) return auth.response;
  const body = await readBody(req, changeCreateSchema);
  if ("response" in body) return body.response;
  if (body.data.template_id || body.data.template_ref) return createChangeFromTemplateRequest(auth.principal, body.data);

  const result = await asActor(auth.principal, () => createChange(undefined, changeCreateForm(body.data)));
  if (!result?.createdId) {
    if (result?.fieldErrors) return apiError(422, result.error ?? "Validation failed", snakeKeys(result.fieldErrors));
    return refusal(result?.error ?? "The change could not be created.");
  }
  const change = await db.change.findUniqueOrThrow({ where: { id: result.createdId }, include: CHANGE_INCLUDE });
  return ok(serializeChange(change), { status: 201 });
}
