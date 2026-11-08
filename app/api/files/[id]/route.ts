import { Readable } from "node:stream";
import { db } from "@/lib/db";
import { getCurrentUser, type Role } from "@/lib/session";
import { storage } from "@/lib/storage";
import { ATTACHMENT_ACCESS_SELECT, canViewAttachment } from "@/lib/attachments";
import { contentDisposition } from "@/lib/files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Never render these inline, even if somehow stored — force a safe download type.
const UNSAFE_INLINE = /^(text\/html|image\/svg|application\/(xhtml\+xml|xml|javascript|ecmascript))/i;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!id) return new Response("Not found", { status: 404 });

  const sp = new URL(req.url).searchParams;
  const wantsInline = sp.get("inline") === "1" || sp.get("disposition") === "inline";

  const att = await db.attachment.findUnique({
    where: { id },
    select: { storageKey: true, filename: true, mime: true, size: true, ...ATTACHMENT_ACCESS_SELECT },
  });
  if (!att) return new Response("Not found", { status: 404 });

  // Rehydrate from the DB; a deactivated user is treated as anonymous.
  const dbUser = await getCurrentUser();
  const actor = dbUser && dbUser.isActive ? { id: dbUser.id, role: dbUser.role as Role } : null;
  // 404 (not 403) on deny — no IDOR existence oracle. Pass the id so the check can
  // resolve a project-library file (AiProjectFile.attachmentId) that has no FK.
  if (!(await canViewAttachment(actor, { ...att, id }))) return new Response("Not found", { status: 404 });

  // Download route serves stored blobs only — never fetches att.url (no SSRF surface).
  if (!att.storageKey) return new Response("Not found", { status: 404 });

  let obj;
  try {
    obj = await storage.get(att.storageKey);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  // UNSAFE_INLINE mimes are always forced to a safe octet-stream download,
  // even when ?inline=1 is requested — they must never render inline.
  const unsafe = UNSAFE_INLINE.test(att.mime);
  const contentType = unsafe ? "application/octet-stream" : att.mime;
  const disposition: "attachment" | "inline" = wantsInline && !unsafe ? "inline" : "attachment";

  return new Response(Readable.toWeb(obj.body) as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": contentDisposition(att.filename, disposition),
      "Content-Length": String(att.size),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
}
