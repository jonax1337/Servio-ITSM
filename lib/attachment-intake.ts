import { db } from "@/lib/db";
import { validateUpload } from "@/lib/files";
import { buildStorageKey, storage } from "@/lib/storage";
import { getExtraUploadExtensions, getNumberSetting } from "@/lib/settings";

/**
 * Server-side intake for inline `data:` attachments the assistant chat runtimes
 * carry (assistant-ui inlines files for vision but never stages an upload). Both
 * the ephemeral portal (link straight to a just-created ticket) and the console
 * (stage now, link on approval) decode + RE-VALIDATE files here with the exact
 * same allow-list, magic-byte and size checks as `/api/files/upload`, so nothing
 * bypasses upload security just because it came through the chat.
 */

export type IntakeFile = { name: string; type: string; dataUrl: string };

type UploadLimits = { maxBytes: number; extraExtensions: string[] };

async function uploadLimits(): Promise<UploadLimits> {
  const [maxMb, extraExtensions] = await Promise.all([getNumberSetting("MAX_UPLOAD_MB", 15), getExtraUploadExtensions()]);
  return { maxBytes: maxMb * 1024 * 1024, extraExtensions };
}

/**
 * Decode one data-URL file, re-validate it, store the blob, and create an
 * Attachment row owned by `userId` with the given foreign key (none = a staged
 * upload). Returns the new attachment id, or null if the file was rejected.
 */
async function storeDataUrl(
  userId: string,
  file: IntakeFile,
  fk: { ticketId?: number },
  limits: UploadLimits,
): Promise<string | null> {
  if (!file?.dataUrl?.startsWith("data:")) return null;
  const comma = file.dataUrl.indexOf(",");
  if (comma < 0) return null;

  const meta = file.dataUrl.slice(5, comma); // between "data:" and ","
  const isB64 = meta.includes(";base64");
  const declaredMime = (meta.split(";")[0] || file.type || "").trim();

  let buf: Buffer;
  try {
    buf = isB64
      ? Buffer.from(file.dataUrl.slice(comma + 1), "base64")
      : Buffer.from(decodeURIComponent(file.dataUrl.slice(comma + 1)), "utf8");
  } catch {
    return null;
  }

  // Pasted screenshots often arrive with an extension-less name ("image"); give
  // them one from the mime subtype so the upload ext-check can pass.
  let name = file.name || "attachment";
  if (!/\.[A-Za-z0-9]{1,8}$/.test(name)) {
    const sub = declaredMime.split("/")[1]?.split("+")[0];
    if (sub) name = `${name}.${sub === "jpeg" ? "jpg" : sub}`;
  }

  const v = validateUpload(name, declaredMime, buf, limits.maxBytes, limits.extraExtensions);
  if (!v.ok) return null;

  const key = buildStorageKey(v.safeName);
  let stored;
  try {
    stored = await storage.put(key, buf);
  } catch {
    return null;
  }
  try {
    const row = await db.attachment.create({
      data: {
        filename: v.safeName,
        storageKey: key,
        mime: v.mime,
        size: stored.size,
        checksum: stored.checksum,
        uploadedById: userId,
        ...fk,
      },
      select: { id: true },
    });
    return row.id;
  } catch {
    await storage.delete(key).catch(() => {});
    return null;
  }
}

/**
 * Store data-URL files as STAGED attachments (no parent) owned by the user and
 * return their ids. Used by the console assistant: the ticket doesn't exist yet
 * (it's created when the human approves the proposal), so the files are staged
 * now and re-parented onto the ticket at approval time via linkStagedAttachments.
 */
export async function stageDataUrls(userId: string, files: IntakeFile[]): Promise<string[]> {
  const list = (files ?? []).slice(0, 10);
  if (list.length === 0) return [];
  const limits = await uploadLimits();
  const ids: string[] = [];
  for (const f of list) {
    const id = await storeDataUrl(userId, f, {}, limits);
    if (id) ids.push(id);
  }
  return ids;
}

/**
 * Store data-URL files linked directly to an existing ticket. Used by the
 * ephemeral portal assistant, whose ticket IS created at confirm time. A single
 * bad attachment is skipped, never fatal to the ticket.
 */
export async function attachDataUrlsToTicket(
  userId: string,
  ticketId: number,
  files: IntakeFile[],
): Promise<void> {
  const list = (files ?? []).slice(0, 10);
  if (list.length === 0) return;
  const limits = await uploadLimits();
  for (const f of list) {
    await storeDataUrl(userId, f, { ticketId }, limits);
  }
}

/**
 * Best-effort delete of the user's OWN still-unparented staged attachments — used
 * to clean up files that were staged for a turn but never linked (the model
 * proposed nothing, or the attachment was deemed irrelevant).
 */
export async function deleteStagedAttachments(userId: string, ids: string[]): Promise<void> {
  const clean = (ids ?? []).filter(Boolean);
  if (clean.length === 0) return;
  const rows = await db.attachment.findMany({
    where: { id: { in: clean }, uploadedById: userId, ticketId: null, commentId: null, articleId: null },
    select: { id: true, storageKey: true },
  });
  if (rows.length === 0) return;
  await db.attachment.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  for (const r of rows) {
    if (r.storageKey) await storage.delete(r.storageKey).catch(() => {});
  }
}
