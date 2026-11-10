import { canReadConsoleTitle } from "@/lib/metadata-access";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { MapPin, Server } from "lucide-react";
import { db } from "@/lib/db";
import { DetailShell, DetailTitle, DetailTopBar, MetaRow, RailCard } from "@/components/detail-layout";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { LocationDialog } from "@/components/locations/location-dialog";
import { DeleteLocationButton } from "@/components/locations/delete-location-button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { LOCATION_TYPE_META, ASSET_TYPE_META, ASSET_STATUS_META } from "@/lib/constants";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  if (!(await canReadConsoleTitle())) return {};
  const { id } = await params;
  const l = await db.location.findUnique({ where: { id }, select: { name: true } });
  return { title: l?.name ?? (await getT("locations"))("entity") };
}

export default async function LocationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [t, tc] = await Promise.all([getT("locations"), getT("common")]);
  const location = await db.location.findUnique({
    where: { id },
    include: {
      parent: true,
      children: { include: { _count: { select: { assets: true } } }, orderBy: { name: "asc" } },
      assets: { orderBy: { name: "asc" } },
    },
  });
  if (!location) notFound();

  const allLocations = await db.location.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  const parents = allLocations.map((l) => ({ value: l.id, label: l.name }));

  const rail = (
    <>
      <RailCard title={tc("details")}>
        <MetaRow label={t("dialog.inside")}>
          {location.parent ? (
            <Link href={`/locations/${location.parent.id}`} className="hover:text-primary">{location.parent.name}</Link>
          ) : (
            "—"
          )}
        </MetaRow>
        <MetaRow label={t("dialog.address")}>{location.address ?? "—"}</MetaRow>
        <MetaRow label={t("dialog.city")}>{location.city ?? "—"}</MetaRow>
        <MetaRow label={t("dialog.country")}>{location.country ?? "—"}</MetaRow>
      </RailCard>

      {location.notes ? (
        <RailCard title={tc("notes")}>
          <p className="whitespace-pre-wrap text-muted-foreground">{location.notes}</p>
        </RailCard>
      ) : null}
    </>
  );

  return (
    <DetailShell aside={rail}>
      <DetailTopBar
        backHref="/locations"
        backLabel={t("backToList")}
        lead={<StatusBadge map={LOCATION_TYPE_META} value={location.type} />}
      >
        <LocationDialog
          parents={parents}
          location={{
            id: location.id, name: location.name, type: location.type, parentId: location.parentId,
            address: location.address, city: location.city, country: location.country, notes: location.notes,
          }}
        />
        <DeleteLocationButton
          id={location.id}
          name={location.name}
          assetCount={location.assets.length}
          childCount={location.children.length}
        />
      </DetailTopBar>

      <div className="p-4 sm:p-6">
        <DetailTitle
          title={location.name}
          subtitle={[location.address, location.city, location.country].filter(Boolean).join(", ") || t("noAddress")}
        />

        <section className="mt-6">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Server className="size-4 text-muted-foreground" /> {t("assetsHere", { count: location.assets.length })}
          </h2>
          {location.assets.length === 0 ? (
            <EmptyState icon={Server} title={t("noAssetsTitle")} description={t("noAssetsDescription")} />
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t("col.asset")}</TableHead>
                    <TableHead>{tc("type")}</TableHead>
                    <TableHead>{tc("status")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {location.assets.map((a) => (
                    <TableRow key={a.id} className="group">
                      <TableCell>
                        <Link href={`/assets/${a.id}`} className="font-medium group-hover:text-primary">
                          {a.name}
                        </Link>
                        {a.assetTag ? <span className="ml-2 font-mono text-xs text-muted-foreground">{a.assetTag}</span> : null}
                      </TableCell>
                      <TableCell><StatusBadge map={ASSET_TYPE_META} value={a.type} /></TableCell>
                      <TableCell><StatusBadge map={ASSET_STATUS_META} value={a.status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        <section className="mt-8">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <MapPin className="size-4 text-muted-foreground" /> {t("subLocations")}
          </h2>
          {location.children.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("noSubLocations")}</p>
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card">
              {location.children.map((c) => (
                <Link
                  key={c.id}
                  href={`/locations/${c.id}`}
                  className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0 hover:bg-accent"
                >
                  <StatusBadge map={LOCATION_TYPE_META} value={c.type} />
                  <span className="line-clamp-1 flex-1 text-sm font-medium">{c.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{c._count.assets}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </DetailShell>
  );
}
