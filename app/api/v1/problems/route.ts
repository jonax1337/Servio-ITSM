import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ok, apiError, preflight, paginate, pageMeta } from "@/lib/api";
import { createProblem } from "@/lib/actions/problems";
import { problemCreateForm, problemCreateSchema, snakeKeys } from "@/lib/api-itsm-input";
import { PROBLEM_INCLUDE, serializeProblem } from "../_serializers";
import { agentGuard, asActor, readBody, refusal } from "../_itsm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Problem statuses that count as done for `status=open`. */
const SETTLED_PROBLEM_STATUSES = ["RESOLVED", "CLOSED"];

export function OPTIONS() {
  return preflight();
}

/**
 * List problems. Filters: `status` (a status, or `open` = not resolved/closed),
 * `priority`, `assignee_id`, `group_id`, `category_id`, `updated_since`, and `q`
 * over title, description, root cause, workaround and comments.
 */
export async function GET(req: Request) {
  const auth = await agentGuard(req, "read");
  if ("response" in auth) return auth.response;

  const url = new URL(req.url);
  const { page, perPage, skip, take } = paginate(url.searchParams);
  const p = url.searchParams;

  const where: Prisma.ProblemWhereInput = {};
  const status = p.get("status");
  if (status === "open") where.status = { notIn: SETTLED_PROBLEM_STATUSES };
  else if (status) where.status = status;
  if (p.get("priority")) where.priority = p.get("priority")!;
  if (p.get("assignee_id")) where.assigneeId = p.get("assignee_id")!;
  if (p.get("group_id")) where.groupId = p.get("group_id")!;
  if (p.get("category_id")) where.categoryId = p.get("category_id")!;
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
      { rootCause: { contains: q } },
      { workaround: { contains: q } },
      { comments: { some: { body: { contains: q } } } },
    ];
  }

  const [total, problems] = await Promise.all([
    db.problem.count({ where }),
    db.problem.findMany({ where, include: PROBLEM_INCLUDE, orderBy: { updatedAt: "desc" }, skip, take }),
  ]);
  return ok(problems.map(serializeProblem), { meta: pageMeta(page, perPage, total) });
}

/** Create a problem through the console's createProblem action (same validation, audit and notification). */
export async function POST(req: Request) {
  const auth = await agentGuard(req, "write");
  if ("response" in auth) return auth.response;
  const body = await readBody(req, problemCreateSchema);
  if ("response" in body) return body.response;

  const result = await asActor(auth.principal, () => createProblem(undefined, problemCreateForm(body.data)));
  if (!result?.createdId) {
    if (result?.fieldErrors) return apiError(422, result.error ?? "Validation failed", snakeKeys(result.fieldErrors));
    return refusal(result?.error ?? "The problem could not be created.");
  }
  const problem = await db.problem.findUniqueOrThrow({ where: { id: result.createdId }, include: PROBLEM_INCLUDE });
  return ok(serializeProblem(problem), { status: 201 });
}
