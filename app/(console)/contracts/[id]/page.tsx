import { canReadConsoleTitle } from "@/lib/metadata-access";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser, hasRole } from "@/lib/session";
import { CONTRACT_STATUS_META, CONTRACT_TYPE_META } from "@/lib/constants";
import { getEnumT, getT } from "@/lib/i18n/server";
import { expiryNoticeIn, formatCostIn, formatDayIn } from "@/components/contracts/contract-format";
import type { SearchParams } from "@/lib/query";
import { deleteContract } from "@/lib/actions/contracts";
import { StatusBadge } from "@/components/status-badge";
import { ConfirmButton } from "@/components/confirm-dialog";
import { EntityTabs, resolveTab, type EntityTab } from "@/components/entity-tabs";
import { getContractFormOptions } from "@/components/contracts/contract-options";
import { ContractDialog } from "@/components/contracts/contract-dialog";
import { ContractExpiryBadge } from "@/components/contracts/contract-badges";
import { ContractAssetsTab, ContractLicensesTab } from "@/components/contracts/detail-tabs";
import { DetailShell, DetailTitle, DetailTopBar, MetaRow, RailCard } from "@/components/detail-layout";
import { Notice, NotesBlock } from "@/components/contracts/detail-bits";

export const dynamic = "force-dynamic";

type ContractTab = "overview" | "assets" | "licenses";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  if (!(await canReadConsoleTitle())) return {};
  const { id } = await params;
  const contract = await db.contract.findUnique({ where: { id }, select: { name: true } });
  return { title: contract?.name ?? (await getT("contracts"))("entity.contract") };
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
  const [t, tc, te] = await Promise.all([getT("contracts"), getT("common"), getEnumT()]);
  const day = (d: Date) => formatDayIn(t.locale, d);
  const canWrite = !!me && hasRole(me.role, "MANAGER");
  const options = canWrite ? await getContractFormOptions() : null;
  const notice = expiryNoticeIn(t, contract, now);
  const typeLabel = CONTRACT_TYPE_META[contract.type] ? te(CONTRACT_TYPE_META, contract.type) : contract.type;

  const tabs: EntityTab<ContractTab>[] = [
    { key: "overview", label: t("tab.overview") },
    { key: "assets", label: t("tab.assets"), count: contract._count.assets },
    { key: "licenses", label: t("tab.licenses"), count: contract._count.licenses },
  ];
  const active = resolveTab(sp, tabs, "overview");

  return (
    <DetailShell
      aside={
        <>
          <RailCard title={tc("properties")}>
            <MetaRow label={t("col.vendor")}>
              {contract.vendor ? (
                <Link href={`/contracts/vendors/${contract.vendor.id}`} className="hover:text-primary">{contract.vendor.name}</Link>
              ) : "—"}
            </MetaRow>
            <MetaRow label={tc("owner")}>{contract.owner ? (contract.owner.name ?? contract.owner.email) : "—"}</MetaRow>
            <MetaRow label={t("field.number")}>{contract.number ?? "—"}</MetaRow>
            <MetaRow label={tc("updated")}>{day(contract.updatedAt)}</MetaRow>
          </RailCard>
          <RailCard title={t("termAndCost")}>
            <MetaRow label={t("field.starts")}>{contract.startDate ? day(contract.startDate) : t("startUnknown")}</MetaRow>
            <MetaRow label={t("col.ends")}>{contract.endDate ? day(contract.endDate) : t("noEndDate")}</MetaRow>
            <MetaRow label={t("field.renewalNotice")}>{t("days", { count: contract.renewalNoticeDays })}</MetaRow>
            <MetaRow label={t("field.autoRenews")}>{contract.autoRenew ? tc("yes") : tc("no")}</MetaRow>
            <MetaRow label={t("col.cost")}>{contract.cost != null ? formatCostIn(t.locale, contract.cost) : "—"}</MetaRow>
          </RailCard>
        </>
      }
    >
      <DetailTopBar
        backHref="/contracts"
        backLabel={t("backToContracts")}
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
              title={t("deleteContract")}
              description={t("deleteContractDescription", { name: contract.name })}
              confirmLabel={t("deleteContract")}
              triggerVariant="outline"
              triggerClassName="text-muted-foreground hover:border-destructive/40 hover:text-destructive"
              triggerLabel={t("deleteContract")}
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
          subtitle={contract.vendor ? t("subtitleWithVendor", { type: typeLabel, vendor: contract.vendor.name }) : t("subtitle", { type: typeLabel })}
        />

        <EntityTabs
          className="mt-4"
          tabs={tabs}
          active={active}
          defaultTab="overview"
          basePath={`/contracts/${contract.id}`}
          searchParams={sp}
          label={t("contractSections")}
        />

        <div className="mt-6 grid gap-4">
          {active === "overview" ? (
            <>
              {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}
              {!contract.owner && contract.status === "ACTIVE" ? (
                <Notice>{t("noOwnerNotice")}</Notice>
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
