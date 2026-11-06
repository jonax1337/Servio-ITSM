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

export type ContractValues = {
  id: string;
  name: string;
  number: string | null;
  type: string;
  status: string;
  vendorId: string | null;
  ownerId: string | null;
  startDate: Date;
  endDate: Date | null;
  cost: number | null;
  renewalNoticeDays: number;
  autoRenew: boolean;
  notes: string | null;
};

const typeOptions: ComboOption[] = CONTRACT_TYPES.map((t) => ({ value: t, label: CONTRACT_TYPE_META[t].label }));
const statusOptions: ComboOption[] = CONTRACT_STATUSES.map((s) => ({
  value: s,
  label: CONTRACT_STATUS_META[s].label,
  tone: CONTRACT_STATUS_META[s].tone,
  icon: CONTRACT_STATUS_META[s].icon,
}));

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
  return (
    <SaveDialog
      title={contract ? "Edit contract" : "New contract"}
      description={contract ? undefined : "Track a vendor agreement and get reminded before it ends."}
      triggerLabel={contract ? "Edit" : "New contract"}
      triggerIcon={contract ? Pencil : Plus}
      triggerVariant={contract ? "outline" : "default"}
      triggerSize={contract ? "sm" : size}
      submitLabel={contract ? "Save changes" : "Create contract"}
      action={contract ? updateContract : createContract}
      openCreated={contract ? undefined : (id) => `/contracts/${id}`}
      successMessage={contract ? "Contract updated" : "Contract created"}
      wide
    >
      {contract ? <input type="hidden" name="id" value={contract.id} /> : null}
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="contract-name" required>
          <Input id="contract-name" name="name" defaultValue={contract?.name} placeholder="e.g. Acme premium support" required />
        </Field>
        <Field label="Contract number" htmlFor="contract-number">
          <Input id="contract-number" name="number" defaultValue={contract?.number ?? ""} placeholder="Your reference, if any" />
        </Field>
        <Field label="Type">
          <ComboField name="type" options={typeOptions} defaultValue={contract?.type ?? "SUPPORT"} />
        </Field>
        <Field label="Status">
          <ComboField name="status" options={statusOptions} defaultValue={contract?.status ?? "ACTIVE"} />
        </Field>
        <Field label="Vendor">
          <ComboField name="vendorId" options={options.vendors} defaultValue={contract?.vendorId ?? undefined} includeNone noneLabel="No vendor" />
        </Field>
        <Field label="Owner" hint="Receives the renewal reminder.">
          <ComboField
            name="ownerId"
            options={options.owners}
            defaultValue={contract ? (contract.ownerId ?? undefined) : currentUserId}
            includeNone
            noneLabel="No owner"
          />
        </Field>
        <Field label="Start date" htmlFor="contract-start" required>
          <Input id="contract-start" name="startDate" type="date" defaultValue={contract ? isoDay(contract.startDate) : ""} required />
        </Field>
        <Field label="End date" htmlFor="contract-end" hint="Leave empty for an open-ended contract.">
          <Input id="contract-end" name="endDate" type="date" defaultValue={contract?.endDate ? isoDay(contract.endDate) : ""} />
        </Field>
        <Field label="Cost" htmlFor="contract-cost" hint="Total or yearly cost, as you track it.">
          <Input id="contract-cost" name="cost" type="number" min="0" step="0.01" defaultValue={contract?.cost ?? ""} />
        </Field>
        <Field label="Renewal notice (days)" htmlFor="contract-notice" hint="The owner is reminded this many days before the end date.">
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
        <Switch name="autoRenew" defaultChecked={contract?.autoRenew ?? false} /> Renews automatically
      </label>
      <Field label="Notes" htmlFor="contract-notes">
        <Textarea id="contract-notes" name="notes" defaultValue={contract?.notes ?? ""} className="min-h-20" />
      </Field>
    </SaveDialog>
  );
}
