import { db } from "@/lib/db";
import { getFormOptions } from "@/lib/data/options";
import type { ComboOption } from "@/components/combobox";
import { getT } from "@/lib/i18n/server";

export type ContractFormOptions = {
  vendors: ComboOption[];
  contracts: ComboOption[];
  owners: ComboOption[];
};

/** Option lists for the vendor / contract / license forms: vendors, contracts and the people who can own a record. */
export async function getContractFormOptions(): Promise<ContractFormOptions> {
  const [vendors, contracts, { agents }, t] = await Promise.all([
    db.vendor.findMany({ select: { id: true, name: true, isActive: true }, orderBy: { name: "asc" } }),
    db.contract.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    getFormOptions(),
    getT("contracts"),
  ]);
  return {
    vendors: vendors.map((v) => ({ value: v.id, label: v.isActive ? v.name : t("vendorInactive", { name: v.name }) })),
    contracts: contracts.map((c) => ({ value: c.id, label: c.name })),
    owners: agents.map((a) => ({ value: a.id, label: a.name ?? a.email, avatar: a.name ?? a.email, hint: a.email })),
  };
}
