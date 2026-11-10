import type { Prisma } from "@prisma/client";

/**
 * Service accounts: non-human accounts (an integration that files tickets through the API, a break-glass
 * admin, an automation admin). They have no mailbox and no business on an approval board.
 *
 * - They never receive email: the one place that sends mail (`sendMail`, lib/mail.ts) drops them from
 *   every recipient list, whichever feature wrote the message.
 * - They never sit on a change approval board of other people's changes: they are never auto-selected for a
 *   board and cannot be added by hand.
 * - `canApproveChanges` is the explicit per-account switch for approving: on for people, off for service
 *   accounts. Marking an account as a service account turns the switch off, and unmarking it turns it back
 *   on (`resolveAccountFlags`). An ADMIN can switch it on for a service account on purpose, for an
 *   automation account that owns its own changes and self-approves them under the self-approval mode
 *   (Settings > Changes). Such an account is seated only on its own changes, only as far as the mode allows,
 *   and decides only its own seat, with a role that may approve the change's risk.
 *
 * This file is pure (no database), so the rules are unit-testable; the queries that use it live next to
 * the code they serve (lib/cab.ts, lib/mail.ts).
 */

export type ApprovalFlags = { isServiceAccount: boolean; canApproveChanges: boolean };

/**
 * Whether the account may decide a change approval at all: the per-account switch. People have it on,
 * service accounts off unless an admin turned it on (see the header).
 */
export function mayApproveChanges(user: ApprovalFlags): boolean {
  return user.canApproveChanges;
}

/**
 * Whether the account can be a member of a change approval board that judges other people's changes:
 * auto-selected, or added by hand. A service account never is, even with the switch on; it only joins its
 * own changes through the self-approval mode.
 */
export function mayJoinApprovalBoard(user: ApprovalFlags): boolean {
  return !user.isServiceAccount && user.canApproveChanges;
}

/** Prisma filter for the accounts that may join a board (combine with the role / active filters). */
export const MAY_JOIN_APPROVAL_BOARD_WHERE = {
  isServiceAccount: false,
  canApproveChanges: true,
} satisfies Prisma.UserWhereInput;

export const NOT_AN_APPROVER_ERROR = "This account may not approve changes.";

/** Why this account may not decide a change approval, or null. */
export function approverAccountError(user: ApprovalFlags): string | null {
  return mayApproveChanges(user) ? null : NOT_AN_APPROVER_ERROR;
}

export const SERVICE_ACCOUNT_OWN_SEAT_ONLY = "A service account can only decide its own approval seat.";

export const SERVICE_ACCOUNT_APPROVAL_ADMIN_ONLY = "Only an administrator can allow a service account to approve changes.";

/** Who may turn the approval switch on for a service account. */
export function mayEnableServiceAccountApproval(actorRole: string | null | undefined): boolean {
  return actorRole === "ADMIN";
}

/**
 * The flags an edit leaves an account with. Either field may be left out (unchanged). Marking an account as a
 * service account turns the approval switch off, unmarking it turns it back on; an explicit switch value
 * sent with the same edit wins. Turning the switch on for a service account is deliberate and needs an
 * ADMIN (`actorRole`); an account that already has it on keeps it, whoever saves the edit.
 */
export function resolveAccountFlags(
  current: ApprovalFlags,
  next: { isServiceAccount?: boolean; canApproveChanges?: boolean },
  actorRole: string | null | undefined,
): ({ ok: true } & ApprovalFlags) | { ok: false; error: string } {
  const isServiceAccount = next.isServiceAccount ?? current.isServiceAccount;
  let canApproveChanges = current.canApproveChanges;
  if (next.canApproveChanges !== undefined) canApproveChanges = next.canApproveChanges;
  else if (isServiceAccount !== current.isServiceAccount) canApproveChanges = !isServiceAccount;
  const alreadyAllowed = current.isServiceAccount && current.canApproveChanges;
  if (isServiceAccount && canApproveChanges && !alreadyAllowed && !mayEnableServiceAccountApproval(actorRole)) {
    return { ok: false, error: SERVICE_ACCOUNT_APPROVAL_ADMIN_ONLY };
  }
  return { ok: true, isServiceAccount, canApproveChanges };
}

/** How an edit moved the approval switch of a service account: for the audit entry. */
export type ServiceAccountApprovalChange = "enabled" | "disabled" | null;

export function serviceAccountApprovalChange(before: ApprovalFlags, after: ApprovalFlags): ServiceAccountApprovalChange {
  const was = before.isServiceAccount && before.canApproveChanges;
  const is = after.isServiceAccount && after.canApproveChanges;
  if (is && !was) return "enabled";
  if (was && !is) return "disabled";
  return null;
}

// ── Mail recipients ──────────────────────────────────────────────────────────

type Recipients = { to: string; cc?: string[]; bcc?: string[] };

export type FilteredRecipients = { to: string; cc: string[]; bcc: string[] } | null;

/**
 * `recipients` without the addresses in `blocked` (compared case-insensitively). When the main recipient is
 * blocked the first remaining cc / bcc address takes over, so a person copied on a message to a service
 * account still gets it. Null when nobody is left: the message is not sent at all.
 */
export function withoutBlockedRecipients(recipients: Recipients, blocked: ReadonlySet<string>): FilteredRecipients {
  const ok = (address: string) => !blocked.has(address.trim().toLowerCase());
  const cc = (recipients.cc ?? []).filter(ok);
  const bcc = (recipients.bcc ?? []).filter(ok);
  if (ok(recipients.to)) return { to: recipients.to, cc, bcc };
  if (cc.length > 0) return { to: cc[0], cc: cc.slice(1), bcc };
  if (bcc.length > 0) return { to: bcc[0], cc, bcc: bcc.slice(1) };
  return null;
}
