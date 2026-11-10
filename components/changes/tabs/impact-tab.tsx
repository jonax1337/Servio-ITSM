import { db } from "@/lib/db";
import { searchAttachableCis } from "@/lib/actions/changes";
import { computeImpact } from "@/lib/cmdb-graph";
import { blastRadiusRisk } from "@/lib/change-brief-rules";
import { AffectedCiPanel, type ChangeImpact } from "@/components/changes/affected-ci-panel";
import { RecordAffectedServices } from "@/components/services/affected-services";
import type { ChangeTabContext } from "@/components/changes/tabs/types";

/**
 * Walks the CMDB dependency graph downstream from each affected CI and unions the
 * reachable nodes (excluding the affected roots themselves): the change's blast
 * radius, rated like the CAB brief rates it.
 */
async function impactOf(affectedIds: string[]): Promise<ChangeImpact> {
  const affected = new Set(affectedIds);
  const results = await Promise.all(affectedIds.map((id) => computeImpact(id, { direction: "downstream" })));
  const impacted = new Map<string, ChangeImpact["impacted"][number]>();
  for (const { impacted: nodes } of results) {
    for (const node of nodes) {
      if (affected.has(node.id) || impacted.has(node.id)) continue;
      impacted.set(node.id, {
        id: node.id,
        name: node.name,
        assetType: node.assetType,
        status: node.status,
        relation: node.relation,
      });
    }
  }
  return { impacted: Array.from(impacted.values()), risk: blastRadiusRisk(impacted.size) };
}

/** Rendered only while the Impact tab is active: the graph walk is the expensive part of the page. */
export async function ImpactTab({ change, isAgent }: ChangeTabContext) {
  const affectedLinks = await db.changeAsset.findMany({ where: { changeId: change.id }, include: { asset: true } });
  const affectedIds = affectedLinks.map((a) => a.assetId);
  const impact = await impactOf(affectedIds);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 [&>div]:mt-0">
      <AffectedCiPanel
        changeId={change.id}
        affected={affectedLinks.map((a) => ({
          assetId: a.assetId,
          name: a.asset.name,
          type: a.asset.type,
          status: a.asset.status,
        }))}
        impact={impact}
        searchAssets={searchAttachableCis.bind(null, change.id)}
        editable={isAgent}
      />
      {/* Services hit through the affected CIs (read-only) */}
      {isAgent ? <RecordAffectedServices record={{ kind: "change", id: change.id }} /> : null}
    </div>
  );
}
