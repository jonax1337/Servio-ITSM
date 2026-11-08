import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { apiError, ok, preflight, paginate, pageMeta } from "@/lib/api";
import { createRecurringTicket } from "@/lib/actions/recurring-tickets";
import { snakeKeys } from "@/lib/api-itsm-input";
import { recurringTicketCreateForm, recurringTicketCreateSchema } from "@/lib/recurring-ticket-input";
import { presentRecurringTicket } from "../_serializers";
import { agentGuard, asActor, readBody, refusal } from "../_itsm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

/** Recurring ticket schedules. Filters: `active` (true | false | all, default all), `q` (name or title), `import_ref`. */
export async function GET(req: Request) {
  const auth = await agentGuard(req, "read");
  if ("response" in auth) return auth.response;
  const p = new URL(req.url).searchParams;
  const { page, perPage, skip, take } = paginate(p);
  const where: Prisma.RecurringTicketWhereInput = {};
  const active = p.get("active");
  if (active === "true" || active === "false") where.isActive = active === "true";
  if (p.get("q")) where.OR = [{ name: { contains: p.get("q")! } }, { title: { contains: p.get("q")! } }];
  if (p.get("import_ref")) where.importRef = p.get("import_ref")!;
  const [total, rows] = await Promise.all([
    db.recurringTicket.count({ where }),
    db.recurringTicket.findMany({ where, orderBy: [{ nextDueAt: "asc" }, { name: "asc" }], skip, take }),
  ]);
  return ok(rows.map(presentRecurringTicket), { meta: pageMeta(page, perPage, total) });
}

/**
 * Create a schedule through the console's createRecurringTicket (MANAGER or above).
 * With `import_ref`, a re-run for an existing schedule changes nothing and answers
 * 200 with `meta.created: false` (history import of e.g. GLPI recurrent items).
 */
export async function POST(req: Request) {
  const auth = await agentGuard(req, "write");
  if ("response" in auth) return auth.response;
  const body = await readBody(req, recurringTicketCreateSchema);
  if ("response" in body) return body.response;
  if (body.data.import_ref) {
    const existing = await db.recurringTicket.findUnique({ where: { importRef: body.data.import_ref } });
    if (existing) return ok(presentRecurringTicket(existing), { meta: { created: false } });
  }
  const result = await asActor(auth.principal, () => createRecurringTicket(undefined, recurringTicketCreateForm(body.data, auth.principal.userId)));
  if (!result?.ok || !result.id) {
    if (result?.fieldErrors) return apiError(422, "Validation failed", snakeKeys(result.fieldErrors));
    return refusal(result?.error ?? "The recurring ticket could not be created.");
  }
  const row = await db.recurringTicket.findUniqueOrThrow({ where: { id: result.id } });
  return ok(presentRecurringTicket(row), { status: 201, meta: { created: true } });
}
