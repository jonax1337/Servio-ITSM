import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, Ticket as TicketIcon, Network, HardDrive, X } from "lucide-react";
import { db } from "@/lib/db";
import { getFormOptions } from "@/lib/data/options";
import { getSessionUser, isAgent, type Role } from "@/lib/session";
import { LinkButton } from "@/components/link-button";
import { StatusBadge, ToneBadge } from "@/components/status-badge";
import { AssetProperties } from "@/components/assets/asset-properties";
import { AssetEditDialog } from "@/components/assets/asset-edit-dialog";
import { DeleteAssetButton } from "@/components/assets/delete-asset-button";
import { LinkPicker } from "@/components/link-picker";
import { addAssetRelation, deleteAssetRelation } from "@/lib/actions/assets";
import { EntityHistory, HistoryHeading } from "@/components/history/entity-history";
import { ImpactGraph } from "@/components/assets/impact-graph";
import { ConfirmButton } from "@/components/confirm-dialog";
import { computeImpact } from "@/lib/cmdb-graph";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ASSET_TYPE_META,
  ASSET_STATUS_META,
  ASSET_RELATION_META,
  ASSET_RELATION_TYPES,
  TICKET_STATUS_META,
  metaFor,
  ticketRef,
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
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const me = await getSessionUser();
  const [asset, options, locations, otherAssets] = await Promise.all([
    db.asset.findUnique({
      where: { id },
      include: {
        owner: true,
        group: true,
        locationRef: true,
        syncSource: true,
        relationsFrom: { include: { target: true } },
        relationsTo: { include: { source: true } },
        tickets: { include: { ticket: true } },
      },
    }),
    getFormOptions(),
    db.location.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.asset.findMany({
      where: { id: { not: id } },
      select: { id: true, name: true, assetTag: true },
      orderBy: { name: "asc" },
      take: 300,
    }),
  ]);
  if (!asset) notFound();

  const impact = await computeImpact(asset.id, { direction: "both" });

  const isAgentUser = !!me && isAgent(me.role as Role);
  const relationTargetOpts = otherAssets.map((a) => ({ value: a.id, label: a.assetTag ? `${a.name} · ${a.assetTag}` : a.name }));
  const relationTypeOpts = ASSET_RELATION_TYPES.map((t) => ({ value: t, label: ASSET_RELATION_META[t].label, tone: ASSET_RELATION_META[t].tone }));

  const editOptions = {
    locations: locations.map((l) => ({ value: l.id, label: l.name })),
    agents: options.agents.map((a) => ({ value: a.id, label: a.name ?? a.email })),
    groups: options.groups.map((g) => ({ value: g.id, label: g.name })),
  };

  const specs: { label: string; value: React.ReactNode }[] = [];
  const push = (label: string, value: React.ReactNode) => {
    if (value !== null && value !== undefined && value !== "")
      specs.push({ label, value });
  };
  push("Type", <StatusBadge map={ASSET_TYPE_META} value={asset.type} dot />);
  push("Status", <StatusBadge map={ASSET_STATUS_META} value={asset.status} />);
  push("Serial", asset.serial ? <span className="font-mono">{asset.serial}</span> : null);
  push("Model", asset.model);
  push("Manufacturer", asset.manufacturer);
  push("OS", asset.os);
  push("CPU", asset.cpu);
  push("RAM", asset.ramGb != null ? `${asset.ramGb} GB` : null);
  push("Storage", asset.storageGb != null ? `${asset.storageGb} GB` : null);
  push("IP", asset.ipAddress ? <span className="font-mono">{asset.ipAddress}</span> : null);
  push("MAC", asset.macAddress ? <span className="font-mono">{asset.macAddress}</span> : null);
  push(
    "Location",
    asset.locationRef ? (
      <Link href={`/locations/${asset.locationRef.id}`} className="text-primary hover:underline">
        {asset.locationRef.name}
      </Link>
    ) : (
      asset.location
    ),
  );
  // Locale-formatted, currency-neutral — there's no org currency setting, so a
  // hard-coded symbol would be wrong outside the US.
  push("Cost", asset.cost != null ? asset.cost.toLocaleString() : null);
  push("Warranty end", asset.warrantyEnd ? format(asset.warrantyEnd, "PP") : null);

  return (
    <div className="grid gap-0 lg:h-[calc(100svh-3.5rem)] lg:grid-cols-[1fr_320px] lg:overflow-hidden">
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

          {/* Spec grid */}
          <div className="mt-4 rounded-xl border bg-card p-4">
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {specs.map((s) => (
                <div
                  key={s.label}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <dt className="text-muted-foreground">{s.label}</dt>
                  <dd className="text-right font-medium">{s.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {asset.notes ? (
            <div className="mt-4 rounded-xl border bg-card p-4 text-sm leading-relaxed whitespace-pre-wrap">
              {asset.notes}
            </div>
          ) : null}

          {/* Relationships */}
          <div className="mt-8">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Network className="size-4 text-muted-foreground" />
                Relationships ·{" "}
                {asset.relationsFrom.length + asset.relationsTo.length}
              </h2>
              {isAgentUser ? (
                <LinkPicker
                  action={addAssetRelation}
                  triggerLabel="Add relation"
                  title="Add a relationship"
                  description="Define how this configuration item relates to another."
                  hidden={{ sourceId: asset.id }}
                  valueName="targetId"
                  options={relationTargetOpts}
                  placeholder="Choose an asset"
                  searchPlaceholder="Search assets…"
                  emptyText="No other assets to relate to."
                  submitLabel="Add relationship"
                  typeName="type"
                  typeOptions={relationTypeOpts}
                  typeDefault="DEPENDS_ON"
                />
              ) : null}
            </div>
            {asset.relationsFrom.length + asset.relationsTo.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No related configuration items.
              </p>
            ) : (
              <div className="grid gap-2">
                {asset.relationsFrom.map((r) => (
                  <div
                    key={r.id}
                    className="group flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm hover:border-primary/40"
                  >
                    <Link href={`/assets/${r.targetId}`} className="flex min-w-0 flex-1 items-center gap-2">
                      <HardDrive className="size-4 text-indigo-500" />
                      <span className="text-muted-foreground">This</span>
                      <ToneBadge meta={metaFor(ASSET_RELATION_META, r.type)} />
                      <span className="font-medium">{r.target.name}</span>
                    </Link>
                    {isAgentUser ? <RelationUnlink relationId={r.id} assetId={asset.id} /> : null}
                  </div>
                ))}
                {asset.relationsTo.map((r) => (
                  <div
                    key={r.id}
                    className="group flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm hover:border-primary/40"
                  >
                    <Link href={`/assets/${r.sourceId}`} className="flex min-w-0 flex-1 items-center gap-2">
                      <HardDrive className="size-4 text-indigo-500" />
                      <span className="font-medium">{r.source.name}</span>
                      <ToneBadge meta={metaFor(ASSET_RELATION_META, r.type)} />
                      <span className="text-muted-foreground">this</span>
                    </Link>
                    {isAgentUser ? <RelationUnlink relationId={r.id} assetId={asset.id} /> : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Impact / blast radius */}
          <ImpactGraph impact={impact} />

          {/* Linked tickets */}
          <div className="mt-8">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
              <TicketIcon className="size-4 text-muted-foreground" />
              Linked tickets · {asset.tickets.length}
            </h2>
            {asset.tickets.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No tickets linked to this asset.
              </p>
            ) : (
              <div className="grid gap-2">
                {asset.tickets.map((ta) => (
                  <Link
                    key={ta.ticketId}
                    href={`/tickets/${ta.ticketId}`}
                    className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2 text-sm hover:border-primary/40"
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      {ticketRef(ta.ticket.id, ta.ticket.prefix)}
                    </span>
                    <span className="line-clamp-1 flex-1 font-medium">
                      {ta.ticket.title}
                    </span>
                    <StatusBadge
                      map={TICKET_STATUS_META}
                      value={ta.ticket.status}
                    />
                  </Link>
                ))}
              </div>
            )}
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
            <CardTitle className="text-sm"><HistoryHeading /></CardTitle>
          </CardHeader>
          <CardContent>
            <EntityHistory entity="Asset" entityId={asset.id} />
          </CardContent>
        </Card>
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

function RelationUnlink({ relationId, assetId }: { relationId: string; assetId: string }) {
  return (
    <ConfirmButton
      action={deleteAssetRelation}
      fields={{ relationId, assetId }}
      title="Remove relationship?"
      description="This relationship will be removed from the asset graph."
      confirmLabel="Remove"
      triggerVariant="ghost"
      triggerSize="icon-xs"
      triggerClassName="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
      triggerLabel="Remove relationship"
    >
      <X className="size-3.5" />
    </ConfirmButton>
  );
}
