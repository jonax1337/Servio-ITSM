import { db } from "@/lib/db";
import { aiConfigured, aiTeaserEnabled } from "@/lib/ai";
import { getSessionUser, isAgent } from "@/lib/session";
import { ChangeCopilotPanel } from "@/components/changes/change-copilot-panel";

export type ChangeCopilotProps = {
  changeId: number;
  /** False when the change is locked: there is nothing the copilot could apply, so it stays out of the way. */
  editable: boolean;
};

/**
 * Sable drafts an implementation plan, a rollback plan and a risk rationale from the change, its
 * affected CIs and the CMDB impact. Each draft is applied by an explicit click; nothing is written
 * otherwise. Agents only; with AI off it is a teaser (when enabled) or absent.
 */
export async function ChangeCopilot({ changeId, editable }: ChangeCopilotProps) {
  const me = await getSessionUser();
  if (!editable || !me || !isAgent(me.role)) return null;

  const enabled = await aiConfigured();
  const teaser = !enabled && (await aiTeaserEnabled());
  if (!enabled && !teaser) return null;

  const change = await db.change.findUnique({
    where: { id: changeId },
    select: { reason: true, implementationPlan: true, rollbackPlan: true },
  });
  if (!change) return null;

  return <ChangeCopilotPanel changeId={changeId} current={change} teaser={teaser} />;
}
