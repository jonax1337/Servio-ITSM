import Link from "next/link";
import { Radar, HardDrive } from "lucide-react";
import { StatusBadge, ToneBadge } from "@/components/status-badge";
import {
  ASSET_TYPE_META,
  ASSET_STATUS_META,
  ASSET_RELATION_META,
  metaFor,
} from "@/lib/constants";
import type { ImpactResult } from "@/lib/cmdb-graph";
import { getT } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translate";

/**
 * Blast-radius panel for an asset. Renders the pre-computed impact result
 * (see `computeImpact` in lib/cmdb-graph.ts) grouped by BFS depth so the
 * closest dependencies read first. Read-only — no interactivity required.
 */
export async function ImpactGraph({ impact }: { impact: ImpactResult }) {
  const { impacted } = impact;
  const t = await getT("assets");

  if (impacted.length === 0) {
    return (
      <div className="mt-8">
        <ImpactHeading t={t} count={0} />
        <p className="text-sm text-muted-foreground">
          {t("impact.empty")}
        </p>
      </div>
    );
  }

  // Group by depth, preserving discovery order within each level.
  const byDepth = new Map<number, ImpactResult["impacted"]>();
  for (const node of impacted) {
    const list = byDepth.get(node.depth);
    if (list) list.push(node);
    else byDepth.set(node.depth, [node]);
  }
  const depths = Array.from(byDepth.keys()).sort((a, b) => a - b);

  return (
    <div className="mt-8">
      <ImpactHeading t={t} count={impacted.length} />
      <p className="mb-4 text-sm text-muted-foreground">
        {t("impact.description")}
      </p>

      <div className="relative grid gap-6">
        {depths.map((depth) => {
          const nodes = byDepth.get(depth)!;
          return (
            <div key={depth} className="relative">
              <div className="mb-2 flex items-center gap-2">
                <span className="grid size-6 shrink-0 place-items-center rounded-full border bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground">
                  {depth}
                </span>
                <span className="text-xs font-medium text-muted-foreground">
                  {depth === 1 ? t("impact.direct") : t("impact.hops", { depth })} ·{" "}
                  {t("impact.ciCount", { count: nodes.length })}
                </span>
              </div>
              <div className="grid gap-2 sm:pl-8">
                {nodes.map((node) => (
                  <Link
                    key={node.id}
                    href={`/assets/${node.id}`}
                    className="group flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm hover:border-primary/40"
                  >
                    <HardDrive className="size-4 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {node.name}
                    </span>
                    {node.relation ? (
                      <ToneBadge
                        meta={metaFor(ASSET_RELATION_META, node.relation)}
                      />
                    ) : null}
                    {node.assetType ? (
                      <StatusBadge
                        map={ASSET_TYPE_META}
                        value={node.assetType}
                        dot
                      />
                    ) : null}
                    {node.status ? (
                      <StatusBadge
                        map={ASSET_STATUS_META}
                        value={node.status}
                      />
                    ) : null}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ImpactHeading({ t, count }: { t: Translator<"assets">; count: number }) {
  return (
    <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
      <Radar className="size-4 text-muted-foreground" />
      {t("impact.heading", { count })}
    </h2>
  );
}
