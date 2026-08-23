import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, type Role } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { validateUpload } from "@/lib/files";
import { buildStorageKey, storage } from "@/lib/storage";
import { canUploadTo, type UploadTarget } from "@/lib/attachments";
import { getNumberSetting } from "@/lib/settings";
import { extractText } from "@/lib/rag/extract";
import { indexProjectFile } from "@/lib/rag/retrieve";
import { classifyFile } from "@/lib/ai-file-tag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const err = (status: number, message: string) => NextResponse.json({ error: message }, { status });

/** Raised when the streamed request body crosses the ingress cap. */
class PayloadTooLargeError extends Error {
  constructor() {
    super("request body exceeds the upload cap");
    this.name = "PayloadTooLargeError";
  }
}

/**
 * Wrap the raw request stream in a counting TransformStream that errors as soon
 * as more than `cap` bytes flow through. This bounds RAM use BEFORE req.formData()
 * would otherwise buffer an unbounded multipart body (memory-DoS guard).
 */
function cappedBodyStream(body: ReadableStream<Uint8Array>, cap: number) {
  let total = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > cap) throw new PayloadTooLargeError();
        controller.enqueue(chunk);
      },
    }),
  );
}

export async function POST(req: Request) {
  // 1. Session auth, rehydrated from the DB (a deactivated/demoted user must not
  //    keep upload rights on a stale JWT). Never Bearer — files are a browser flow.
  const me = await getCurrentUser();
  if (!me || !me.isActive) return err(401, "Sign in to upload files.");
  const actor = { id: me.id, role: me.role as Role };

  // 2. Must be multipart.
  if (!(req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    return err(415, "Expected multipart/form-data.");
  }

  // 2b. Ingress cap BEFORE buffering the body (memory-DoS guard). +1MB slack for
  //     multipart overhead; the real per-file cap is re-checked after parsing.
  //     Cap is admin-configurable (MAX_UPLOAD_MB in Admin Settings) with the env
  //     default; MAX_UPLOAD_BYTES stays the client-side mirror.
  const maxBytes = (await getNumberSetting("MAX_UPLOAD_MB", 15)) * 1024 * 1024;
  const ingressCap = maxBytes + 1024 * 1024;
  // Early reject when the client declares an over-cap length. Not trusted on its
  // own — chunked uploads omit content-length, so 2c enforces the cap on bytes.
  const declaredLen = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLen) && declaredLen > ingressCap) {
    return err(413, "File is too large.");
  }

  // 2c. Hard byte cap on the actual stream: count every chunk off the wire and
  //     abort the moment the cap is crossed, instead of letting req.formData()
  //     buffer a body of any size into RAM first.
  let form: FormData;
  try {
    if (!req.body) throw new PayloadTooLargeError();
    const cappedReq = new Request(req.url, {
      method: "POST",
      headers: { "content-type": req.headers.get("content-type") ?? "" },
      body: cappedBodyStream(req.body, ingressCap),
      duplex: "half",
    } as RequestInit);
    form = await cappedReq.formData();
  } catch (e) {
    if (e instanceof PayloadTooLargeError || String((e as Error)?.message ?? "").includes("exceeds the upload cap")) {
      return err(413, "File is too large.");
    }
    return err(422, "Could not parse the upload.");
  }
  // 3. Parse done: a file + exactly one target discriminator.
  const file = form.get("file");
  if (!(file instanceof File)) return err(422, "No file provided.");

  const ticketIdRaw = form.get("ticketId");
  const commentId = form.get("commentId");
  const articleId = form.get("articleId");
  const aiProjectId = form.get("aiProjectId");
  const aiProjectFolderId = form.get("aiProjectFolderId");
  const targets = [ticketIdRaw, commentId, articleId, aiProjectId].filter((v) => v != null && v !== "");
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
  }

  // 4. Size pre-check before reading bytes.
  if (file.size > maxBytes) return err(413, "File is too large.");

  // 5. Read bytes.
  const buf = Buffer.from(await file.arrayBuffer());

  // 6. Validate (size again, mime allow-list, ext↔mime, magic bytes). Use the
  //    CANONICAL mime + sanitized name; ignore the client-declared type.
  const v = validateUpload(file.name, file.type, buf, maxBytes);
  if (!v.ok) {
    const map: Record<string, number> = { TOO_LARGE: 413, EMPTY: 422, MIME_NOT_ALLOWED: 415, EXT_MISMATCH: 415, MAGIC_MISMATCH: 415 };
    return err(map[v.code] ?? 400, "This file type is not allowed.");
  }

  // 7. Authorize the write (null → 404, after validation, so no exists-but-forbidden leak).
  //    Staging uploads (no target) are owned by the uploader and carry no FK.
  let fk: { ticketId?: number; commentId?: string; articleId?: string } = {};
  if (target) {
    const resolved = await canUploadTo(actor, target);
    if (!resolved) return err(404, "Not found.");
    fk = resolved;
  }

  // 8. Store the blob (server-generated, unguessable, traversal-free key).
  const key = buildStorageKey(v.safeName);
  let stored;
  try {
    stored = await storage.put(key, buf);
  } catch {
    return err(400, "Could not store the file.");
  }
  const { size, checksum } = stored;

  // 9. Persist the row; roll back the blob on a create failure (FK race).
  let att;
  try {
    att = await db.attachment.create({
      data: { filename: v.safeName, storageKey: key, mime: v.mime, size, checksum, uploadedById: me.id, ...fk },
      select: { id: true, filename: true, mime: true, size: true },
    });
  } catch {
    await storage.delete(key).catch(() => {});
    return err(409, "Could not attach the file.");
  }

  await writeAudit({ userId: me.id, action: "CREATE", entity: "Attachment", entityId: att.id, summary: `Uploaded "${v.safeName}"` });

  // 10. Project-library uploads: create the AiProjectFile join row, extract text
  //     for retrieval, and index it. Roll back the blob + attachment on failure so
  //     we never leave an orphan Attachment the project can't see.
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
      extracted = await extractText(buf, v.mime, v.safeName);
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

  // 11. Never expose storageKey/checksum/paths.
  return NextResponse.json(att, { status: 201 });
}
