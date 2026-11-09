import { Readable } from "node:stream";
import { revalidatePath } from "next/cache";
import type { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { guard, ok, apiError, paginate, pageMeta, principalIsAgent, type ApiPrincipal } from "@/lib/api";
import type { ApiResource, ResourceScope, ScopeAccess } from "@/lib/api-scopes";
import { writeAudit } from "@/lib/audit";
import { canActOnTicket } from "@/lib/authz";
import { contentDisposition } from "@/lib/files";
import { checkUploadRate } from "@/lib/rate-limit";
import { storage } from "@/lib/storage";
import { deleteAttachment } from "@/lib/actions/attachments";
import type { AttachmentForeignKey } from "@/lib/attachments";
import { maxUploadBytes, readUploadFile, readUploadForm, storeAttachment } from "@/lib/attachment-upload";
import {
  mayImportHistory,
  mayWriteRecordAttachment,
  parseUploadFields,
  ticketTakesFiles,
  type AttachmentEntity,
  type RecordTargetKind,
} from "@/lib/attachment-rules";
import { changeRef, problemRef, ticketRef } from "@/lib/constants";
import { serializeAttachment } from "./_serializers";
import { agentGuard, asActor, recordId } from "./_itsm";

type Ctx = { params: Promise<{ id: string }> };
type ItemCtx = { params: Promise<{ id: string; attachmentId: string }> };

type TicketFacts = { id: number; status: string; requesterId: string; assigneeId: string | null; groupId: string | null; prefix: string };

/** The parent a request addresses, resolved and visible to the token. */
type Parent = {
  entity: AttachmentEntity;
  /** The id as it appears in the URL (numeric for tickets/changes/problems). */
  id: number | string;
  /** Human name for audit rows, e.g. "INC-0042". */
  label: string;
  /** The attachments of this parent the token may see. */
  where: Prisma.AttachmentWhereInput;
  /** FK columns of a new file on this parent. */
  fk: AttachmentForeignKey;
  /** Console pages to revalidate after a write. */
  paths: string[];
  ticket?: TicketFacts;
};

const RECORD_KIND: Record<Exclude<AttachmentEntity, "tickets">, RecordTargetKind> = {
  changes: "change",
  problems: "problem",
  assets: "asset",
  licenses: "license",
};

const NOT_FOUND: Record<AttachmentEntity, string> = {
  tickets: "Ticket not found",
  changes: "Change not found",
  problems: "Problem not found",
  assets: "Asset not found",
  licenses: "License not found",
};

const SELECT = {
  id: true,
  filename: true,
  mime: true,
  size: true,
  createdAt: true,
  commentId: true,
  importRef: true,
  storageKey: true,
  uploadedById: true,
  uploadedBy: { select: { id: true, name: true, email: true } },
} as const;

/** Files belong to their parent's resource: a token that may write a change may attach to it. */
const RESOURCE: Record<AttachmentEntity, ApiResource> = {
  tickets: "tickets",
  changes: "changes",
  problems: "problems",
  assets: "cmdb",
  licenses: "cmdb",
};

/** Tickets are open to USER tokens (their own); every other parent is agent-only, like its record endpoints. */
function authGuard(entity: AttachmentEntity, req: Request, access: ScopeAccess) {
  const scope = `${RESOURCE[entity]}:${access}` as ResourceScope;
  return entity === "tickets" ? guard(req, scope) : agentGuard(req, scope);
}

/**
 * Resolve the parent and what this token may see of it. A ticket that is not
 * the USER token's own is a 404 (no existence oracle), as on /tickets/{id}; a
 * USER never sees files on internal notes.
 */
async function resolveParent(entity: AttachmentEntity, rawId: string, principal: ApiPrincipal): Promise<Parent | null> {
  if (entity === "tickets") {
    const id = recordId(rawId);
    const t = id
      ? await db.ticket.findUnique({ where: { id }, select: { id: true, status: true, requesterId: true, assigneeId: true, groupId: true, prefix: true } })
      : null;
    if (!t) return null;
    const agent = principalIsAgent(principal);
    if (!agent && t.requesterId !== principal.userId) return null;
    const commentScope = agent ? { ticketId: t.id } : { ticketId: t.id, isInternal: false };
    return {
      entity,
      id: t.id,
      label: ticketRef(t.id, t.prefix),
      where: { OR: [{ ticketId: t.id }, { comment: commentScope }] },
      fk: { ticketId: t.id },
      paths: [`/tickets/${t.id}`, `/portal/tickets/${t.id}`],
      ticket: t,
    };
  }
  if (entity === "changes" || entity === "problems") {
    const id = recordId(rawId);
    if (!id) return null;
    const found =
      entity === "changes"
        ? await db.change.findUnique({ where: { id }, select: { id: true } })
        : await db.problem.findUnique({ where: { id }, select: { id: true } });
    if (!found) return null;
    return entity === "changes"
      ? { entity, id, label: changeRef(id), where: { changeId: id }, fk: { changeId: id }, paths: [`/changes/${id}`] }
      : { entity, id, label: problemRef(id), where: { problemId: id }, fk: { problemId: id }, paths: [`/problems/${id}`] };
  }
  if (entity === "assets") {
    const a = await db.asset.findUnique({ where: { id: rawId }, select: { id: true, name: true } });
    if (!a) return null;
    return { entity, id: a.id, label: `asset "${a.name}"`, where: { assetId: a.id }, fk: { assetId: a.id }, paths: [`/assets/${a.id}`] };
  }
  const l = await db.softwareLicense.findUnique({ where: { id: rawId }, select: { id: true, name: true } });
  if (!l) return null;
  return { entity, id: l.id, label: `license "${l.name}"`, where: { licenseId: l.id }, fk: { licenseId: l.id }, paths: [`/contracts/licenses/${l.id}`] };
}

/**
 * Whether the token may add or remove files here, as a 403 response or null.
 * Tickets: an agent must be allowed to act on the ticket (assignee, member of
 * its group, or MANAGER+ — the rule of the ticket thread); a USER only writes on
 * their own ticket (already ensured by resolveParent). Licenses: MANAGER+.
 */
async function writeRefusal(parent: Parent, principal: ApiPrincipal): Promise<NextResponse | null> {
  if (parent.ticket) {
    if (!principalIsAgent(principal)) return null;
    const allowed = await canActOnTicket({ id: principal.userId, role: principal.role }, parent.ticket);
    return allowed ? null : apiError(403, "Only the assignee, a member of the ticket's group or a manager may change this ticket's files.");
  }
  const kind = RECORD_KIND[parent.entity as Exclude<AttachmentEntity, "tickets">];
  if (mayWriteRecordAttachment(principal.role, kind)) return null;
  return apiError(403, "Only managers can change the files of a license.");
}

function downloadUrl(parent: Parent, attachmentId: string) {
  return `/api/v1/${parent.entity}/${encodeURIComponent(String(parent.id))}/attachments/${encodeURIComponent(attachmentId)}`;
}

/** GET list + POST upload on `/{entity}/{id}/attachments`. */
export function attachmentCollectionHandlers(entity: AttachmentEntity) {
  async function GET(req: Request, ctx: Ctx) {
    const auth = await authGuard(entity, req, "read");
    if ("response" in auth) return auth.response;
    const parent = await resolveParent(entity, (await ctx.params).id, auth.principal);
    if (!parent) return apiError(404, NOT_FOUND[entity]);
    const { page, perPage, skip, take } = paginate(new URL(req.url).searchParams);
    const [total, rows] = await Promise.all([
      db.attachment.count({ where: parent.where }),
      db.attachment.findMany({ where: parent.where, select: SELECT, orderBy: [{ createdAt: "asc" }, { id: "asc" }], skip, take }),
    ]);
    return ok(
      rows.map((r) => serializeAttachment(r, downloadUrl(parent, r.id))),
      { meta: pageMeta(page, perPage, total) },
    );
  }

  /**
   * Upload one file (multipart part `file`). Same intake as the console: the
   * MAX_UPLOAD_MB cap enforced on the stream, the type allow-list with magic
   * bytes, the sanitized name, the per-user UPLOAD_RATE_LIMIT for USER tokens.
   */
  async function POST(req: Request, ctx: Ctx) {
    const auth = await authGuard(entity, req, "write");
    if ("response" in auth) return auth.response;
    const { principal } = auth;
    const agent = principalIsAgent(principal);

    // Portal accounts are throttled before any body is read, like /api/files/upload.
    if (!agent) {
      const limited = checkUploadRate(principal.userId);
      if (limited) {
        const res = apiError(429, "You're uploading too quickly. Please wait a moment and try again.");
        res.headers.set("Retry-After", String(Math.ceil(limited.retryAfterMs / 1000)));
        return res;
      }
    }

    const parent = await resolveParent(entity, (await ctx.params).id, principal);
    if (!parent) return apiError(404, NOT_FOUND[entity]);
    const refused = await writeRefusal(parent, principal);
    if (refused) return refused;

    const maxBytes = await maxUploadBytes();
    const parsed = await readUploadForm(req, maxBytes);
    if ("status" in parsed) return apiError(parsed.status, parsed.message);
    const fields = parseUploadFields(parsed.form.entries(), entity);
    if ("errors" in fields) return apiError(422, "Validation failed", fields.errors);
    const { commentId, createdAt, uploadedById, importRef, isImport } = fields.data;

    // History fields follow the /import/* rule: import:write scope AND an ADMIN owner.
    if (isImport && !mayImportHistory(principal)) {
      return apiError(403, "created_at, uploaded_by_id and import_ref need a token with the 'import:write' scope, owned by an ADMIN.");
    }
    // Re-import: a file already stored under this ref comes back as is (no second copy, no audit row).
    if (importRef) {
      const known = await existingImport(parent, importRef);
      if (known) return known;
    }
    if (uploadedById && !(await db.user.findUnique({ where: { id: uploadedById }, select: { id: true } }))) {
      return apiError(422, "Validation failed", { uploaded_by_id: [`Unknown user: ${uploadedById}`] });
    }
    // A closed ticket takes no new files (console rule); a history import may still add them.
    if (parent.ticket && !isImport && !ticketTakesFiles(parent.ticket.status)) {
      return apiError(409, `This ticket is ${parent.ticket.status.toLowerCase()}; files can no longer be added.`);
    }

    let fk = parent.fk;
    if (commentId && parent.ticket) {
      const c = await db.ticketComment.findUnique({ where: { id: commentId }, select: { ticketId: true, authorId: true, isInternal: true } });
      // A USER only adds files to their own public replies (the portal rule).
      const usable = !!c && c.ticketId === parent.ticket.id && (agent || (c.authorId === principal.userId && !c.isInternal));
      if (!usable) return apiError(422, "Validation failed", { comment_id: [`No comment ${commentId} on this ticket you can attach to.`] });
      // Comment files carry only the comment FK, like the console's (the ticket resolves through it).
      fk = { commentId };
    }

    const file = await readUploadFile(parsed.form.get("file"), maxBytes);
    if ("status" in file) return apiError(file.status, file.message);

    const stored = await storeAttachment(file, {
      uploadedById: uploadedById ?? principal.userId,
      ...(createdAt ? { createdAt } : {}),
      ...(importRef ? { importRef } : {}),
      ...fk,
    });
    if ("status" in stored) {
      // A concurrent upload with the same ref won the unique index: answer with its file.
      const known = importRef ? await existingImport(parent, importRef) : null;
      return known ?? apiError(stored.status, stored.message);
    }

    await writeAudit({
      userId: principal.userId,
      action: "CREATE",
      entity: "Attachment",
      entityId: stored.row.id,
      summary: `${isImport ? "Imported" : "Uploaded"} "${file.safeName}" to ${parent.label} via API`,
      meta: {
        parent: parent.entity,
        parentId: parent.id,
        ...(commentId ? { commentId } : {}),
        ...(isImport ? { import: true } : {}),
        ...(importRef ? { importRef } : {}),
      },
    });
    for (const p of parent.paths) revalidatePath(p);

    const row = await db.attachment.findUniqueOrThrow({ where: { id: stored.row.id }, select: SELECT });
    return ok(serializeAttachment(row, downloadUrl(parent, row.id)), { status: 201, ...(importRef ? { meta: { created: true } } : {}) });
  }

  /**
   * The response for an upload whose `import_ref` is already stored: `200` with
   * that file and `meta.created: false` when it belongs to this parent, `409`
   * when the ref is taken by a file elsewhere, null when the ref is new.
   */
  async function existingImport(parent: Parent, importRef: string): Promise<NextResponse | null> {
    const here = await db.attachment.findFirst({ where: { AND: [{ importRef }, parent.where] }, select: SELECT });
    if (here) return ok(serializeAttachment(here, downloadUrl(parent, here.id)), { status: 200, meta: { created: false } });
    const elsewhere = await db.attachment.findUnique({ where: { importRef }, select: { id: true } });
    if (elsewhere) {
      return apiError(409, "This import_ref already belongs to a file on another record. For a file linked to several records, use one ref per record.");
    }
    return null;
  }

  return { GET, POST };
}

/** GET download + DELETE on `/{entity}/{id}/attachments/{attachment_id}`. */
export function attachmentItemHandlers(entity: AttachmentEntity) {
  /** The attachment, only when it belongs to this parent and the token sees it (else null → 404). */
  async function load(parent: Parent, attachmentId: string) {
    return db.attachment.findFirst({ where: { AND: [{ id: attachmentId }, parent.where] }, select: SELECT });
  }

  /**
   * Stream the stored bytes. Always a download (`attachment`), with the stored
   * canonical type, an RFC 5987 filename and a sandboxing CSP; the storage key
   * is server-generated and never derived from the request.
   */
  async function GET(req: Request, ctx: ItemCtx) {
    const auth = await authGuard(entity, req, "read");
    if ("response" in auth) return auth.response;
    const { id, attachmentId } = await ctx.params;
    const parent = await resolveParent(entity, id, auth.principal);
    if (!parent) return apiError(404, NOT_FOUND[entity]);
    const att = await load(parent, attachmentId);
    if (!att || !att.storageKey) return apiError(404, "Attachment not found");

    let obj;
    try {
      obj = await storage.get(att.storageKey);
    } catch {
      return apiError(404, "Attachment not found");
    }
    return new Response(Readable.toWeb(obj.body) as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": att.mime,
        "Content-Disposition": contentDisposition(att.filename, "attachment"),
        "Content-Length": String(obj.size),
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "private, no-store",
      },
    });
  }

  /**
   * Remove the file and its stored blob, through the console's deleteAttachment
   * (run as the token owner), after the API's own ticket rule: an agent must be
   * allowed to act on the ticket, a USER may only remove their own uploads.
   */
  async function DELETE(req: Request, ctx: ItemCtx) {
    const auth = await authGuard(entity, req, "write");
    if ("response" in auth) return auth.response;
    const { principal } = auth;
    const { id, attachmentId } = await ctx.params;
    const parent = await resolveParent(entity, id, principal);
    if (!parent) return apiError(404, NOT_FOUND[entity]);
    const att = await load(parent, attachmentId);
    if (!att) return apiError(404, "Attachment not found");
    const refused = await writeRefusal(parent, principal);
    if (refused) return refused;
    if (!principalIsAgent(principal) && att.uploadedById !== principal.userId) {
      return apiError(403, "You can only remove files you uploaded.");
    }

    const form = new FormData();
    form.set("id", att.id);
    const result = await asActor(principal, () => deleteAttachment(form));
    if (result && "error" in result && result.error) return apiError(403, result.error);
    return ok({ id: att.id, deleted: true });
  }

  return { GET, DELETE };
}
