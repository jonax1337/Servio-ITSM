import type { Prisma } from "@prisma/client";

/**
 * Service accounts: non-human accounts (an integration that files tickets through the API, a break-glass
 * admin, an automation admin). They have no mailbox and no business on an approval board.
 *
 * - They never receive email: the one place that sends mail (`sendMail`, lib/mail.ts) drops them from
 *   every recipient list, whichever feature wrote the message.
 * - They never sit on a change approval board, and cannot decide an approval.
 * - `canApproveChanges` is the explicit per-account switch for the board: on for people, off for service
 *   accounts. A service account is excluded whatever the switch says; marking an account as a service
 *   account turns the switch off, and unmarking it turns it back on (`resolveAccountFlags`).
 *
 * This file is pure (no database), so the rules are unit-testable; the queries that use it live next to
 * the code they serve (lib/cab.ts, lib/mail.ts).
 */

export type ApprovalFlags = { isServiceAccount: boolean; canApproveChanges: boolean };

/** Whether the account may sit on a change approval board and decide approvals. */
export function mayApproveChanges(user: ApprovalFlags): boolean {
  return !user.isServiceAccount && user.canApproveChanges;
}

/** Prisma filter for the accounts that may sit on a board (combine with the role / active filters). */
export const MAY_APPROVE_CHANGES_WHERE = {
  isServiceAccount: false,
  canApproveChanges: true,
} satisfies Prisma.UserWhereInput;

export const NOT_AN_APPROVER_ERROR = "This account may not approve changes.";

/** Why this account may not decide a change approval, or null. */
export function approverAccountError(user: ApprovalFlags): string | null {
  return mayApproveChanges(user) ? null : NOT_AN_APPROVER_ERROR;
}

export const SERVICE_ACCOUNT_CANNOT_APPROVE = "A service account cannot approve changes.";

/**
 * The flags an edit leaves an account with. Either field may be left out (unchanged). Marking an account as a
 * service account turns the approval switch off, unmarking it turns it back on; an explicit switch value
 * sent with the same edit wins, except that a service account cannot be switched on (that is refused).
 */
export function resolveAccountFlags(
  current: ApprovalFlags,
  next: { isServiceAccount?: boolean; canApproveChanges?: boolean },
): ({ ok: true } & ApprovalFlags) | { ok: false; error: string } {
  const isServiceAccount = next.isServiceAccount ?? current.isServiceAccount;
  if (isServiceAccount && next.canApproveChanges === true) return { ok: false, error: SERVICE_ACCOUNT_CANNOT_APPROVE };
  let canApproveChanges = current.canApproveChanges;
  if (next.canApproveChanges !== undefined) canApproveChanges = next.canApproveChanges;
  else if (isServiceAccount !== current.isServiceAccount) canApproveChanges = !isServiceAccount;
  return { ok: true, isServiceAccount, canApproveChanges: isServiceAccount ? false : canApproveChanges };
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
