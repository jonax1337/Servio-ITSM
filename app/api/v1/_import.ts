import { Prisma } from "@prisma/client";
import type { z } from "zod";
import { db } from "@/lib/db";
import { guard, ok, apiError, requireScope } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { prefixForType } from "@/lib/constants";
import {
  changeImportData,
  changeImportSchema,
  importCommentRows,
  importTimelineErrors,
  problemImportData,
  problemImportSchema,
  referencedUserIds,
  ticketImportData,
  ticketImportSchema,
} from "@/lib/api-import-input";
import { CHANGE_INCLUDE, PROBLEM_INCLUDE, serializeChange, serializeProblem, serializeTicket } from "./_serializers";
import { readBody } from "./_itsm";

type Kind = "Ticket" | "Problem" | "Change";

/**
 * History import is the one place the API writes past the lifecycle rules, so it
 * needs both the `admin` scope (not just `write`) and a token owned by an ADMIN.
 */
async function importGuard(req: Request) {
  const auth = await guard(req, "write");
  if ("response" in auth) return auth;
  if (!requireScope(auth.principal, "admin") || auth.principal.role !== "ADMIN") {
    return { response: apiError(403, "History import needs a token with the 'admin' scope, owned by an ADMIN.") };
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

async function create(kind: Kind, b: never, actorId: string) {
  const comments = { create: importCommentRows(b, actorId) };
  if (kind === "Change") {
    const c = await db.change.create({ data: { ...changeImportData(b, actorId), comments }, include: CHANGE_INCLUDE });
    return { id: c.id, data: serializeChange(c) };
  }
  if (kind === "Problem") {
    const p = await db.problem.create({ data: { ...problemImportData(b), comments }, include: PROBLEM_INCLUDE });
    return { id: p.id, data: serializeProblem(p) };
  }
  const tb = b as { type: string };
  const t = await db.ticket.create({
    data: { ...ticketImportData(b, actorId, prefixForType(tb.type)), comments },
    include: { requester: true, assignee: true },
  });
  return { id: t.id, data: serializeTicket(t) };
}

const SCHEMAS: Record<Kind, z.ZodType> = { Change: changeImportSchema, Problem: problemImportSchema, Ticket: ticketImportSchema };

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
    const b = parsed.data as Record<string, unknown> & { import_ref: string };

    const before = await existing(kind, b.import_ref);
    if (before) return ok(before, { meta: { created: false } });

    const timeline = importTimelineErrors(b as never);
    if (Object.keys(timeline).length) return apiError(422, "Validation failed", timeline);
    const refs = await unknownReferences(b, referencedUserIds(b as never));
    if (Object.keys(refs).length) return apiError(422, "Validation failed", refs);

    let created: { id: number; data: unknown };
    try {
      created = await create(kind, b as never, auth.principal.userId);
    } catch (err) {
      // A concurrent import of the same ref won the unique index: report it as existing.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const winner = await existing(kind, b.import_ref);
        if (winner) return ok(winner, { meta: { created: false } });
      }
      throw err;
    }
    await writeAudit({
      userId: auth.principal.userId,
      action: "CREATE",
      entity: kind,
      entityId: created.id,
      summary: `Imported from ${b.import_ref} via API`,
      meta: { importRef: b.import_ref },
    });
    return ok(created.data, { status: 201, meta: { created: true } });
  };
}
