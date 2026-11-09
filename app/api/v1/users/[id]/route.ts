import { db } from "@/lib/db";
import { apiError, ok, preflight } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { AUTOMATION_EMAIL } from "@/lib/system-user";
import { userPatchSchema } from "@/lib/api-user-input";
import { normalizeSecondaryEmails } from "@/lib/user-email-rules";
import { resolveAccountFlags } from "@/lib/service-accounts";
import { applyAccountFlags } from "@/lib/user-accounts";
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
 * Edit a person: replace the secondary email addresses (`secondary_emails`) and / or set the
 * account type (`service_account`, `can_approve_changes`). Fields left out stay as they are.
 * Managing people is an admin task in the console, so the token must belong to an ADMIN (403
 * otherwise). Changing the account type never touches approvals already in progress.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await agentGuard(req, "directory:write");
  if ("response" in auth) return auth.response;
  if (auth.principal.role !== "ADMIN") return apiError(403, "Managing people needs a token owned by an ADMIN.");
  const { id } = await ctx.params;
  const target = await db.user.findUnique({
    where: { id },
    select: { id: true, email: true, isServiceAccount: true, canApproveChanges: true },
  });
  if (!target || target.email === AUTOMATION_EMAIL) return apiError(404, "User not found");
  const body = await readBody(req, userPatchSchema);
  if ("response" in body) return body.response;

  const next = { isServiceAccount: body.data.service_account, canApproveChanges: body.data.can_approve_changes };
  const check = resolveAccountFlags(target, next);
  if (!check.ok) return apiError(422, "Validation failed", { can_approve_changes: [check.error] });
  let emails: string[] | undefined;
  if (body.data.secondary_emails !== undefined) {
    const parsed = normalizeSecondaryEmails(body.data.secondary_emails, target.email);
    if (!parsed.ok) return apiError(422, "Validation failed", { secondary_emails: [parsed.error] });
    emails = parsed.emails;
  }

  let added: string[] = [];
  let removed: string[] = [];
  let account: { changed: string[]; openSeats: number } = { changed: [], openSeats: 0 };
  try {
    // One transaction: a refused address leaves the account type untouched, and the other way round.
    const done = await db.$transaction(async (tx) => {
      const replaced = emails === undefined ? { ok: true as const, added: [] as string[], removed: [] as string[] } : await replaceSecondaryEmails(id, emails, tx);
      if (!replaced.ok) return { replaced };
      const flags = await applyAccountFlags(id, next, tx);
      if (!flags.ok) throw new Error(flags.error); // checked above; throwing rolls the edit back
      return { replaced, flags };
    });
    if (!done.replaced.ok) return apiError(409, done.replaced.error, { email: done.replaced.email });
    ({ added, removed } = done.replaced);
    if (done.flags) account = done.flags;
  } catch (e) {
    if (isUniqueViolation(e)) return apiError(409, EMAIL_TAKEN);
    throw e;
  }

  const changed = [...(added.length || removed.length ? ["secondaryEmails"] : []), ...account.changed];
  if (changed.length > 0) {
    await writeAudit({
      userId: auth.principal.userId,
      action: "UPDATE",
      entity: "User",
      entityId: id,
      summary: `Edited profile via API: ${changed.join(", ")}`,
      meta: {
        ...(added.length || removed.length ? { secondaryAdded: added, secondaryRemoved: removed } : {}),
        // Seats on changes already in approval are left alone; a manager removes them on the change if they should not count.
        ...(account.openSeats ? { openApprovalSeatsKept: account.openSeats } : {}),
      },
    });
  }
  const user = await db.user.findUniqueOrThrow({ where: { id }, select: USER_SELECT });
  return ok(serializeUser(user));
}
