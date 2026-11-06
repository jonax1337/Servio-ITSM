import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser, hasRole } from "@/lib/session";
import { formatDay } from "@/lib/contract-rules";
import type { SearchParams } from "@/lib/query";
import { deleteVendor } from "@/lib/actions/contracts";
import { ToneBadge } from "@/components/status-badge";
import { ConfirmButton } from "@/components/confirm-dialog";
import { EntityTabs, resolveTab, type EntityTab } from "@/components/entity-tabs";
import { VendorDialog } from "@/components/contracts/vendor-dialog";
import { VendorContractsTab, VendorLicensesTab } from "@/components/contracts/detail-tabs";
import { DetailShell, DetailTitle, DetailTopBar, MetaRow, NotesBlock, RailCard } from "@/components/contracts/detail-bits";

export const dynamic = "force-dynamic";

type VendorTab = "overview" | "contracts" | "licenses";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const vendor = await db.vendor.findUnique({ where: { id }, select: { name: true } });
  return { title: vendor?.name ?? "Vendor" };
}

const isWebAddress = (value: string) => /^https?:\/\//i.test(value);

export default async function VendorDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const [vendor, me] = await Promise.all([
    db.vendor.findUnique({
      where: { id },
      include: { _count: { select: { contracts: true, licenses: true } } },
    }),
    requireUser(),
  ]);
  if (!vendor) notFound();

  const now = new Date();
  const canWrite = !!me && hasRole(me.role, "MANAGER");

  const tabs: EntityTab<VendorTab>[] = [
    { key: "overview", label: "Overview" },
    { key: "contracts", label: "Contracts", count: vendor._count.contracts },
    { key: "licenses", label: "Licenses", count: vendor._count.licenses },
  ];
  const active = resolveTab(sp, tabs, "overview");

  return (
    <DetailShell
      aside={
        <>
          <RailCard title="Contact">
            <MetaRow label="Website">
              {vendor.website && isWebAddress(vendor.website) ? (
                <a href={vendor.website} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">
                  {vendor.website.replace(/^https?:\/\//i, "")}
                </a>
              ) : (vendor.website ?? "—")}
            </MetaRow>
            <MetaRow label="Email">
              {vendor.email ? <a href={`mailto:${vendor.email}`} className="text-primary hover:underline">{vendor.email}</a> : "—"}
            </MetaRow>
            <MetaRow label="Phone">{vendor.phone ?? "—"}</MetaRow>
          </RailCard>
          <RailCard title="Relationship">
            <MetaRow label="Contracts">{vendor._count.contracts}</MetaRow>
            <MetaRow label="Licenses">{vendor._count.licenses}</MetaRow>
            <MetaRow label="Added">{formatDay(vendor.createdAt)}</MetaRow>
          </RailCard>
        </>
      }
    >
      <DetailTopBar backHref="/contracts?tab=vendors" backLabel="Back to vendors">
        {canWrite ? (
          <>
            <VendorDialog vendor={vendor} />
            <ConfirmButton
              action={deleteVendor}
              fields={{ id: vendor.id }}
              title="Delete vendor"
              description={`Permanently delete "${vendor.name}"? Its contracts and licenses are kept but lose their vendor. This can't be undone.`}
              confirmLabel="Delete vendor"
              triggerVariant="outline"
              triggerClassName="text-muted-foreground hover:border-destructive/40 hover:text-destructive"
              triggerLabel="Delete vendor"
            >
              <Trash2 className="size-4" />
            </ConfirmButton>
          </>
        ) : null}
        <ToneBadge meta={vendor.isActive ? { label: "Active", tone: "success" } : { label: "Inactive", tone: "neutral" }} dot />
      </DetailTopBar>

      <div className="p-4 sm:p-6">
        <DetailTitle title={vendor.name} subtitle="Vendor" />

        <EntityTabs
          className="mt-4"
          tabs={tabs}
          active={active}
          defaultTab="overview"
          basePath={`/contracts/vendors/${vendor.id}`}
          searchParams={sp}
          label="Vendor sections"
        />

        <div className="mt-6 grid gap-4">
          {active === "overview" ? <NotesBlock notes={vendor.notes} /> : null}
          {active === "contracts" ? <VendorContractsTab vendorId={vendor.id} now={now} /> : null}
          {active === "licenses" ? <VendorLicensesTab vendorId={vendor.id} /> : null}
        </div>
      </div>
    </DetailShell>
  );
}
