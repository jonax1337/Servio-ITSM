import type { Metadata } from "next";
import { FileSignature } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser, hasRole } from "@/lib/session";
import type { SearchParams } from "@/lib/query";
import { contractExpiry, licenseCompliance } from "@/lib/contract-rules";
import { PageHeader, PageBody } from "@/components/page-header";
import { EntityTabs, resolveTab, type EntityTab } from "@/components/entity-tabs";
import { getContractFormOptions } from "@/components/contracts/contract-options";
import { ContractDialog } from "@/components/contracts/contract-dialog";
import { LicenseDialog } from "@/components/contracts/license-dialog";
import { VendorDialog } from "@/components/contracts/vendor-dialog";
import { ContractList } from "@/components/contracts/contract-list";
import { LicenseList } from "@/components/contracts/license-list";
import { VendorList } from "@/components/contracts/vendor-list";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("contracts");
  return { title: t("title") };
}
export const dynamic = "force-dynamic";

type TabKey = "contracts" | "licenses" | "vendors";

/** Contracts that need attention: inside their renewal notice period, or already past their end date. */
async function countContractsNeedingAttention(now: Date): Promise<number> {
  const active = await db.contract.findMany({
    where: { status: "ACTIVE", endDate: { not: null } },
    select: { status: true, endDate: true, renewalNoticeDays: true },
  });
  return active.filter((c) => contractExpiry(c, now) !== "OK").length;
}

async function countOverAllocatedLicenses(): Promise<number> {
  const licenses = await db.softwareLicense.findMany({
    select: { seats: true, _count: { select: { assignments: true } } },
  });
  return licenses.filter((l) => licenseCompliance(l.seats, l._count.assignments).state === "OVER").length;
}

export default async function ContractsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const me = await requireUser();
  const canWrite = !!me && hasRole(me.role, "MANAGER");
  const t = await getT("contracts");

  const [contractCount, licenseCount, vendorCount, needAttention, overAllocated] = await Promise.all([
    db.contract.count(),
    db.softwareLicense.count(),
    db.vendor.count(),
    countContractsNeedingAttention(new Date()),
    countOverAllocatedLicenses(),
  ]);

  const tabs: EntityTab<TabKey>[] = [
    { key: "contracts", label: t("tab.contracts"), count: contractCount, warning: needAttention > 0 ? t("tab.contractsWarning", { count: needAttention }) : undefined },
    { key: "licenses", label: t("tab.licenses"), count: licenseCount, warning: overAllocated > 0 ? t("tab.licensesWarning", { count: overAllocated }) : undefined },
    { key: "vendors", label: t("tab.vendors"), count: vendorCount },
  ];
  const active = resolveTab(sp, tabs, "contracts");
  const options = canWrite ? await getContractFormOptions() : null;
  const createContract = options ? <ContractDialog options={options} currentUserId={me?.id} /> : null;
  const createLicense = options ? <LicenseDialog options={options} currentUserId={me?.id} /> : null;
  const createVendor = canWrite ? <VendorDialog /> : null;

  return (
    <>
      <PageHeader
        icon={FileSignature}
        title={t("title")}
        description={t("description")}
      >
        {active === "contracts" ? createContract : null}
        {active === "licenses" ? createLicense : null}
        {active === "vendors" ? createVendor : null}
      </PageHeader>

      <PageBody className="grid gap-4">
        {/* Tab links carry only ?tab=, so one tab's filters never leak into another. */}
        <EntityTabs tabs={tabs} active={active} defaultTab="contracts" basePath="/contracts" searchParams={{}} label={t("sections")} />
        <p className="-mt-2 text-sm text-muted-foreground">{t(`hint.${active}`)}</p>
        {active === "contracts" ? <ContractList sp={sp} createAction={createContract} /> : null}
        {active === "licenses" ? <LicenseList sp={sp} createAction={createLicense} /> : null}
        {active === "vendors" ? <VendorList sp={sp} createAction={createVendor} /> : null}
      </PageBody>
    </>
  );
}
