/**
 * Who may manage services, and the refusal for deleting a referenced one.
 * Pure rules shared by the REST API and the console actions, so both agree
 * (services are managed by MANAGER and ADMIN, like categories).
 */

const MANAGING_ROLES: readonly string[] = ["MANAGER", "ADMIN"];

/** Creating, editing, linking and deleting services needs MANAGER or above. */
export function canManageServices(role: string | null | undefined): boolean {
  return !!role && MANAGING_ROLES.includes(role);
}

/**
 * Fields an agent may still change on a service: the status is part of
 * incident handling (marking a service degraded or down).
 */
export function agentMayUpdateField(field: string): boolean {
  return field === "status";
}

/** The `references` of a service that still points somewhere; null when it is safe to delete. */
export function inUseRefusal(references: Record<string, number | undefined>) {
  return Object.keys(references).length > 0
    ? {
        message: "The service is still referenced. Set its status to RETIRED instead of deleting it.",
        references,
        suggestion: { status: "RETIRED" },
      }
    : null;
}
