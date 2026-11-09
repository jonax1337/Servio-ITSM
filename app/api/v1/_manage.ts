import { apiError, type ApiPrincipal } from "@/lib/api";
import { hasRole, type Role } from "@/lib/session";
import { EXTERNAL_REF_HINT, parseExternalRef } from "@/lib/ticket-external-ref";

/**
 * Shared plumbing of the configuration endpoints that MANAGER+ maintain in the
 * console (catalog items, change templates, contracts, vendors): reads need an
 * agent token, writes a token owned by a manager or admin, and each record can
 * be kept in step with a source by its origin reference (`import_ref`).
 */

/** 403 unless the token owner may manage `what` (MANAGER or ADMIN, as in the console). */
export function managerOnly(principal: ApiPrincipal, what: string) {
  return hasRole(principal.role as Role, "MANAGER")
    ? null
    : apiError(403, `Managing ${what} needs a token owned by a manager or admin.`);
}

/** The origin reference from the `{ref}` route segment, or null when it is not a valid one. */
export async function refOf(ctx: { params: Promise<{ ref: string }> }): Promise<string | null> {
  return parseExternalRef((await ctx.params).ref);
}

export function invalidRef() {
  return apiError(422, "Validation failed", { ref: [EXTERNAL_REF_HINT] });
}

/** A unique-index violation on `column` (a concurrent writer won the race, or the value is taken). */
export function isUniqueOn(err: unknown, column: string): boolean {
  const e = err as { code?: string; meta?: { target?: unknown } };
  return e?.code === "P2002" && String(e.meta?.target ?? "").includes(column);
}

/** 409 for an import_ref that another record already carries. */
export function importRefTaken(id?: string) {
  return apiError(409, "This import_ref is already used by another record.", id ? { id } : undefined);
}
