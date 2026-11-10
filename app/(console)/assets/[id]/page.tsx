import { canReadConsoleTitle } from "@/lib/metadata-access";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getFormOptions } from "@/lib/data/options";
import { requireUser, isAgent, hasRole, type Role } from "@/lib/session";
import { DetailShell, DetailTitle, DetailTopBar, MetaRow, RailCard } from "@/components/detail-layout";
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
import { ASSET_TYPE_META, ASSET_STATUS_META, metaFor } from "@/lib/constants";
import { getEnumT, getFormatter, getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  if (!(await canReadConsoleTitle())) return {};
  const { id } = await params;
  const a = await db.asset.findUnique({
    where: { id },
    select: { name: true },
  });
  return { title: a ? a.name : (await getT("assets"))("entity") };
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
  const [t, tc, te, f] = await Promise.all([getT("assets"), getT("common"), getEnumT(), getFormatter()]);
  const [asset, options, locations] = await Promise.all([
    db.asset.findUnique({
      where: { id },
      include: {
        owner: true,
        group: true,
        locationRef: true,
        syncSource: true,
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
  }).map((tab) => ({ ...tab, label: t(`tab.${tab.key}`) }));
  const active = resolveTab(sp, tabs, DEFAULT_ASSET_TAB);

  const rail = (
    <>
      <RailCard title={tc("properties")}>
        <AssetProperties asset={asset} options={options} />
      </RailCard>

      <RailCard title={t("lifecycle")}>
        <MetaRow label={t("added")}>{f.date(asset.createdAt)}</MetaRow>
        {asset.purchaseDate ? <MetaRow label={t("purchased")}>{f.date(asset.purchaseDate)}</MetaRow> : null}
        {asset.lastSeenAt ? <MetaRow label={t("lastSeen")}>{f.date(asset.lastSeenAt, "dateTime")}</MetaRow> : null}
      </RailCard>
    </>
  );

  return (
    <DetailShell aside={rail}>
      <DetailTopBar
        backHref="/assets"
        backLabel={t("backToList")}
        lead={
          <>
            {asset.assetTag ? <span className="font-mono text-sm text-muted-foreground">{asset.assetTag}</span> : null}
            <StatusBadge map={ASSET_TYPE_META} value={asset.type} dot />
          </>
        }
      >
        <AssetEditDialog asset={asset} options={editOptions} />
        {isAgentUser ? <DeleteAssetButton assetId={asset.id} assetName={asset.name} /> : null}
        <StatusBadge map={ASSET_STATUS_META} value={asset.status} />
      </DetailTopBar>

      <div className="p-4 sm:p-6">
        <DetailTitle
          title={asset.name}
          subtitle={
            <>
              {asset.manufacturer ? `${asset.manufacturer} · ` : ""}
              {asset.model ?? te(metaFor(ASSET_TYPE_META, asset.type))}
              {asset.syncSource ? ` · ${t("syncedFrom", { source: asset.syncSource.name })}` : ""}
            </>
          }
        />

        <EntityTabs
          className="mt-4"
          tabs={tabs}
          active={active}
          defaultTab={DEFAULT_ASSET_TAB}
          basePath={`/assets/${asset.id}`}
          searchParams={sp}
          label={t("sections")}
        />

        <div className="mt-6">
          {active === "overview" ? (
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
              <AssetOverviewTab asset={asset} />
              <RecordAttachments target={{ assetId: asset.id }} role={me?.role ?? "USER"} />
            </div>
          ) : null}
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
    </DetailShell>
  );
}
