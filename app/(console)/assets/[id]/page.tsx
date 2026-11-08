import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { getFormOptions } from "@/lib/data/options";
import { requireUser, isAgent, hasRole, type Role } from "@/lib/session";
import { LinkButton } from "@/components/link-button";
import { StatusBadge } from "@/components/status-badge";
import { AssetProperties } from "@/components/assets/asset-properties";
import { AssetEditDialog } from "@/components/assets/asset-edit-dialog";
import { RecordAttachments } from "@/components/attachments/record-attachments";
import { DeleteAssetButton } from "@/components/assets/delete-asset-button";
import { AssetContracts } from "@/components/assets/asset-contracts";
import { EntityHistory } from "@/components/history/entity-history";
import { EntityTabs, resolveTab } from "@/components/entity-tabs";
import { DEFAULT_ASSET_TAB, buildAssetTabs } from "@/components/assets/tabs/asset-tabs";
import { AssetOverviewTab } from "@/components/assets/tabs/asset-overview-tab";
import { AssetRelationshipsTab } from "@/components/assets/tabs/asset-relationships-tab";
import { AssetWorkTab } from "@/components/assets/tabs/asset-work-tab";
import type { SearchParams } from "@/lib/query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ASSET_TYPE_META,
  ASSET_STATUS_META,
  SERVICE_STATUS_META,
  metaFor,
} from "@/lib/constants";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const a = await db.asset.findUnique({
    where: { id },
    select: { name: true },
  });
  return { title: a ? a.name : "Asset" };
}

export default async function AssetDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const me = await requireUser();
  const [asset, options, locations] = await Promise.all([
    db.asset.findUnique({
      where: { id },
      include: {
        owner: true,
        group: true,
        locationRef: true,
        syncSource: true,
        services: { select: { service: { select: { id: true, name: true, status: true } } } },
        _count: { select: { relationsFrom: true, relationsTo: true, tickets: true, changes: true } },
      },
    }),
    getFormOptions(),
    db.location.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  if (!asset) notFound();

  const isAgentUser = !!me && isAgent(me.role as Role);
  const canManage = !!me && hasRole(me.role as Role, "MANAGER");

  const editOptions = {
    locations: locations.map((l) => ({ value: l.id, label: l.name })),
    agents: options.agents.map((a) => ({ value: a.id, label: a.name ?? a.email })),
    groups: options.groups.map((g) => ({ value: g.id, label: g.name })),
  };

  const tabs = buildAssetTabs({
    relations: asset._count.relationsFrom + asset._count.relationsTo,
    tickets: asset._count.tickets,
    changes: asset._count.changes,
  });
  const active = resolveTab(sp, tabs, DEFAULT_ASSET_TAB);

  return (
    <div data-viewport-pane className="grid gap-0 lg:h-full lg:grid-cols-[1fr_320px] lg:overflow-hidden">
      {/* Main column — scrolls independently from the properties rail */}
      <div className="min-w-0 border-b lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-3 border-b px-4 py-3 sm:px-6">
          <LinkButton href="/assets" variant="ghost" size="icon-sm" aria-label="Back to assets">
            <ArrowLeft className="size-4" />
          </LinkButton>
          {asset.assetTag ? (
            <span className="font-mono text-sm text-muted-foreground">
              {asset.assetTag}
            </span>
          ) : null}
          <StatusBadge map={ASSET_TYPE_META} value={asset.type} dot />
          <div className="ml-auto flex items-center gap-2">
            <AssetEditDialog asset={asset} options={editOptions} />
            {isAgentUser ? <DeleteAssetButton assetId={asset.id} assetName={asset.name} /> : null}
            <StatusBadge map={ASSET_STATUS_META} value={asset.status} />
          </div>
        </div>

        <div className="p-4 sm:p-6">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {asset.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {asset.manufacturer ? `${asset.manufacturer} · ` : ""}
            {asset.model ?? metaFor(ASSET_TYPE_META, asset.type).label}
            {asset.syncSource ? ` · synced from ${asset.syncSource.name}` : ""}
          </p>

          <EntityTabs
            className="mt-4"
            tabs={tabs}
            active={active}
            defaultTab={DEFAULT_ASSET_TAB}
            basePath={`/assets/${asset.id}`}
            searchParams={sp}
            label="Asset sections"
          />

          <div className="mt-6">
            {active === "overview" ? <AssetOverviewTab asset={asset} /> : null}
            {active === "relationships" ? (
              <AssetRelationshipsTab assetId={asset.id} isAgentUser={isAgentUser} />
            ) : null}
            {active === "work" ? (
              <AssetWorkTab assetId={asset.id} assetStatus={asset.status} isAgentUser={isAgentUser} />
            ) : null}
            {active === "contracts" ? <AssetContracts assetId={asset.id} canEdit={canManage} /> : null}
            {active === "history" ? <EntityHistory entity="Asset" entityId={asset.id} /> : null}
          </div>
        </div>
      </div>

      {/* Sidebar */}
      <aside className="p-4 sm:p-6 lg:min-h-0 lg:overflow-y-auto">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Properties</CardTitle>
          </CardHeader>
          <CardContent>
            <AssetProperties asset={asset} options={options} />
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-sm">Ownership</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Owner</span>
              <span className="font-medium">
                {asset.owner ? asset.owner.name ?? asset.owner.email : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground">Group</span>
              <span className="font-medium">{asset.group?.name ?? "—"}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-sm">Lifecycle</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2.5 text-sm">
            <Meta label="Added" value={format(asset.createdAt, "PP")} />
            {asset.purchaseDate ? (
              <Meta label="Purchased" value={format(asset.purchaseDate, "PP")} />
            ) : null}
            {asset.lastSeenAt ? (
              <Meta label="Last seen" value={format(asset.lastSeenAt, "PP p")} />
            ) : null}
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-sm">Services · {asset.services.length}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {asset.services.length === 0 ? (
              <p className="text-sm text-muted-foreground">Not part of any service.</p>
            ) : (
              asset.services.map(({ service }) => (
                <div key={service.id} className="flex items-center gap-2">
                  <Link href={`/services/${service.id}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:text-primary">
                    {service.name}
                  </Link>
                  <StatusBadge map={SERVICE_STATUS_META} value={service.status} />
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <RecordAttachments className="mt-4" target={{ assetId: asset.id }} role={me?.role ?? "USER"} />
      </aside>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium tabular-nums">{value}</span>
    </div>
  );
}
