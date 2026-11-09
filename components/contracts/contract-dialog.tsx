"use client";

import { Pencil, Plus } from "lucide-react";
import { createContract, updateContract } from "@/lib/actions/contracts";
import {
  CONTRACT_STATUSES, CONTRACT_STATUS_META, CONTRACT_TYPES, CONTRACT_TYPE_META,
} from "@/lib/constants";
import { DEFAULT_RENEWAL_NOTICE_DAYS, isoDay } from "@/lib/contract-rules";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ComboField } from "@/components/combo-field";
import type { ComboOption } from "@/components/combobox";
import type { ContractFormOptions } from "./contract-options";
import { Field, SaveDialog } from "./save-dialog";
import { useEnumT, useT } from "@/lib/i18n/client";

export type ContractValues = {
  id: string;
  name: string;
  number: string | null;
  type: string;
  status: string;
  vendorId: string | null;
  ownerId: string | null;
  startDate: Date | null;
  endDate: Date | null;
  cost: number | null;
  renewalNoticeDays: number;
  autoRenew: boolean;
  notes: string | null;
};

/** Create a contract, or edit one when `contract` is given. `currentUserId` pre-selects the owner of a new contract. */
export function ContractDialog({
  contract,
  options,
  currentUserId,
  size,
}: {
  contract?: ContractValues;
  options: ContractFormOptions;
  currentUserId?: string;
  size?: "default" | "sm";
}) {
  const t = useT("contracts");
  const tc = useT("common");
  const te = useEnumT();
  const typeOptions: ComboOption[] = te.options(CONTRACT_TYPE_META, CONTRACT_TYPES);
  const statusOptions: ComboOption[] = CONTRACT_STATUSES.map((s) => ({
    value: s,
    label: te(CONTRACT_STATUS_META[s]),
    tone: CONTRACT_STATUS_META[s].tone,
    icon: CONTRACT_STATUS_META[s].icon,
  }));
  return (
    <SaveDialog
      title={contract ? t("dialog.editContract") : t("dialog.newContract")}
      description={contract ? undefined : t("dialog.newContractDescription")}
      triggerLabel={contract ? tc("edit") : t("dialog.newContract")}
      triggerIcon={contract ? Pencil : Plus}
      triggerVariant={contract ? "outline" : "default"}
      triggerSize={contract ? "sm" : size}
      submitLabel={contract ? tc("saveChanges") : t("dialog.createContract")}
      action={contract ? updateContract : createContract}
      openCreated={contract ? undefined : (id) => `/contracts/${id}`}
      successMessage={contract ? t("dialog.contractUpdated") : t("dialog.contractCreated")}
      wide
    >
      {contract ? <input type="hidden" name="id" value={contract.id} /> : null}
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field label={tc("name")} htmlFor="contract-name" required>
          <Input id="contract-name" name="name" defaultValue={contract?.name} placeholder={t("dialog.contractNamePlaceholder")} required />
        </Field>
        <Field label={t("field.contractNumber")} htmlFor="contract-number">
          <Input id="contract-number" name="number" defaultValue={contract?.number ?? ""} placeholder={t("dialog.numberPlaceholder")} />
        </Field>
        <Field label={tc("type")}>
          <ComboField name="type" options={typeOptions} defaultValue={contract?.type ?? "SUPPORT"} />
        </Field>
        <Field label={tc("status")}>
          <ComboField name="status" options={statusOptions} defaultValue={contract?.status ?? "ACTIVE"} />
        </Field>
        <Field label={t("col.vendor")}>
          <ComboField name="vendorId" options={options.vendors} defaultValue={contract?.vendorId ?? undefined} includeNone noneLabel={t("noVendor")} />
        </Field>
        <Field label={tc("owner")} hint={t("dialog.contractOwnerHint")}>
          <ComboField
            name="ownerId"
            options={options.owners}
            defaultValue={contract ? (contract.ownerId ?? undefined) : currentUserId}
            includeNone
            noneLabel={t("noOwner")}
          />
        </Field>
        <Field label={t("field.startDate")} htmlFor="contract-start" hint={t("dialog.startDateHint")}>
          <Input id="contract-start" name="startDate" type="date" defaultValue={contract?.startDate ? isoDay(contract.startDate) : ""} />
        </Field>
        <Field label={t("field.endDate")} htmlFor="contract-end" hint={t("dialog.endDateHint")}>
          <Input id="contract-end" name="endDate" type="date" defaultValue={contract?.endDate ? isoDay(contract.endDate) : ""} />
        </Field>
        <Field label={t("col.cost")} htmlFor="contract-cost" hint={t("dialog.costHint")}>
          <Input id="contract-cost" name="cost" type="number" min="0" step="0.01" defaultValue={contract?.cost ?? ""} />
        </Field>
        <Field label={t("field.renewalNoticeDays")} htmlFor="contract-notice" hint={t("dialog.noticeHint")}>
          <Input
            id="contract-notice"
            name="renewalNoticeDays"
            type="number"
            min="0"
            step="1"
            defaultValue={contract?.renewalNoticeDays ?? DEFAULT_RENEWAL_NOTICE_DAYS}
          />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Switch name="autoRenew" defaultChecked={contract?.autoRenew ?? false} /> {t("field.renewsAutomatically")}
      </label>
      <Field label={tc("notes")} htmlFor="contract-notes">
        <Textarea id="contract-notes" name="notes" defaultValue={contract?.notes ?? ""} className="min-h-20" />
      </Field>
    </SaveDialog>
  );
}
