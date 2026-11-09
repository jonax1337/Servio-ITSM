import { getCurrentUser, hasRole, type Role } from "@/lib/session";

/**
 * Gate for `generateMetadata` of console detail pages. Next.js evaluates the
 * metadata next to the page and its layout, not behind them, so a record's title
 * (ticket subject, asset name, person, ...) would otherwise be read before any
 * access check has run. The route proxy already keeps non-agents out of the console;
 * this keeps the title behind the same DB-truth role check as a second line.
 * Resolves to false for signed-out, deactivated or too-low-role users: the caller then
 * returns the generic title instead of looking the record up.
 */
export async function canReadConsoleTitle(min: Role = "AGENT"): Promise<boolean> {
  const user = await getCurrentUser();
  return Boolean(user && user.isActive && hasRole(user.role as Role, min));
}
