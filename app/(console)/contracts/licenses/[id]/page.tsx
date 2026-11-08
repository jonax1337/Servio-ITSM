import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser, hasRole } from "@/lib/session";
import { LICENSE_TYPE_META } from "@/lib/constants";
import { formatCost, formatDay, licenseCompliance } from "@/lib/contract-rules";
import type { SearchParams } from "@/lib/query";
import { deleteLicense } from "@/lib/actions/contracts";
import { StatusBadge } from "@/components/status-badge";
import { ConfirmButton } from "@/components/confirm-dialog";
import { EntityTabs, resolveTab, type EntityTab } from "@/components/entity-tabs";
import { getContractFormOptions } from "@/components/contracts/contract-options";
import { LicenseDialog } from "@/components/contracts/license-dialog";
import { LicenseExpiryBadge, LicenseComplianceBadge, SeatMeter } from "@/components/contracts/contract-badges";
import { LicenseSeatsTab } from "@/components/contracts/detail-tabs";
import { DetailShell, DetailTitle, DetailTopBar, MetaRow, Notice, NotesBlock, RailCard } from "@/components/contracts/detail-bits";
import { RecordAttachments } from "@/components/attachments/record-attachments";

export const dynamic = "force-dynamic";

type LicenseTab = "overview" | "seats";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const license = await db.softwareLicense.findUnique({ where: { id }, select: { name: true } });
  return { title: license?.name ?? "License" };
}

export default async function LicenseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const [license, me] = await Promise.all([
    db.softwareLicense.findUnique({
      where: { id },
      include: {
        vendor: { select: { id: true, name: true } },
        contract: { select: { id: true, name: true } },
        owner: { select: { name: true, email: true } },
        _count: { select: { assignments: true } },
      },
    }),
    requireUser(),
  ]);
  if (!license) notFound();

  const now = new Date();
  const canWrite = !!me && hasRole(me.role, "MANAGER");
  const options = canWrite ? await getContractFormOptions() : null;
  const compliance = licenseCompliance(license.seats, license._count.assignments);
  const licenseType = LICENSE_TYPE_META[license.licenseType]?.label ?? license.licenseType;

  const tabs: EntityTab<LicenseTab>[] = [
    { key: "overview", label: "Overview" },
    {
      key: "seats",
      label: "Seats",
      count: license._count.assignments,
      warning: compliance.state === "OVER" ? `Over-allocated by ${compliance.overBy}` : undefined,
    },
  ];
  const active = resolveTab(sp, tabs, "overview");

  return (
    <DetailShell
      aside={
        <>
          <RailCard title="Properties">
            <MetaRow label="Vendor">
              {license.vendor ? (
                <Link href={`/contracts/vendors/${license.vendor.id}`} className="hover:text-primary">{license.vendor.name}</Link>
              ) : "—"}
            </MetaRow>
            <MetaRow label="Contract">
              {license.contract ? (
                <Link href={`/contracts/${license.contract.id}`} className="hover:text-primary">{license.contract.name}</Link>
              ) : "—"}
            </MetaRow>
            <MetaRow label="Owner">{license.owner ? (license.owner.name ?? license.owner.email) : "—"}</MetaRow>
            <MetaRow label="Updated">{formatDay(license.updatedAt)}</MetaRow>
          </RailCard>
          <RailCard title="Seats and cost">
            <MetaRow label="Seats purchased">{license.seats}</MetaRow>
            <MetaRow label="Seats assigned">{compliance.used}</MetaRow>
            <MetaRow label="Expires">{license.expiresAt ? formatDay(license.expiresAt) : "Never"}</MetaRow>
            <MetaRow label="Cost">{license.cost != null ? formatCost(license.cost) : "—"}</MetaRow>
          </RailCard>
          <RecordAttachments target={{ licenseId: license.id }} role={me?.role ?? "USER"} />
        </>
      }
    >
      <DetailTopBar
        backHref="/contracts?tab=licenses"
        backLabel="Back to licenses"
        lead={<StatusBadge map={LICENSE_TYPE_META} value={license.licenseType} dot={false} />}
      >
        {canWrite && options ? (
          <>
            <LicenseDialog license={license} options={options} />
            <ConfirmButton
              action={deleteLicense}
              fields={{ id: license.id }}
              title="Delete license"
              description={`Permanently delete "${license.name}"${compliance.used > 0 ? ` and release its ${compliance.used} assigned ${compliance.used === 1 ? "seat" : "seats"}` : ""}? This can't be undone.`}
              confirmLabel="Delete license"
              triggerVariant="outline"
              triggerClassName="text-muted-foreground hover:border-destructive/40 hover:text-destructive"
              triggerLabel="Delete license"
            >
              <Trash2 className="size-4" />
            </ConfirmButton>
          </>
        ) : null}
        <LicenseExpiryBadge expiresAt={license.expiresAt} now={now} />
        <LicenseComplianceBadge compliance={compliance} />
      </DetailTopBar>

      <div className="p-4 sm:p-6">
        <DetailTitle
          title={license.name}
          subtitle={`${licenseType} license${license.vendor ? ` from ${license.vendor.name}` : ""}`}
        />

        <EntityTabs
          className="mt-4"
          tabs={tabs}
          active={active}
          defaultTab="overview"
          basePath={`/contracts/licenses/${license.id}`}
          searchParams={sp}
          label="License sections"
        />

        <div className="mt-6 grid gap-4">
          {active === "overview" ? (
            <>
              {compliance.state === "OVER" ? (
                <Notice tone="danger">
                  Over-allocated by {compliance.overBy} {compliance.overBy === 1 ? "seat" : "seats"}: release seats or buy more.
                  {license.owner ? "" : " Assign an owner so someone is alerted."}
                </Notice>
              ) : null}
              <div className="grid gap-2 rounded-xl border bg-card p-4">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium">Seat usage</span>
                  <span className="tabular-nums text-muted-foreground">
                    {compliance.used} of {compliance.seats} assigned{compliance.free > 0 ? ` · ${compliance.free} free` : ""}
                  </span>
                </div>
                <SeatMeter compliance={compliance} />
              </div>
              <NotesBlock notes={license.notes} />
            </>
          ) : null}
          {active === "seats" ? <LicenseSeatsTab licenseId={license.id} seats={license.seats} canWrite={canWrite} /> : null}
        </div>
      </div>
    </DetailShell>
  );
}
