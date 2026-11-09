import { canReadConsoleTitle } from "@/lib/metadata-access";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser, hasRole } from "@/lib/session";
import { LICENSE_TYPE_META } from "@/lib/constants";
import { licenseCompliance } from "@/lib/contract-rules";
import { getEnumT, getT } from "@/lib/i18n/server";
import { formatCostIn, formatDayIn } from "@/components/contracts/contract-format";
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
  if (!(await canReadConsoleTitle())) return {};
  const { id } = await params;
  const license = await db.softwareLicense.findUnique({ where: { id }, select: { name: true } });
  return { title: license?.name ?? (await getT("contracts"))("entity.license") };
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
  const [t, tc, te] = await Promise.all([getT("contracts"), getT("common"), getEnumT()]);
  const day = (d: Date) => formatDayIn(t.locale, d);
  const canWrite = !!me && hasRole(me.role, "MANAGER");
  const options = canWrite ? await getContractFormOptions() : null;
  const compliance = licenseCompliance(license.seats, license._count.assignments);
  const licenseType = LICENSE_TYPE_META[license.licenseType] ? te(LICENSE_TYPE_META, license.licenseType) : license.licenseType;

  const tabs: EntityTab<LicenseTab>[] = [
    { key: "overview", label: t("tab.overview") },
    {
      key: "seats",
      label: t("col.seats"),
      count: license._count.assignments,
      warning: compliance.state === "OVER" ? t("seats.overBy", { count: compliance.overBy }) : undefined,
    },
  ];
  const active = resolveTab(sp, tabs, "overview");

  return (
    <DetailShell
      aside={
        <>
          <RailCard title={tc("properties")}>
            <MetaRow label={t("col.vendor")}>
              {license.vendor ? (
                <Link href={`/contracts/vendors/${license.vendor.id}`} className="hover:text-primary">{license.vendor.name}</Link>
              ) : "—"}
            </MetaRow>
            <MetaRow label={t("col.contract")}>
              {license.contract ? (
                <Link href={`/contracts/${license.contract.id}`} className="hover:text-primary">{license.contract.name}</Link>
              ) : "—"}
            </MetaRow>
            <MetaRow label={tc("owner")}>{license.owner ? (license.owner.name ?? license.owner.email) : "—"}</MetaRow>
            <MetaRow label={tc("updated")}>{day(license.updatedAt)}</MetaRow>
          </RailCard>
          <RailCard title={t("seatsAndCost")}>
            <MetaRow label={t("seats.purchased")}>{license.seats}</MetaRow>
            <MetaRow label={t("seats.assigned")}>{compliance.used}</MetaRow>
            <MetaRow label={t("col.expires")}>{license.expiresAt ? day(license.expiresAt) : tc("never")}</MetaRow>
            <MetaRow label={t("col.cost")}>{license.cost != null ? formatCostIn(t.locale, license.cost) : "—"}</MetaRow>
          </RailCard>
          <RecordAttachments target={{ licenseId: license.id }} role={me?.role ?? "USER"} />
        </>
      }
    >
      <DetailTopBar
        backHref="/contracts?tab=licenses"
        backLabel={t("backToLicenses")}
        lead={<StatusBadge map={LICENSE_TYPE_META} value={license.licenseType} dot={false} />}
      >
        {canWrite && options ? (
          <>
            <LicenseDialog license={license} options={options} />
            <ConfirmButton
              action={deleteLicense}
              fields={{ id: license.id }}
              title={t("deleteLicense")}
              description={compliance.used > 0 ? t("deleteLicenseDescriptionSeats", { name: license.name, count: compliance.used }) : t("deleteLicenseDescription", { name: license.name })}
              confirmLabel={t("deleteLicense")}
              triggerVariant="outline"
              triggerClassName="text-muted-foreground hover:border-destructive/40 hover:text-destructive"
              triggerLabel={t("deleteLicense")}
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
          subtitle={license.vendor ? t("licenseSubtitleWithVendor", { type: licenseType, vendor: license.vendor.name }) : t("licenseSubtitle", { type: licenseType })}
        />

        <EntityTabs
          className="mt-4"
          tabs={tabs}
          active={active}
          defaultTab="overview"
          basePath={`/contracts/licenses/${license.id}`}
          searchParams={sp}
          label={t("licenseSections")}
        />

        <div className="mt-6 grid gap-4">
          {active === "overview" ? (
            <>
              {compliance.state === "OVER" ? (
                <Notice tone="danger">
                  {t("seats.overNotice", { count: compliance.overBy })}
                  {license.owner ? "" : ` ${t("seats.assignOwnerHint")}`}
                </Notice>
              ) : null}
              <div className="grid gap-2 rounded-xl border bg-card p-4">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="font-medium">{t("seats.usage")}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {t("seats.usageValue", { used: compliance.used, seats: compliance.seats })}{compliance.free > 0 ? ` · ${t("seats.free", { count: compliance.free })}` : ""}
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
