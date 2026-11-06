"use client";

import { Pencil, Plus } from "lucide-react";
import { createLicense, updateLicense } from "@/lib/actions/contracts";
import { LICENSE_TYPES, LICENSE_TYPE_META } from "@/lib/constants";
import { isoDay } from "@/lib/contract-rules";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ComboField } from "@/components/combo-field";
import type { ComboOption } from "@/components/combobox";
import type { ContractFormOptions } from "./contract-options";
import { Field, SaveDialog } from "./save-dialog";

export type LicenseValues = {
  id: string;
  name: string;
  vendorId: string | null;
  contractId: string | null;
  ownerId: string | null;
  licenseType: string;
  seats: number;
  expiresAt: Date | null;
  cost: number | null;
  notes: string | null;
};

const typeOptions: ComboOption[] = LICENSE_TYPES.map((t) => ({ value: t, label: LICENSE_TYPE_META[t].label }));

/** Create a software license, or edit one when `license` is given. `currentUserId` pre-selects the owner of a new license. */
export function LicenseDialog({
  license,
  options,
  currentUserId,
  size,
}: {
  license?: LicenseValues;
  options: ContractFormOptions;
  currentUserId?: string;
  size?: "default" | "sm";
}) {
  return (
    <SaveDialog
      title={license ? "Edit license" : "New license"}
      description={license ? undefined : "A pool of software seats you can assign to users and assets."}
      triggerLabel={license ? "Edit" : "New license"}
      triggerIcon={license ? Pencil : Plus}
      triggerVariant={license ? "outline" : "default"}
      triggerSize={license ? "sm" : size}
      submitLabel={license ? "Save changes" : "Create license"}
      action={license ? updateLicense : createLicense}
      openCreated={license ? undefined : (id) => `/contracts/licenses/${id}`}
      successMessage={license ? "License updated" : "License created"}
      wide
    >
      {license ? <input type="hidden" name="id" value={license.id} /> : null}
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="license-name" required>
          <Input id="license-name" name="name" defaultValue={license?.name} placeholder="e.g. Microsoft 365 E3" required />
        </Field>
        <Field label="License type">
          <ComboField name="licenseType" options={typeOptions} defaultValue={license?.licenseType ?? "PER_USER"} />
        </Field>
        <Field label="Seats" htmlFor="license-seats" required hint="Assigning more seats than this marks the license over-allocated.">
          <Input id="license-seats" name="seats" type="number" min="1" step="1" defaultValue={license?.seats ?? 1} required />
        </Field>
        <Field label="Expires" htmlFor="license-expires" hint="Leave empty for a perpetual license.">
          <Input id="license-expires" name="expiresAt" type="date" defaultValue={license?.expiresAt ? isoDay(license.expiresAt) : ""} />
        </Field>
        <Field label="Vendor">
          <ComboField name="vendorId" options={options.vendors} defaultValue={license?.vendorId ?? undefined} includeNone noneLabel="No vendor" />
        </Field>
        <Field label="Contract">
          <ComboField name="contractId" options={options.contracts} defaultValue={license?.contractId ?? undefined} includeNone noneLabel="No contract" />
        </Field>
        <Field label="Owner" hint="Alerted when the license becomes over-allocated.">
          <ComboField
            name="ownerId"
            options={options.owners}
            defaultValue={license ? (license.ownerId ?? undefined) : currentUserId}
            includeNone
            noneLabel="No owner"
          />
        </Field>
        <Field label="Cost" htmlFor="license-cost">
          <Input id="license-cost" name="cost" type="number" min="0" step="0.01" defaultValue={license?.cost ?? ""} />
        </Field>
      </div>
      <Field label="Notes" htmlFor="license-notes">
        <Textarea id="license-notes" name="notes" defaultValue={license?.notes ?? ""} className="min-h-20" />
      </Field>
    </SaveDialog>
  );
}
