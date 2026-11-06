import { db } from "@/lib/db";
import { computeImpact } from "@/lib/cmdb-graph";
import { blastRadiusRisk } from "@/lib/change-brief-rules";
import { AffectedCiPanel, type ChangeImpact } from "@/components/changes/affected-ci-panel";
import type { ComboOption } from "@/components/combobox";
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
  const [affectedLinks, candidateAssets] = await Promise.all([
    db.changeAsset.findMany({ where: { changeId: change.id }, include: { asset: true } }),
    db.asset.findMany({
      where: { status: { notIn: ["RETIRED", "DISPOSED"] } },
      select: { id: true, name: true, type: true },
      orderBy: { name: "asc" },
      take: 500,
    }),
  ]);
  const affectedIds = affectedLinks.map((a) => a.assetId);
  const impact = await impactOf(affectedIds);

  const affectedSet = new Set(affectedIds);
  const assetOptions: ComboOption[] = candidateAssets
    .filter((a) => !affectedSet.has(a.id))
    .map((a) => ({ value: a.id, label: a.name, hint: a.type }));

  return (
    <div className="[&>div]:mt-0">
      <AffectedCiPanel
        changeId={change.id}
        affected={affectedLinks.map((a) => ({
          assetId: a.assetId,
          name: a.asset.name,
          type: a.asset.type,
          status: a.asset.status,
        }))}
        impact={impact}
        assetOptions={assetOptions}
        editable={isAgent}
      />
    </div>
  );
}
