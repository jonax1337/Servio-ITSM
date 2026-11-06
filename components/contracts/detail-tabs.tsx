import { db } from "@/lib/db";
import { ASSET_TYPE_META } from "@/lib/constants";
import { ContractAssets } from "./contract-assets";
import { LicenseAssignments } from "./license-assignments";
import { LinkedContractsCard, LinkedLicensesCard } from "./linked-lists";

/** An asset in a picker: its name, with the asset type to tell similar names apart. */
const assetOption = (a: { id: string; name: string; type: string }) => ({
  value: a.id,
  label: a.name,
  hint: ASSET_TYPE_META[a.type]?.label,
});

/** Assets covered by a contract; managers also get the picker of assets not covered yet. */
export async function ContractAssetsTab({ contractId, canWrite }: { contractId: string; canWrite: boolean }) {
  const covered = await db.contractAsset.findMany({
    where: { contractId },
    orderBy: { createdAt: "asc" },
    select: { asset: { select: { id: true, name: true, status: true } } },
  });
  const assets = covered.map((row) => row.asset);
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
      options={available.map(assetOption)}
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
  return <LinkedLicensesCard licenses={licenses} emptyText="No license is linked to this contract. Pick this contract when you create or edit a license." />;
}

export async function VendorContractsTab({ vendorId, now }: { vendorId: string; now: Date }) {
  const contracts = await db.contract.findMany({
    where: { vendorId },
    orderBy: { endDate: "asc" },
    select: { id: true, name: true, status: true, endDate: true, renewalNoticeDays: true },
  });
  return <LinkedContractsCard contracts={contracts} now={now} emptyText="No contract is held with this vendor. Pick this vendor when you create a contract." />;
}

export async function VendorLicensesTab({ vendorId }: { vendorId: string }) {
  const licenses = await db.softwareLicense.findMany({
    where: { vendorId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, seats: true, _count: { select: { assignments: true } } },
  });
  return <LinkedLicensesCard licenses={licenses} emptyText="No license comes from this vendor. Pick this vendor when you create a license." />;
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
  return (
    <LicenseAssignments
      licenseId={licenseId}
      seats={seats}
      assignments={assignments}
      userOptions={users.map((u) => ({ value: u.id, label: u.name ?? u.email, avatar: u.name ?? u.email, hint: u.email }))}
      assetOptions={assets.map(assetOption)}
      canEdit={canWrite}
    />
  );
}
