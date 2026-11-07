import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { ok, apiError, paginate, pageMeta } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { commentCreateSchema } from "@/lib/api-itsm-input";
import { serializeComment } from "./_serializers";
import { agentGuard, readBody, recordId } from "./_itsm";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET/POST handlers for the comment thread of a change or a problem. A POST
 * does what the console's addChangeComment / addProblemComment do: plain-text
 * body, internal flag, the record's updatedAt bumped, an audit row as the token
 * owner. (Neither thread sends mail.)
 */
export function recordCommentHandlers(kind: "Change" | "Problem") {
  const path = kind === "Change" ? "changes" : "problems";
  const notFound = () => apiError(404, `${kind} not found`);
  const exists = (id: number) =>
    kind === "Change"
      ? db.change.findUnique({ where: { id }, select: { id: true } })
      : db.problem.findUnique({ where: { id }, select: { id: true } });

  async function GET(req: Request, ctx: Ctx) {
    const auth = await agentGuard(req, "read");
    if ("response" in auth) return auth.response;
    const id = recordId((await ctx.params).id);
    if (!id || !(await exists(id))) return notFound();
    const { page, perPage, skip, take } = paginate(new URL(req.url).searchParams);
    const args = { include: { author: true }, orderBy: { createdAt: "asc" as const }, skip, take };
    const [total, rows] =
      kind === "Change"
        ? await Promise.all([db.changeComment.count({ where: { changeId: id } }), db.changeComment.findMany({ where: { changeId: id }, ...args })])
        : await Promise.all([db.problemComment.count({ where: { problemId: id } }), db.problemComment.findMany({ where: { problemId: id }, ...args })]);
    return ok(rows.map(serializeComment), { meta: pageMeta(page, perPage, total) });
  }

  async function POST(req: Request, ctx: Ctx) {
    const auth = await agentGuard(req, "write");
    if ("response" in auth) return auth.response;
    const id = recordId((await ctx.params).id);
    if (!id || !(await exists(id))) return notFound();
    const body = await readBody(req, commentCreateSchema);
    if ("response" in body) return body.response;
    const data = { authorId: auth.principal.userId, body: body.data.body, bodyHtml: null, isInternal: body.data.internal };

    const comment =
      kind === "Change"
        ? await db.$transaction(async (tx) => {
            const c = await tx.changeComment.create({ data: { ...data, changeId: id }, include: { author: true } });
            await tx.change.update({ where: { id }, data: { updatedAt: new Date() } });
            return c;
          })
        : await db.$transaction(async (tx) => {
            const c = await tx.problemComment.create({ data: { ...data, problemId: id }, include: { author: true } });
            await tx.problem.update({ where: { id }, data: { updatedAt: new Date() } });
            return c;
          });
    await writeAudit({ userId: auth.principal.userId, action: "UPDATE", entity: kind, entityId: id, summary: "Added a comment via API" });
    revalidatePath(`/${path}/${id}`);
    return ok(serializeComment(comment), { status: 201 });
  }

  return { GET, POST };
}
