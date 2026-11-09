import { db } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

/**
 * What every successful sign-in leaves behind: `User.lastLoginAt` and a LOGIN audit
 * entry. Password sign-in (Credentials.authorize) and SSO (Auth.js `events.signIn`)
 * both call this, so the two paths cannot drift apart.
 */
export async function recordSignIn(
  user: { id: string; email?: string | null },
  opts: { method?: "password" | "sso"; ip?: string } = {},
): Promise<void> {
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const via = opts.method === "sso" ? ", SSO" : "";
  await writeAudit({
    userId: user.id,
    action: "LOGIN",
    entity: "User",
    entityId: user.id,
    summary: `Signed in (${user.email ?? user.id}${via})`,
    ...(opts.ip ? { ip: opts.ip } : {}),
  });
}
