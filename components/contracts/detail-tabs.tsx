import { db } from "@/lib/db";
import { ASSET_TYPE_META } from "@/lib/constants";
import { ContractAssets } from "./contract-assets";
import { LicenseAssignments } from "./license-assignments";
import { LinkedContractsCard, LinkedLicensesCard } from "./linked-lists";
import { getEnumT, getT } from "@/lib/i18n/server";
import type { EnumTranslator } from "@/lib/i18n/enums";

/** An asset in a picker: its name, with the asset type to tell similar names apart. */
const assetOption = (te: EnumTranslator) => (a: { id: string; name: string; type: string }) => ({
  value: a.id,
  label: a.name,
  hint: ASSET_TYPE_META[a.type] ? te(ASSET_TYPE_META, a.type) : undefined,
});

/** Assets covered by a contract; managers also get the picker of assets not covered yet. */
export async function ContractAssetsTab({ contractId, canWrite }: { contractId: string; canWrite: boolean }) {
  const covered = await db.contractAsset.findMany({
    where: { contractId },
    orderBy: { createdAt: "asc" },
    select: { asset: { select: { id: true, name: true, status: true } } },
  });
  const assets = covered.map((row) => row.asset);
  const te = await getEnumT();
  const available = canWrite
    ? await db.asset.findMany({
        where: { id: { notIn: assets.map((a) => a.id) } },
        orderBy: { name: "asc" },
        select: { id: true, name: true, type: true },
      })
    : [];
  return (
    <ContractAssets
      contractId={contractId}
      assets={assets}
      options={available.map(assetOption(te))}
      canEdit={canWrite}
    />
  );
}

export async function ContractLicensesTab({ contractId }: { contractId: string }) {
  const licenses = await db.softwareLicense.findMany({
    where: { contractId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, seats: true, _count: { select: { assignments: true } } },
  });
  const t = await getT("contracts");
  return <LinkedLicensesCard licenses={licenses} emptyText={t("contractLicensesEmpty")} />;
}

export async function VendorContractsTab({ vendorId, now }: { vendorId: string; now: Date }) {
  const contracts = await db.contract.findMany({
    where: { vendorId },
    orderBy: { endDate: "asc" },
    select: { id: true, name: true, status: true, endDate: true, renewalNoticeDays: true },
  });
  const t = await getT("contracts");
  return <LinkedContractsCard contracts={contracts} now={now} emptyText={t("vendorContractsEmpty")} />;
}

export async function VendorLicensesTab({ vendorId }: { vendorId: string }) {
  const licenses = await db.softwareLicense.findMany({
    where: { vendorId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, seats: true, _count: { select: { assignments: true } } },
  });
  const t = await getT("contracts");
  return <LinkedLicensesCard licenses={licenses} emptyText={t("vendorLicensesEmpty")} />;
}

/** Seats of a license: who or what holds each one; managers can assign and release. */
export async function LicenseSeatsTab({
  licenseId,
  seats,
  canWrite,
}: {
  licenseId: string;
  seats: number;
  canWrite: boolean;
}) {
  const assignments = await db.licenseAssignment.findMany({
    where: { licenseId },
    orderBy: { assignedAt: "asc" },
    select: {
      id: true,
      assignedAt: true,
      user: { select: { name: true, email: true } },
      asset: { select: { id: true, name: true } },
    },
  });
  const [users, assets] = canWrite
    ? await Promise.all([
        db.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
        db.asset.findMany({ select: { id: true, name: true, type: true }, orderBy: { name: "asc" } }),
      ])
    : [[], []];
  const te = await getEnumT();
  return (
    <LicenseAssignments
      licenseId={licenseId}
      seats={seats}
      assignments={assignments}
      userOptions={users.map((u) => ({ value: u.id, label: u.name ?? u.email, avatar: u.name ?? u.email, hint: u.email }))}
      assetOptions={assets.map(assetOption(te))}
      canEdit={canWrite}
    />
  );
}
