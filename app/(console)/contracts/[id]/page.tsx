import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser, hasRole } from "@/lib/session";
import { CONTRACT_STATUS_META, CONTRACT_TYPE_META } from "@/lib/constants";
import { expiryNotice, formatCost, formatDay } from "@/lib/contract-rules";
import type { SearchParams } from "@/lib/query";
import { deleteContract } from "@/lib/actions/contracts";
import { StatusBadge } from "@/components/status-badge";
import { ConfirmButton } from "@/components/confirm-dialog";
import { EntityTabs, resolveTab, type EntityTab } from "@/components/entity-tabs";
import { getContractFormOptions } from "@/components/contracts/contract-options";
import { ContractDialog } from "@/components/contracts/contract-dialog";
import { ContractExpiryBadge } from "@/components/contracts/contract-badges";
import { ContractAssetsTab, ContractLicensesTab } from "@/components/contracts/detail-tabs";
import { DetailShell, DetailTitle, DetailTopBar, MetaRow, Notice, NotesBlock, RailCard } from "@/components/contracts/detail-bits";

export const dynamic = "force-dynamic";

type ContractTab = "overview" | "assets" | "licenses";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const contract = await db.contract.findUnique({ where: { id }, select: { name: true } });
  return { title: contract?.name ?? "Contract" };
}

export default async function ContractDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const [contract, me] = await Promise.all([
    db.contract.findUnique({
      where: { id },
      include: {
        vendor: { select: { id: true, name: true } },
        owner: { select: { name: true, email: true } },
        _count: { select: { assets: true, licenses: true } },
      },
    }),
    requireUser(),
  ]);
  if (!contract) notFound();

  const now = new Date();
  const canWrite = !!me && hasRole(me.role, "MANAGER");
  const options = canWrite ? await getContractFormOptions() : null;
  const notice = expiryNotice(contract, now);

  const tabs: EntityTab<ContractTab>[] = [
    { key: "overview", label: "Overview" },
    { key: "assets", label: "Assets", count: contract._count.assets },
    { key: "licenses", label: "Licenses", count: contract._count.licenses },
  ];
  const active = resolveTab(sp, tabs, "overview");

  return (
    <DetailShell
      aside={
        <>
          <RailCard title="Properties">
            <MetaRow label="Vendor">
              {contract.vendor ? (
                <Link href={`/contracts/vendors/${contract.vendor.id}`} className="hover:text-primary">{contract.vendor.name}</Link>
              ) : "—"}
            </MetaRow>
            <MetaRow label="Owner">{contract.owner ? (contract.owner.name ?? contract.owner.email) : "—"}</MetaRow>
            <MetaRow label="Number">{contract.number ?? "—"}</MetaRow>
            <MetaRow label="Updated">{formatDay(contract.updatedAt)}</MetaRow>
          </RailCard>
          <RailCard title="Term and cost">
            <MetaRow label="Starts">{formatDay(contract.startDate)}</MetaRow>
            <MetaRow label="Ends">{contract.endDate ? formatDay(contract.endDate) : "No end date"}</MetaRow>
            <MetaRow label="Renewal notice">{contract.renewalNoticeDays} days</MetaRow>
            <MetaRow label="Auto-renews">{contract.autoRenew ? "Yes" : "No"}</MetaRow>
            <MetaRow label="Cost">{contract.cost != null ? formatCost(contract.cost) : "—"}</MetaRow>
          </RailCard>
        </>
      }
    >
      <DetailTopBar
        backHref="/contracts"
        backLabel="Back to contracts"
        lead={
          <>
            {contract.number ? <span className="font-mono text-sm text-muted-foreground">{contract.number}</span> : null}
            <StatusBadge map={CONTRACT_TYPE_META} value={contract.type} dot={false} />
          </>
        }
      >
        {canWrite && options ? (
          <>
            <ContractDialog contract={contract} options={options} />
            <ConfirmButton
              action={deleteContract}
              fields={{ id: contract.id }}
              title="Delete contract"
              description={`Permanently delete "${contract.name}"? Its licenses are kept but unlinked from the contract. This can't be undone.`}
              confirmLabel="Delete contract"
              triggerVariant="outline"
              triggerClassName="text-muted-foreground hover:border-destructive/40 hover:text-destructive"
              triggerLabel="Delete contract"
            >
              <Trash2 className="size-4" />
            </ConfirmButton>
          </>
        ) : null}
        <ContractExpiryBadge contract={contract} now={now} />
        <StatusBadge map={CONTRACT_STATUS_META} value={contract.status} />
      </DetailTopBar>

      <div className="p-4 sm:p-6">
        <DetailTitle
          title={contract.name}
          subtitle={contract.vendor ? `${CONTRACT_TYPE_META[contract.type]?.label ?? contract.type} contract with ${contract.vendor.name}` : `${CONTRACT_TYPE_META[contract.type]?.label ?? contract.type} contract`}
        />

        <EntityTabs
          className="mt-4"
          tabs={tabs}
          active={active}
          defaultTab="overview"
          basePath={`/contracts/${contract.id}`}
          searchParams={sp}
          label="Contract sections"
        />

        <div className="mt-6 grid gap-4">
          {active === "overview" ? (
            <>
              {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
              {!contract.owner && contract.status === "ACTIVE" ? (
                <Notice>This contract has no owner, so nobody will be reminded before it ends.</Notice>
              ) : null}
              <NotesBlock notes={contract.notes} />
            </>
          ) : null}
          {active === "assets" ? <ContractAssetsTab contractId={contract.id} canWrite={canWrite} /> : null}
          {active === "licenses" ? <ContractLicensesTab contractId={contract.id} /> : null}
        </div>
      </div>
    </DetailShell>
  );
}
