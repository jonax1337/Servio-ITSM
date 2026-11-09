import { db } from "@/lib/db";
import { apiError, ok, preflight } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { AUTOMATION_EMAIL } from "@/lib/system-user";
import { userPatchSchema } from "@/lib/api-user-input";
import { normalizeSecondaryEmails } from "@/lib/user-email-rules";
import { EMAIL_TAKEN, replaceSecondaryEmails } from "@/lib/user-emails";
import { agentGuard, readBody } from "../../_itsm";
import { USER_SELECT, serializeUser } from "../../_users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight();
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "directory:read");
  if ("response" in auth) return auth.response;
  const { id } = await ctx.params;
  const user = await db.user.findUnique({ where: { id }, select: USER_SELECT });
  if (!user) return apiError(404, "User not found");
  return ok(serializeUser(user));
}

/** True when a write failed on a unique index (lost a race for the same address). */
const isUniqueViolation = (e: unknown) => typeof e === "object" && e !== null && "code" in e && e.code === "P2002";

/**
 * Replace a person's secondary email addresses. Managing people is an admin
 * task in the console, so the token must belong to an ADMIN (403 otherwise).
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "directory:write");
  if ("response" in auth) return auth.response;
  if (auth.principal.role !== "ADMIN") return apiError(403, "Managing people needs a token owned by an ADMIN.");
  const { id } = await ctx.params;
  const target = await db.user.findUnique({ where: { id }, select: { id: true, email: true } });
  if (!target || target.email === AUTOMATION_EMAIL) return apiError(404, "User not found");
  const body = await readBody(req, userPatchSchema);
  if ("response" in body) return body.response;

  const parsed = normalizeSecondaryEmails(body.data.secondary_emails, target.email);
  if (!parsed.ok) return apiError(422, "Validation failed", { secondary_emails: [parsed.error] });
  let replaced;
  try {
    replaced = await replaceSecondaryEmails(id, parsed.emails);
  } catch (e) {
    if (isUniqueViolation(e)) return apiError(409, EMAIL_TAKEN);
    throw e;
  }
  if (!replaced.ok) return apiError(409, replaced.error, { email: replaced.email });

  if (replaced.added.length || replaced.removed.length) {
    await writeAudit({
      userId: auth.principal.userId,
      action: "UPDATE",
      entity: "User",
      entityId: id,
      summary: "Edited profile via API: secondaryEmails",
      meta: { secondaryAdded: replaced.added, secondaryRemoved: replaced.removed },
    });
  }
  const user = await db.user.findUniqueOrThrow({ where: { id }, select: USER_SELECT });
  return ok(serializeUser(user));
}
