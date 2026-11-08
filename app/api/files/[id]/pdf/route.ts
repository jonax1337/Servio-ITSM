import { db } from "@/lib/db";
import { getCurrentUser, type Role } from "@/lib/session";
import { storage } from "@/lib/storage";
import { ATTACHMENT_ACCESS_SELECT, canViewAttachment } from "@/lib/attachments";
import { convertOfficeToPdf, isPdfConvertible } from "@/lib/office-convert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Same cap as the preview route — don't buffer a huge blob to hand to the converter.
const MAX_RENDER_BYTES = 25 * 1024 * 1024;

/**
 * High-fidelity office → PDF preview. Authorised exactly like the raw file route,
 * then converts the document to PDF via Gotenberg (when `GOTENBERG_URL` is set)
 * and streams it inline for the lightbox's <iframe>. Returns 204 when the file
 * isn't convertible or Gotenberg isn't configured/fails — the client then falls
 * back to the built-in HTML/text preview.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id) return new Response("Not found", { status: 404 });

  const att = await db.attachment.findUnique({
    where: { id },
    select: {
      storageKey: true,
      filename: true,
      mime: true,
      size: true,
      ...ATTACHMENT_ACCESS_SELECT,
    },
  });
  if (!att) return new Response("Not found", { status: 404 });

  const dbUser = await getCurrentUser();
  const actor = dbUser && dbUser.isActive ? { id: dbUser.id, role: dbUser.role as Role } : null;
  if (!(await canViewAttachment(actor, { ...att, id }))) {
    return new Response("Not found", { status: 404 });
  }

  const ext = att.filename.includes(".") ? att.filename.split(".").pop()!.toLowerCase() : "";
  if (!isPdfConvertible(att.mime, ext)) return new Response(null, { status: 204 });
  if (!att.storageKey || att.size > MAX_RENDER_BYTES) return new Response(null, { status: 204 });

  let obj;
  try {
    obj = await storage.get(att.storageKey);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  let buf: Buffer;
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of obj.body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    buf = Buffer.concat(chunks);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const pdf = await convertOfficeToPdf(buf, att.filename);
  if (!pdf) return new Response(null, { status: 204 });

  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
