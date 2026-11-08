import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, type Role } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { storage } from "@/lib/storage";
import { canUploadTo, type AttachmentForeignKey, type UploadTarget } from "@/lib/attachments";
import { maxUploadBytes, readUploadFile, readUploadForm, storeAttachment } from "@/lib/attachment-upload";
import { extractText } from "@/lib/rag/extract";
import { indexProjectFile } from "@/lib/rag/retrieve";
import { classifyFile } from "@/lib/ai-file-tag";
import { checkUploadRate } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const err = (status: number, message: string) => NextResponse.json({ error: message }, { status });

export async function POST(req: Request) {
  // 1. Session auth, rehydrated from the DB (a deactivated/demoted user must not
  //    keep upload rights on a stale JWT). Never Bearer — files are a browser flow.
  const me = await getCurrentUser();
  if (!me || !me.isActive) return err(401, "Sign in to upload files.");
  const actor = { id: me.id, role: me.role as Role };

  // 1b. Per-user throttle for portal end users (agents bulk-upload into Sable Projects) before any body is read, so a looping client can't
  //     flood storage. The message is shown as-is by the upload UI.
  const limited = me.role === "USER" ? checkUploadRate(me.id) : null;
  if (limited) {
    return NextResponse.json(
      { error: "You're uploading too quickly. Please wait a moment and try again." },
      { status: 429, headers: { "retry-after": String(Math.ceil(limited.retryAfterMs / 1000)) } },
    );
  }

  // 2. Must be multipart, with an ingress cap enforced on the bytes off the wire
  //    BEFORE anything is buffered (memory-DoS guard; see lib/attachment-upload.ts).
  //    The cap is admin-configurable (MAX_UPLOAD_MB in Admin Settings) with the env
  //    default; MAX_UPLOAD_BYTES stays the client-side mirror.
  const maxBytes = await maxUploadBytes();
  const parsed = await readUploadForm(req, maxBytes);
  if ("status" in parsed) return err(parsed.status, parsed.message);
  const form = parsed.form;

  // 3. Parse done: a file + exactly one target discriminator.
  const file = form.get("file");

  const ticketIdRaw = form.get("ticketId");
  const commentId = form.get("commentId");
  const articleId = form.get("articleId");
  const aiProjectId = form.get("aiProjectId");
  const aiProjectFolderId = form.get("aiProjectFolderId");
  const changeIdRaw = form.get("changeId");
  const problemIdRaw = form.get("problemId");
  const assetId = form.get("assetId");
  const licenseId = form.get("licenseId");
  const targets = [ticketIdRaw, commentId, articleId, aiProjectId, changeIdRaw, problemIdRaw, assetId, licenseId].filter((v) => v != null && v !== "");
  // Zero targets = a STAGING upload: the file is stored owned by the uploader with
  // no parent yet, to be re-parented onto a ticket when the (not-yet-created)
  // request form is submitted. Any authenticated user may stage their own files.
  if (targets.length > 1) return err(422, "Provide at most one target.");

  let target: UploadTarget | null = null;
  if (ticketIdRaw != null && ticketIdRaw !== "") {
    const ticketId = Number(ticketIdRaw);
    if (!Number.isInteger(ticketId)) return err(422, "Invalid ticket id.");
    target = { kind: "ticket", ticketId };
  } else if (commentId != null && commentId !== "") {
    target = { kind: "comment", commentId: String(commentId) };
  } else if (articleId != null && articleId !== "") {
    target = { kind: "article", articleId: String(articleId) };
  } else if (aiProjectId != null && aiProjectId !== "") {
    const folderId = aiProjectFolderId != null && aiProjectFolderId !== "" ? String(aiProjectFolderId) : null;
    target = { kind: "aiProject", projectId: String(aiProjectId), folderId };
  } else if (changeIdRaw != null && changeIdRaw !== "") {
    const changeId = Number(changeIdRaw);
    if (!Number.isInteger(changeId)) return err(422, "Invalid change id.");
    target = { kind: "change", changeId };
  } else if (problemIdRaw != null && problemIdRaw !== "") {
    const problemId = Number(problemIdRaw);
    if (!Number.isInteger(problemId)) return err(422, "Invalid problem id.");
    target = { kind: "problem", problemId };
  } else if (assetId != null && assetId !== "") {
    target = { kind: "asset", assetId: String(assetId) };
  } else if (licenseId != null && licenseId !== "") {
    target = { kind: "license", licenseId: String(licenseId) };
  }

  // 4. Size, mime allow-list, ext↔mime and magic bytes. Uses the CANONICAL mime
  //    + sanitized name; the client-declared type is ignored.
  const v = await readUploadFile(file, maxBytes);
  if ("status" in v) return err(v.status, v.message);

  // 5. Authorize the write (null → 404, after validation, so no exists-but-forbidden leak).
  //    Staging uploads (no target) are owned by the uploader and carry no FK.
  let fk: AttachmentForeignKey = {};
  if (target) {
    const resolved = await canUploadTo(actor, target);
    if (!resolved) return err(404, "Not found.");
    fk = resolved;
  }

  // 6. Store the blob (server-generated, unguessable, traversal-free key) and
  //    persist the row; the blob is rolled back when the row cannot be created.
  const stored = await storeAttachment(v, { uploadedById: me.id, ...fk });
  if ("status" in stored) return err(stored.status, stored.message);
  const { row: att, storageKey: key } = stored;

  await writeAudit({ userId: me.id, action: "CREATE", entity: "Attachment", entityId: att.id, summary: `Uploaded "${v.safeName}"` });

  // 7. Project-library uploads: create the AiProjectFile join row, extract text
  //    for retrieval, and index it. Roll back the blob + attachment on failure so
  //    we never leave an orphan Attachment the project can't see.
  if (target?.kind === "aiProject") {
    let projFile;
    try {
      projFile = await db.aiProjectFile.create({
        data: { projectId: target.projectId, folderId: target.folderId ?? null, attachmentId: att.id, name: v.safeName },
        select: { id: true },
      });
    } catch {
      await db.attachment.deleteMany({ where: { id: att.id } }).catch(() => {});
      await storage.delete(key).catch(() => {});
      return err(409, "Could not attach the file to the project.");
    }

    // Best-effort text extraction + indexing — a failure here must not fail the
    // upload (the file is still stored and listed; it just won't be searchable).
    let extracted = "";
    try {
      extracted = await extractText(v.buf, v.mime, v.safeName);
      await db.aiProjectFile.update({ where: { id: projFile.id }, data: { extractedText: extracted } });
      await indexProjectFile(projFile.id);
    } catch {
      // swallow — retrieval degrades gracefully
    }

    // Content tag classification reuses any extracted text (AI refinement when
    // configured; heuristic otherwise, e.g. images). Best-effort — never fail
    // the upload.
    try {
      const tag = await classifyFile({ name: v.safeName, mime: v.mime, text: extracted });
      await db.aiProjectFile.update({ where: { id: projFile.id }, data: { tag } });
    } catch {
      // swallow — tagging is non-essential
    }
  }

  // 8. Never expose storageKey/checksum/paths.
  return NextResponse.json(att, { status: 201 });
}
