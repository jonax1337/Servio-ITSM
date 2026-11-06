import type { Change } from "@prisma/client";

/** What every change tab panel needs from the page; each panel loads the rest itself. */
export type ChangeTabContext = {
  change: Change;
  /** CAB seats filled and how many of them have not decided yet. */
  approvals: { seated: number; pending: number };
  /** Signed-in user id, "" when there is no session. */
  userId: string;
  isAgent: boolean;
  /** Agent and the change is not closed or cancelled. */
  canEdit: boolean;
  /** MANAGER+ (curates the approval board). */
  canManage: boolean;
  isAdmin: boolean;
};
