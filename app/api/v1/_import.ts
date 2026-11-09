import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { db } from "@/lib/db";
import { guard, ok, apiError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { prefixForType } from "@/lib/constants";
import {
  changeImportData,
  changeImportSchema,
  changeReimportSchema,
  commentRows,
  importCommentRows,
  importRefFromPath,
  importValidationErrors,
  planReimport,
  problemImportData,
  problemImportSchema,
  problemReimportSchema,
  referencedUserIds,
  reimportColumns,
  reimportRefErrors,
  ticketImportData,
  ticketImportSchema,
  ticketReimportSchema,
  type ImportComment,
  type StoredComment,
} from "@/lib/api-import-input";
import { CHANGE_INCLUDE, PROBLEM_INCLUDE, serializeChange, serializeProblem, serializeTicket } from "./_serializers";
import { readBody } from "./_itsm";

type Kind = "Ticket" | "Problem" | "Change";
type Body = Record<string, unknown> & { import_ref: string; comments: ImportComment[] };

/**
 * History import is the one place the API writes past the lifecycle rules, so it
 * needs the privileged `import:write` scope (which `write` does not grant, `admin`
 * does) and a token owned by an ADMIN.
 */
async function importGuard(req: Request) {
  const auth = await guard(req, "import:write");
  if ("response" in auth) return auth;
  if (auth.principal.role !== "ADMIN") {
    return { response: apiError(403, "History import needs a token owned by an ADMIN.") };
  }
  return auth;
}

/** 422 details for ids that point nowhere, checked up front so a bad id is never a 500 on a foreign key. */
async function unknownReferences(b: Record<string, unknown>, userIds: string[]): Promise<Record<string, string[]>> {
  const errors: Record<string, string[]> = {};
  const found = userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true } }) : [];
  const missingUsers = userIds.filter((u) => !found.some((f) => f.id === u));
  if (missingUsers.length) errors.users = missingUsers.map((u) => `Unknown user: ${u}`);
  const checks: [string, (v: never) => Promise<unknown>][] = [
    ["group_id", (v: string) => db.group.findUnique({ where: { id: v }, select: { id: true } })],
    ["category_id", (v: string) => db.category.findUnique({ where: { id: v }, select: { id: true } })],
    ["service_id", (v: string) => db.service.findUnique({ where: { id: v }, select: { id: true } })],
    ["problem_id", (v: number) => db.problem.findUnique({ where: { id: v }, select: { id: true } })],
    ["change_id", (v: number) => db.change.findUnique({ where: { id: v }, select: { id: true } })],
  ] as never;
  for (const [key, find] of checks) {
    const v = b[key];
    if (v !== undefined && v !== null && !(await find(v as never))) errors[key] = [`Unknown ${key.replace("_id", "")}: ${v}`];
  }
  return errors;
}

/** Payload checks shared by POST and PUT: timeline, duplicate comment refs, unknown ids (422 or null). */
async function validationFailure(b: Body) {
  const errors = importValidationErrors(b as never);
  if (Object.keys(errors).length) return apiError(422, "Validation failed", errors);
  const refs = await unknownReferences(b, referencedUserIds(b as never));
  if (Object.keys(refs).length) return apiError(422, "Validation failed", refs);
  return null;
}

async function existing(kind: Kind, importRef: string) {
  if (kind === "Change") {
    const c = await db.change.findUnique({ where: { importRef }, include: CHANGE_INCLUDE });
    return c && serializeChange(c);
  }
  if (kind === "Problem") {
    const p = await db.problem.findUnique({ where: { importRef }, include: PROBLEM_INCLUDE });
    return p && serializeProblem(p);
  }
  const t = await db.ticket.findUnique({ where: { importRef }, include: { requester: true, assignee: true } });
  return t && serializeTicket(t);
}

/** The full create mapping of a body (also the source of the columns a re-import owns). */
function importData(kind: Kind, b: never, actorId: string): Record<string, unknown> {
  if (kind === "Change") return changeImportData(b, actorId);
  if (kind === "Problem") return problemImportData(b);
  return ticketImportData(b, actorId, prefixForType((b as { type: string }).type));
}

async function create(kind: Kind, b: never, actorId: string) {
  const data = { ...importData(kind, b, actorId), comments: { create: importCommentRows(b, actorId) } } as never;
  if (kind === "Change") {
    const c = await db.change.create({ data, include: CHANGE_INCLUDE });
    return { id: c.id, data: serializeChange(c) };
  }
  if (kind === "Problem") {
    const p = await db.problem.create({ data, include: PROBLEM_INCLUDE });
    return { id: p.id, data: serializeProblem(p) };
  }
  const t = await db.ticket.create({ data, include: { requester: true, assignee: true } });
  return { id: t.id, data: serializeTicket(t) };
}

/** The stored row of an imported record with the comment facts the dedup needs, or null. */
async function stored(kind: Kind, importRef: string): Promise<(Record<string, unknown> & { id: number; comments: StoredComment[] }) | null> {
  const comments = { select: { body: true, createdAt: true, importRef: true } };
  if (kind === "Change") return db.change.findUnique({ where: { importRef }, include: { comments } });
  if (kind === "Problem") return db.problem.findUnique({ where: { importRef }, include: { comments } });
  return db.ticket.findUnique({ where: { importRef }, include: { comments } });
}

