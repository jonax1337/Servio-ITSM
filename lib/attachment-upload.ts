// Upload intake shared by the console route (app/api/files/upload) and the REST
// API (app/api/v1/*/attachments): the capped multipart parse, the allow-list
// validation and the blob + row write. Node runtime only (storage, db).
import { db } from "@/lib/db";
import { UPLOAD_ERROR_STATUS, validateUpload } from "@/lib/files";
import { buildStorageKey, storage } from "@/lib/storage";
import { getNumberSetting } from "@/lib/settings";

/** The admin-configurable per-file cap (Admin Settings → MAX_UPLOAD_MB, env default). */
export async function maxUploadBytes(): Promise<number> {
  return (await getNumberSetting("MAX_UPLOAD_MB", 15)) * 1024 * 1024;
}

/** Raised when the streamed request body crosses the ingress cap. */
class PayloadTooLargeError extends Error {
  constructor() {
    super("request body exceeds the upload cap");
    this.name = "PayloadTooLargeError";
  }
}

/**
 * Wrap the raw request stream in a counting TransformStream that errors as soon
 * as more than `cap` bytes flow through. This bounds RAM use BEFORE formData()
 * would otherwise buffer an unbounded multipart body (memory-DoS guard).
 */
function cappedBodyStream(body: ReadableStream<Uint8Array>, cap: number) {
  const seen = { total: 0 };
  const stream = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen.total += chunk.byteLength;
        if (seen.total > cap) throw new PayloadTooLargeError();
        controller.enqueue(chunk);
      },
    }),
  );
  return { stream, seen };
}

export type UploadRefusal = { status: number; message: string };

/**
 * Parse a multipart upload without ever buffering more than the cap: 415 when
 * the body is not multipart, 413 when the declared or the actual body exceeds
 * `maxBytes` (+1 MB multipart slack), 422 when it cannot be parsed.
 */
export async function readUploadForm(req: Request, maxBytes: number): Promise<{ form: FormData } | UploadRefusal> {
  if (!(req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    return { status: 415, message: "Expected multipart/form-data." };
  }
  const ingressCap = maxBytes + 1024 * 1024;
  // Early reject when the client declares an over-cap length. Not trusted on its
  // own — chunked uploads omit content-length, so the stream cap enforces bytes.
  const declaredLen = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLen) && declaredLen > ingressCap) return { status: 413, message: "File is too large." };
  let seen = { total: 0 };
  try {
    if (!req.body) throw new PayloadTooLargeError();
    const capped = cappedBodyStream(req.body, ingressCap);
    seen = capped.seen;
    const cappedReq = new Request(req.url, {
      method: "POST",
      headers: { "content-type": req.headers.get("content-type") ?? "" },
      body: capped.stream,
      duplex: "half",
    } as RequestInit);
    return { form: await cappedReq.formData() };
  } catch (e) {
    if (e instanceof PayloadTooLargeError || String((e as Error)?.message ?? "").includes("exceeds the upload cap")) {
      return { status: 413, message: "File is too large." };
    }
    // Fewer bytes arrived than the client declared: the body was cut short on the
    // way in — Next.js buffers request bodies for proxy.ts only up to
    // `proxyClientMaxBodySize` (10 MB by default) and silently drops the rest.
    if (declaredLen > 0 && seen.total < declaredLen) {
      return { status: 413, message: "File is too large for this server's request body limit." };
    }
    return { status: 422, message: "Could not parse the upload." };
  }
}

export type ValidatedFile = { buf: Buffer; safeName: string; mime: string };

/**
 * Read and validate the `file` part: size, mime allow-list, extension and magic
 * bytes. Returns the CANONICAL mime and the sanitized name, never the
 * client-declared ones.
 */
export async function readUploadFile(file: FormDataEntryValue | null, maxBytes: number): Promise<ValidatedFile | UploadRefusal> {
  if (!(file instanceof File)) return { status: 422, message: "No file provided." };
  if (file.size > maxBytes) return { status: 413, message: "File is too large." };
  const buf = Buffer.from(await file.arrayBuffer());
  const v = validateUpload(file.name, file.type, buf, maxBytes);
  if (!v.ok) {
    const status = UPLOAD_ERROR_STATUS[v.code] ?? 400;
    const message = status === 413 ? "File is too large." : v.code === "EMPTY" ? "The file is empty." : "This file type is not allowed.";
    return { status, message };
  }
  return { buf, safeName: v.safeName, mime: v.mime };
}

/** The Attachment columns a caller may set besides the blob facts. */
export type AttachmentRowData = {
  uploadedById: string;
  createdAt?: Date;
  importRef?: string;
  ticketId?: number;
  commentId?: string;
  articleId?: string;
  changeId?: number;
  problemId?: number;
  assetId?: string;
  licenseId?: string;
};

/**
 * Store the blob under a server-generated, unguessable, traversal-free key and
 * create its Attachment row. The blob is removed again when the row cannot be
 * created (e.g. the parent was deleted in between), so no orphan is left.
 */
export async function storeAttachment(
  file: ValidatedFile,
  data: AttachmentRowData,
): Promise<{ row: { id: string; filename: string; mime: string; size: number }; storageKey: string } | UploadRefusal> {
  const key = buildStorageKey(file.safeName);
  let stored;
  try {
    stored = await storage.put(key, file.buf);
  } catch {
    return { status: 400, message: "Could not store the file." };
  }
  try {
    const row = await db.attachment.create({
      data: { filename: file.safeName, storageKey: key, mime: file.mime, size: stored.size, checksum: stored.checksum, ...data },
      select: { id: true, filename: true, mime: true, size: true },
    });
    return { row, storageKey: key };
  } catch {
    await storage.delete(key).catch(() => {});
    return { status: 409, message: "Could not attach the file." };
  }
}
