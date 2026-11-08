import Link from "next/link";
import type { Metadata } from "next";
import { MapPin, Server } from "lucide-react";
import { db } from "@/lib/db";
import { PageHeader, PageBody } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { LocationDialog } from "@/components/locations/location-dialog";
import { LOCATION_TYPE_META } from "@/lib/constants";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("locations");
  return { title: t("title") };
}
export const dynamic = "force-dynamic";

type Node = {
  id: string; name: string; type: string; parentId: string | null; assetCount: number; children: Node[];
};

function Tree({ nodes, depth = 0 }: { nodes: Node[]; depth?: number }) {
  return (
    <ul className={depth > 0 ? "ml-4 border-l pl-3" : ""}>
      {nodes.map((n) => (
        <li key={n.id} className="py-0.5">
          <div className="flex items-center gap-2">
            <Link
              href={`/locations/${n.id}`}
              className="group flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted"
            >
              <StatusBadge map={LOCATION_TYPE_META} value={n.type} />
              <span className="font-medium group-hover:text-primary">{n.name}</span>
              {n.assetCount > 0 ? (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Server className="size-3" /> {n.assetCount}
                </span>
              ) : null}
            </Link>
          </div>
          {n.children.length > 0 ? <Tree nodes={n.children} depth={depth + 1} /> : null}
        </li>
      ))}
    </ul>
  );
}

export default async function LocationsPage() {
  const t = await getT("locations");
  const locations = await db.location.findMany({
    orderBy: [{ type: "asc" }, { name: "asc" }],
    include: { _count: { select: { assets: true } } },
  });

  const nodes: Node[] = locations.map((l) => ({
    id: l.id, name: l.name, type: l.type, parentId: l.parentId, assetCount: l._count.assets, children: [],
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const roots: Node[] = [];
  for (const n of nodes) {
    if (n.parentId && byId.get(n.parentId)) byId.get(n.parentId)!.children.push(n);
    else roots.push(n);
  }

  const parents = locations.map((l) => ({ value: l.id, label: l.name }));

  return (
    <>
      <PageHeader
        icon={MapPin}
        title={t("title")}
        description={t("description")}
      >
        <LocationDialog parents={parents} />
      </PageHeader>

      <PageBody>
        {roots.length === 0 ? (
          <EmptyState icon={MapPin} title={t("emptyTitle")} description={t("emptyDescription")}>
            <LocationDialog parents={parents} size="sm" />
          </EmptyState>
        ) : (
          <Card>
            <CardContent>
              <Tree nodes={roots} />
            </CardContent>
          </Card>
        )}
      </PageBody>
    </>
  );
}
