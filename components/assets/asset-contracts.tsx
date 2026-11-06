import Link from "next/link";
import { FileSignature, KeyRound } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser, hasRole, isAgent } from "@/lib/session";
import { CONTRACT_STATUS_META } from "@/lib/constants";
import { formatDay, licenseCompliance } from "@/lib/contract-rules";
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

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <FileSignature className="size-4 text-muted-foreground" />
            Contracts · {covering.length}
            {editable ? (
              <span className="ml-auto">
                <LinkPicker
                  action={linkContractAsset}
                  triggerLabel="Add contract"
                  title="Cover this asset with a contract"
                  description="Records that this asset is covered by the contract, for example its support or warranty."
                  hidden={{ assetId }}
                  valueName="contractId"
                  options={linkableContracts.map((c) => ({ value: c.id, label: c.name }))}
                  placeholder="Choose a contract"
                  searchPlaceholder="Search contracts…"
                  emptyText="No more contracts available."
                  submitLabel="Add"
                  successMessage="Contract added"
                />
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {covering.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {editable
                ? "No contract covers this asset. Add its support, warranty or lease contract so renewals are not missed."
                : "No contract covers this asset."}
            </p>
          ) : (
            covering.map(({ contract }) => (
              <div key={contract.id} className="group/chip flex flex-wrap items-center gap-2">
                <Link href={`/contracts/${contract.id}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:text-primary">
                  {contract.name}
                  {contract.vendor ? <span className="font-normal text-muted-foreground"> · {contract.vendor.name}</span> : null}
                </Link>
                {contract.endDate ? <span className="text-xs tabular-nums text-muted-foreground">ends {formatDay(contract.endDate)}</span> : null}
                <ContractExpiryBadge contract={contract} now={now} />
                <StatusBadge map={CONTRACT_STATUS_META} value={contract.status} />
                {editable ? (
                  <UnlinkButton action={unlinkContractAsset} fields={{ contractId: contract.id, assetId }} successMessage="Contract removed" />
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
            Licenses · {seats.length}
            {editable ? (
              <span className="ml-auto">
                <LinkPicker
                  action={assignLicense}
                  triggerLabel="Assign license"
                  title="Assign a license seat"
                  description="Uses one seat of the chosen license for this asset."
                  hidden={{ assetId }}
                  valueName="licenseId"
                  options={assignableLicenses.map((l) => ({ value: l.id, label: l.name }))}
                  placeholder="Choose a license"
                  searchPlaceholder="Search licenses…"
                  emptyText="No more licenses available."
                  submitLabel="Assign"
                  successMessage="Seat assigned"
                />
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2">
          {seats.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {editable
                ? "No software license seat is assigned to this asset. Assign one to count it against the license."
                : "No software license seat is assigned to this asset."}
            </p>
          ) : (
            seats.map((seat) => (
              <div key={seat.id} className="group/chip flex flex-wrap items-center gap-2">
                <Link href={`/contracts/licenses/${seat.license.id}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:text-primary">
                  {seat.license.name}
                  {seat.user ? <span className="font-normal text-muted-foreground"> · {seat.user.name ?? seat.user.email}</span> : null}
                </Link>
                <LicenseComplianceBadge compliance={licenseCompliance(seat.license.seats, seat.license._count.assignments)} />
                {editable ? <UnlinkButton action={unassignLicense} fields={{ assignmentId: seat.id }} successMessage="Seat released" /> : null}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
