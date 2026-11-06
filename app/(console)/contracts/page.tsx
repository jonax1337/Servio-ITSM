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

export const metadata: Metadata = { title: "Contracts" };
export const dynamic = "force-dynamic";

type TabKey = "contracts" | "licenses" | "vendors";

/** One line per section so the difference between the three record kinds is clear at a glance. */
const TAB_HINTS: Record<TabKey, string> = {
  contracts: "Agreements with a vendor: support, leases, warranties. Each has a term and an owner who is reminded before it ends.",
  licenses: "Pools of software seats you assign to users and assets. Over-allocated pools are flagged and their owner is alerted.",
  vendors: "The suppliers behind your contracts and licenses.",
};

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

  const [contractCount, licenseCount, vendorCount, needAttention, overAllocated] = await Promise.all([
    db.contract.count(),
    db.softwareLicense.count(),
    db.vendor.count(),
    countContractsNeedingAttention(new Date()),
    countOverAllocatedLicenses(),
  ]);

  const tabs: EntityTab<TabKey>[] = [
    { key: "contracts", label: "Contracts", count: contractCount, warning: needAttention > 0 ? `${needAttention} expiring or expired` : undefined },
    { key: "licenses", label: "Licenses", count: licenseCount, warning: overAllocated > 0 ? `${overAllocated} over-allocated` : undefined },
    { key: "vendors", label: "Vendors", count: vendorCount },
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
        title="Contracts"
        description="Vendors, contracts and software licenses, with renewal reminders and seat compliance."
      >
        {active === "contracts" ? createContract : null}
        {active === "licenses" ? createLicense : null}
        {active === "vendors" ? createVendor : null}
      </PageHeader>

      <PageBody className="grid gap-4">
        {/* Tab links carry only ?tab=, so one tab's filters never leak into another. */}
        <EntityTabs tabs={tabs} active={active} defaultTab="contracts" basePath="/contracts" searchParams={{}} label="Contract sections" />
        <p className="-mt-2 text-sm text-muted-foreground">{TAB_HINTS[active]}</p>
        {active === "contracts" ? <ContractList sp={sp} createAction={createContract} /> : null}
        {active === "licenses" ? <LicenseList sp={sp} createAction={createLicense} /> : null}
        {active === "vendors" ? <VendorList sp={sp} createAction={createVendor} /> : null}
      </PageBody>
    </>
  );
}
