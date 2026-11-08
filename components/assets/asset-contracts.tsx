import Link from "next/link";
import { FileSignature, KeyRound } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser, hasRole, isAgent } from "@/lib/session";
import { CONTRACT_STATUS_META } from "@/lib/constants";
import { licenseCompliance } from "@/lib/contract-rules";
import { getT } from "@/lib/i18n/server";
import { formatDayIn } from "@/components/contracts/contract-format";
import { linkContractAsset, unlinkContractAsset, assignLicense, unassignLicense } from "@/lib/actions/contracts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/status-badge";
import { LinkPicker } from "@/components/link-picker";
import { UnlinkButton } from "@/components/linked-records";
import { ContractExpiryBadge, LicenseComplianceBadge } from "@/components/contracts/contract-badges";

export type AssetContractsProps = {
  /** Asset ids are cuid strings. */
  assetId: string;
  /** MANAGER+ may link / unlink contracts and license seats. */
  canEdit: boolean;
};

/** Contracts and license seats covering an asset; managers can link and unlink them. */
export async function AssetContracts({ assetId, canEdit }: AssetContractsProps) {
  const me = await requireUser();
  if (!isAgent(me.role)) return null;
  const editable = canEdit && hasRole(me.role, "MANAGER");

  const [covering, seats] = await Promise.all([
    db.contractAsset.findMany({
      where: { assetId },
      orderBy: { createdAt: "asc" },
      select: {
        contract: {
          select: { id: true, name: true, status: true, endDate: true, renewalNoticeDays: true, vendor: { select: { name: true } } },
        },
      },
    }),
    db.licenseAssignment.findMany({
      where: { assetId },
      orderBy: { assignedAt: "asc" },
      select: {
        id: true,
        user: { select: { name: true, email: true } },
        license: {
          select: { id: true, name: true, seats: true, _count: { select: { assignments: true } } },
        },
      },
    }),
  ]);

  const linkableContracts = editable
    ? await db.contract.findMany({
        where: { id: { notIn: covering.map((row) => row.contract.id) } },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      })
    : [];
  const assignableLicenses = editable
    ? await db.softwareLicense.findMany({
        where: { id: { notIn: seats.map((row) => row.license.id) } },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      })
    : [];

  const now = new Date();
  const t = await getT("assets");
  const tk = await getT("contracts");

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <FileSignature className="size-4 text-muted-foreground" />
            {tk("contractsCount", { count: covering.length })}
            {editable ? (
              <span className="ml-auto">
                <LinkPicker
                  action={linkContractAsset}
                  triggerLabel={t("contracts.add")}
                  title={t("contracts.addTitle")}
                  description={t("contracts.addDescription")}
                  hidden={{ assetId }}
                  valueName="contractId"
                  options={linkableContracts.map((c) => ({ value: c.id, label: c.name }))}
                  placeholder={t("contracts.choose")}
                  searchPlaceholder={tk("searchContracts")}
                  emptyText={t("contracts.noneAvailable")}
                  submitLabel={tk("addShort")}
                  successMessage={t("contracts.added")}
                />
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {covering.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {editable ? t("contracts.emptyEditable") : t("contracts.empty")}
            </p>
          ) : (
            covering.map(({ contract }) => (
              <div key={contract.id} className="group/chip flex flex-wrap items-center gap-2">
                <Link href={`/contracts/${contract.id}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:text-primary">
                  {contract.name}
                  {contract.vendor ? <span className="font-normal text-muted-foreground"> · {contract.vendor.name}</span> : null}
                </Link>
                {contract.endDate ? <span className="text-xs tabular-nums text-muted-foreground">{tk("endsOn", { date: formatDayIn(tk.locale, contract.endDate) })}</span> : null}
                <ContractExpiryBadge contract={contract} now={now} />
                <StatusBadge map={CONTRACT_STATUS_META} value={contract.status} />
                {editable ? (
                  <UnlinkButton action={unlinkContractAsset} fields={{ contractId: contract.id, assetId }} successMessage={t("contracts.removed")} />
                ) : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <KeyRound className="size-4 text-muted-foreground" />
            {tk("licensesCount", { count: seats.length })}
            {editable ? (
              <span className="ml-auto">
                <LinkPicker
                  action={assignLicense}
                  triggerLabel={t("licenses.assign")}
                  title={t("licenses.assignTitle")}
                  description={t("licenses.assignDescription")}
                  hidden={{ assetId }}
                  valueName="licenseId"
                  options={assignableLicenses.map((l) => ({ value: l.id, label: l.name }))}
                  placeholder={t("licenses.choose")}
                  searchPlaceholder={tk("searchLicenses")}
                  emptyText={t("licenses.noneAvailable")}
                  submitLabel={tk("seats.assign")}
                  successMessage={tk("seats.assignedToast")}
                />
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {seats.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {editable ? t("licenses.emptyEditable") : t("licenses.empty")}
            </p>
          ) : (
            seats.map((seat) => (
              <div key={seat.id} className="group/chip flex flex-wrap items-center gap-2">
                <Link href={`/contracts/licenses/${seat.license.id}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:text-primary">
                  {seat.license.name}
                  {seat.user ? <span className="font-normal text-muted-foreground"> · {seat.user.name ?? seat.user.email}</span> : null}
                </Link>
                <LicenseComplianceBadge compliance={licenseCompliance(seat.license.seats, seat.license._count.assignments)} />
                {editable ? <UnlinkButton action={unassignLicense} fields={{ assignmentId: seat.id }} successMessage={tk("seats.released")} /> : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
