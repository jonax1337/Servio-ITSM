import { roleAtLeast } from "@/lib/route-guard";
import type { AiOperation, AiOpChatScope } from "./types";

/**
 * Which operations a role may use on a chat surface — the single gate both the
 * tool builder (propose time) and the apply path share.
 *
 * Gating is ROLE-ONLY: the old GENERAL/ADMIN chat-scope toggle was removed
 * from the UI, so adminOnly ops surface in the normal chat gated per-operation
 * by the acting user's role (apply re-checks the fresh DB role, so a demoted
 * admin can't apply either). Pure + framework-free so it stays unit-testable.
 */
export function filterOperationsForRole(
  ops: AiOperation[],
  role: string,
  _scope: AiOpChatScope,
): AiOperation[] {
  return ops.filter((op) => roleAtLeast(role, op.minRole));
}
