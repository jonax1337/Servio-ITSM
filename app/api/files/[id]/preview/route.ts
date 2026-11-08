import { db } from "@/lib/db";
import { getCurrentUser, type Role } from "@/lib/session";
import { storage } from "@/lib/storage";
import { ATTACHMENT_ACCESS_SELECT, canViewAttachment } from "@/lib/attachments";
import { renderFileHtml } from "@/lib/rag/render";
import { gotenbergConfigured, isPdfConvertible } from "@/lib/office-convert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hard cap on the raw blob we're willing to buffer + render (avoids OOM on a huge
// spreadsheet). Larger files fall back to download in the client.
const MAX_RENDER_BYTES = 25 * 1024 * 1024;

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

  // Same actor rehydration + deny-as-404 as app/api/files/[id]/route.ts. Pass the id
  // so the check can resolve a project-library file (AiProjectFile.attachmentId).
  const dbUser = await getCurrentUser();
  const actor = dbUser && dbUser.isActive ? { id: dbUser.id, role: dbUser.role as Role } : null;
  if (!(await canViewAttachment(actor, { ...att, id }))) {
    return new Response("Not found", { status: 404 });
  }

  if (!att.storageKey) return new Response("Not found", { status: 404 });
  if (att.size > MAX_RENDER_BYTES) return new Response(null, { status: 204 });

  // High-fidelity path: when a Gotenberg service is configured, render office
  // documents (docx/pptx/legacy/ODF) via a faithful PDF the lightbox embeds in an
  // iframe, instead of the best-effort HTML/text below. Point the client at the
  // sibling /pdf route (which does the actual conversion).
  const ext = att.filename.includes(".") ? att.filename.split(".").pop()!.toLowerCase() : "";
  if (isPdfConvertible(att.mime, ext) && (await gotenbergConfigured())) {
    return new Response(JSON.stringify({ pdf: `/api/files/${encodeURIComponent(id)}/pdf` }), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  }

  let obj;
  try {
    obj = await storage.get(att.storageKey);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  // Buffer the blob (Node stream → Buffer) so the converters can read it.
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

  let rendered;
  try {
    rendered = await renderFileHtml({ mime: att.mime, name: att.filename, buf });
  } catch {
    return new Response(null, { status: 204 });
  }

  // Nothing rich to render (image/pdf/audio/video/unsupported) → no content; the
  // client handles those natively or falls back to download.
  if (rendered.kind !== "html") return new Response(null, { status: 204 });

  return new Response(JSON.stringify({ html: rendered.html }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
}