/** One write: the changed columns plus the new comments (atomic nested update). */
async function update(kind: Kind, id: number, columns: Record<string, unknown>, rows: ReturnType<typeof commentRows>) {
  const data = { ...columns, ...(rows.length ? { comments: { create: rows } } : {}) } as never;
  if (kind === "Change") return serializeChange(await db.change.update({ where: { id }, data, include: CHANGE_INCLUDE }));
  if (kind === "Problem") return serializeProblem(await db.problem.update({ where: { id }, data, include: PROBLEM_INCLUDE }));
  return serializeTicket(await db.ticket.update({ where: { id }, data, include: { requester: true, assignee: true } }));
}

async function auditCreate(kind: Kind, actorId: string, id: number, importRef: string) {
  await writeAudit({
    userId: actorId,
    action: "CREATE",
    entity: kind,
    entityId: id,
    summary: `Imported from ${importRef} via API`,
    meta: { importRef },
  });
}

const isUniqueViolation = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

const SCHEMAS: Record<Kind, z.ZodType> = { Change: changeImportSchema, Problem: problemImportSchema, Ticket: ticketImportSchema };
const REIMPORT_SCHEMAS: Record<Kind, z.ZodType> = { Change: changeReimportSchema, Problem: problemReimportSchema, Ticket: ticketReimportSchema };

/**
 * POST handler importing one historical record with its thread. 201 when
 * created; 200 with `meta.created: false` when `import_ref` already exists (the
 * existing record is returned unchanged, nothing is overwritten).
 */
export function importHandler(kind: Kind) {
  return async function POST(req: Request) {
    const auth = await importGuard(req);
    if ("response" in auth) return auth.response;
    const parsed = await readBody(req, SCHEMAS[kind]);
    if ("response" in parsed) return parsed.response;
    const b = parsed.data as Body;

    const before = await existing(kind, b.import_ref);
    if (before) return ok(before, { meta: { created: false } });

    const invalid = await validationFailure(b);
    if (invalid) return invalid;

    let created: { id: number; data: unknown };
    try {
      created = await create(kind, b as never, auth.principal.userId);
    } catch (err) {
      // A concurrent import of the same ref won the unique index: report it as existing.
      if (isUniqueViolation(err)) {
        const winner = await existing(kind, b.import_ref);
        if (winner) return ok(winner, { meta: { created: false } });
      }
      throw err;
    }
    await auditCreate(kind, auth.principal.userId, created.id, b.import_ref);
    return ok(created.data, { status: 201, meta: { created: true } });
  };
}

/**
 * PUT handler for the update mode (re-runs of a migration, e.g. at cut-over).
 * Creates the record when `{import_ref}` is new (201, `meta.result: "created"`);
 * otherwise replaces the imported fields with the payload's state and appends
 * the comments the record does not have yet (200, `updated`). A payload that
 * matches the record writes nothing and no audit row (200, `unchanged`).
 * Only records carrying that `importRef` are found, never a native one.
 */
export function reimportHandler(kind: Kind) {
  return async function PUT(req: Request, ctx: { params: Promise<{ import_ref: string }> }) {
    const auth = await importGuard(req);
    if ("response" in auth) return auth.response;
    const ref = importRefFromPath((await ctx.params).import_ref);
    if (!ref) return apiError(422, "Validation failed", { import_ref: ["1-200 characters without surrounding whitespace"] });
    const parsed = await readBody(req, REIMPORT_SCHEMAS[kind]);
    if ("response" in parsed) return parsed.response;
    const sent = parsed.data as Partial<Body>;
    const refErrors = reimportRefErrors(ref, sent.import_ref);
    if (Object.keys(refErrors).length) return apiError(422, "Validation failed", refErrors);
    const b = { ...sent, import_ref: ref } as Body;
    const invalid = await validationFailure(b);
    if (invalid) return invalid;
    const actorId = auth.principal.userId;

    // Two attempts: a concurrent run may create the record (or a ref'd comment) between read and write.
    for (let attempt = 0; ; attempt++) {
      try {
        const current = await stored(kind, ref);
        if (!current) {
          const created = await create(kind, b as never, actorId);
          await auditCreate(kind, actorId, created.id, ref);
          const fields = Object.keys(sent).filter((k) => k !== "import_ref" && k !== "comments");
          return ok(created.data, { status: 201, meta: { result: "created", changed: fields, comments_added: b.comments.length } });
        }

        const columns = reimportColumns(importData(kind, b as never, actorId), b as never);
        const plan = planReimport(b as never, columns, current, current.comments);
        if (Object.keys(plan.errors).length) return apiError(422, "Validation failed", plan.errors);
        if (!plan.data) return ok(await existing(kind, ref), { meta: { result: "unchanged", changed: [], comments_added: 0 } });

        const data = await update(kind, current.id, plan.data, commentRows(plan.comments, actorId));
        await writeAudit({
          userId: actorId,
          action: "UPDATE",
          entity: kind,
          entityId: current.id,
          summary: `Re-imported from ${ref} via API`,
          meta: { importRef: ref, changed: plan.changed, commentsAdded: plan.comments.length },
        });
        return ok(data, { meta: { result: "updated", changed: plan.changed, comments_added: plan.comments.length } });
      } catch (err) {
        if (attempt === 0 && isUniqueViolation(err)) continue;
        throw err;
      }
    }
  };
}
