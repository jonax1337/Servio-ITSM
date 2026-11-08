import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, Server, ChevronRight } from "lucide-react";
import { db } from "@/lib/db";
import { LinkButton } from "@/components/link-button";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { LocationDialog } from "@/components/locations/location-dialog";
import { DeleteLocationButton } from "@/components/locations/delete-location-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { LOCATION_TYPE_META, ASSET_TYPE_META, ASSET_STATUS_META } from "@/lib/constants";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
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

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <LinkButton href="/locations" variant="ghost" size="icon-sm" aria-label={t("backToList")}><ArrowLeft className="size-4" /></LinkButton>
          <StatusBadge map={LOCATION_TYPE_META} value={location.type} />
          {location.parent ? (
            <span className="flex items-center gap-1 text-sm text-muted-foreground">
              <Link href={`/locations/${location.parent.id}`} className="hover:text-foreground">{location.parent.name}</Link>
              <ChevronRight className="size-3.5" />
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
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
        </div>
      </div>

      <h1 className="font-display text-2xl font-semibold tracking-tight">{location.name}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {[location.address, location.city, location.country].filter(Boolean).join(", ") || t("noAddress")}
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
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
        </div>

        <div>
          <Card>
            <CardHeader><CardTitle className="text-sm">{t("subLocations")}</CardTitle></CardHeader>
            <CardContent className="grid gap-1">
              {location.children.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noSubLocations")}</p>
              ) : (
                location.children.map((c) => (
                  <Link key={c.id} href={`/locations/${c.id}`} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted">
                    <span className="flex items-center gap-2">
                      <StatusBadge map={LOCATION_TYPE_META} value={c.type} />
                      {c.name}
                    </span>
                    <span className="text-xs text-muted-foreground">{c._count.assets}</span>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
          {location.notes ? (
            <Card className="mt-4">
              <CardHeader><CardTitle className="text-sm">{tc("notes")}</CardTitle></CardHeader>
              <CardContent className="whitespace-pre-wrap text-sm text-muted-foreground">{location.notes}</CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
