import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { CRITICALITY_META, SERVICE_STATUS_META } from "@/lib/constants";
import type { ServiceImpactRow } from "@/lib/service-graph";
import { getT } from "@/lib/i18n/server";

/**
 * The services an outage hits, grouped by distance from the failure (see
 * lib/service-graph.ts). `depth` 0 = runs on a failed CI, 1+ = reached through
 * that many service dependencies. Read-only.
 */
export async function ServiceImpactList({ rows, empty }: { rows: ServiceImpactRow[]; empty: string }) {
  const t = await getT("services");
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;

  const byDepth = new Map<number, ServiceImpactRow[]>();
  for (const r of rows) {
    const list = byDepth.get(r.depth);
    if (list) list.push(r);
    else byDepth.set(r.depth, [r]);
  }
  const depths = [...byDepth.keys()].sort((a, b) => a - b);

  return (
    <div className="grid gap-5">
      {depths.map((depth) => (
        <div key={depth}>
          <div className="mb-2 flex items-center gap-2">
            <span className="grid size-6 shrink-0 place-items-center rounded-full border bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground">
              {depth}
            </span>
            <span className="text-xs font-medium text-muted-foreground">
              {depth === 0 ? t("impact.runsOnFailed") : t("impact.levels", { depth })}
            </span>
          </div>
          <div className="grid gap-2 sm:pl-8">
            {byDepth.get(depth)!.map((r) => (
              <Link
                key={r.id}
                href={`/services/${r.id}`}
                className="group flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm hover:border-primary/40"
              >
                {r.code ? <span className="font-mono text-xs text-muted-foreground">{r.code}</span> : null}
                <span className="min-w-0 flex-1 truncate font-medium group-hover:text-primary">{r.name}</span>
                {r.via ? (
                  <span className="text-xs text-muted-foreground">
                    {r.via.kind === "asset" ? t("impact.viaAsset", { name: r.via.name }) : t("impact.viaService", { name: r.via.name })}
                  </span>
                ) : null}
                <StatusBadge map={CRITICALITY_META} value={r.criticality} dot />
                <StatusBadge map={SERVICE_STATUS_META} value={r.status} />
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
