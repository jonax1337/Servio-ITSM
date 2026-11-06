import { db } from "@/lib/db";
import { evaluateCab } from "@/lib/cab";
import { computeImpact } from "@/lib/cmdb-graph";
import { formatPlannedWindow, isTemplatedStandard } from "@/lib/change-rules";
import { loadChangeScheduleCheck } from "@/lib/change-schedule";
import { changeRef } from "@/lib/constants";
import {
  planCompleteness,
  type BriefApprovals,
  type BriefCi,
  type BriefSchedule,
  type ChangeBriefFacts,
} from "@/lib/change-brief-rules";

const IMPACT_SAMPLE_SIZE = 15;

/** Distinct CIs reachable downstream from the affected CIs, the affected CIs themselves excluded. */
async function downstreamOf(affectedIds: string[]): Promise<{ count: number; sample: BriefCi[] }> {
  const affected = new Set(affectedIds);
  const results = await Promise.all(affectedIds.map((id) => computeImpact(id, { direction: "downstream" })));
  const reached = new Map<string, BriefCi>();
  for (const { impacted } of results) {
    for (const node of impacted) {
      if (!affected.has(node.id) && !reached.has(node.id)) {
        reached.set(node.id, { name: node.name, type: node.assetType ?? "ASSET" });
      }
    }
  }
  return { count: reached.size, sample: [...reached.values()].slice(0, IMPACT_SAMPLE_SIZE) };
}

/** Overlaps and freeze hits of the change's planned window; empty while it has no window. */
async function scheduleOf(changeId: number): Promise<BriefSchedule> {
  const check = await loadChangeScheduleCheck(changeId);
  return {
    conflicts: (check?.conflicts ?? []).map(({ other }) => ({ ref: changeRef(other.id), title: other.title })),
    freezes: (check?.freezeHits ?? []).map((freeze) => freeze.name),
  };
}

/**
 * Everything the copilot and the CAB brief state about a change: the record, its affected CIs, the
 * CMDB blast radius, plan completeness and the board's progress. Null when the change does not exist.
 */
export async function loadChangeBrief(changeId: number): Promise<ChangeBriefFacts | null> {
  const change = await db.change.findUnique({
    where: { id: changeId },
    include: {
      assets: { select: { asset: { select: { id: true, name: true, type: true } } } },
      approvals: { select: { status: true, approver: { select: { name: true, email: true } } } },
    },
  });
  if (!change) return null;

  const affected = change.assets.map((link) => link.asset);
  const [downstream, schedule] = await Promise.all([downstreamOf(affected.map((asset) => asset.id)), scheduleOf(changeId)]);

  let approvals: BriefApprovals | null = null;
  if (!isTemplatedStandard(change)) {
    const tally = evaluateCab(
      change.approvals.map((approval) => approval.status),
      change.approvalRule,
      change.approvalThreshold,
    );
    approvals = {
      approved: tally.approved,
      rejected: tally.rejected,
      pending: tally.pending,
      seated: tally.seated,
      required: tally.required,
      satisfied: tally.satisfied,
      approvers: change.approvals.map((approval) => ({
        name: approval.approver.name ?? approval.approver.email,
        status: approval.status,
      })),
    };
  }

  return {
    ref: changeRef(change.id),
    title: change.title,
    description: change.description,
    type: change.type,
    status: change.status,
    risk: change.risk,
    impact: change.impact,
    reason: change.reason,
    implementationPlan: change.implementationPlan,
    rollbackPlan: change.rollbackPlan,
    window: formatPlannedWindow({ start: change.plannedStart, end: change.plannedEnd }),
    affected: affected.map(({ name, type }) => ({ name, type })),
    impactedCount: downstream.count,
    impactedSample: downstream.sample,
    plan: planCompleteness(change, affected.length),
    schedule,
    approvals,
  };
}
