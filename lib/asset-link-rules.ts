/**
 * Rules for linking a configuration item (asset) to other records.
 * Retired and disposed assets are out of service, so — like the change page's
 * CI picker — they can no longer be marked as affected by a change.
 */

export const INACTIVE_ASSET_STATUSES = ["RETIRED", "DISPOSED"] as const;

export const INACTIVE_ASSET_MESSAGE = "Retired or disposed assets can't be added to a change.";

export function canAttachToChange(assetStatus: string): boolean {
  return !(INACTIVE_ASSET_STATUSES as readonly string[]).includes(assetStatus);
}

/** Changes that no longer accept new affected CIs (finished or never going ahead). */
export const SETTLED_CHANGE_STATUSES = ["CLOSED", "REJECTED", "FAILED", "CANCELLED"] as const;
