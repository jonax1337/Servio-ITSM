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
import { useEnumT, useT } from "@/lib/i18n/client";

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
  const t = useT("contracts");
  const tc = useT("common");
  const te = useEnumT();
  const typeOptions: ComboOption[] = te.options(LICENSE_TYPE_META, LICENSE_TYPES);
  return (
    <SaveDialog
      title={license ? t("dialog.editLicense") : t("dialog.newLicense")}
      description={license ? undefined : t("dialog.newLicenseDescription")}
      triggerLabel={license ? tc("edit") : t("dialog.newLicense")}
      triggerIcon={license ? Pencil : Plus}
      triggerVariant={license ? "outline" : "default"}
      triggerSize={license ? "sm" : size}
      submitLabel={license ? tc("saveChanges") : t("dialog.createLicense")}
      action={license ? updateLicense : createLicense}
      openCreated={license ? undefined : (id) => `/contracts/licenses/${id}`}
      successMessage={license ? t("dialog.licenseUpdated") : t("dialog.licenseCreated")}
      wide
    >
      {license ? <input type="hidden" name="id" value={license.id} /> : null}
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field label={tc("name")} htmlFor="license-name" required>
          <Input id="license-name" name="name" defaultValue={license?.name} placeholder={t("dialog.licenseNamePlaceholder")} required />
        </Field>
        <Field label={t("field.licenseType")}>
          <ComboField name="licenseType" options={typeOptions} defaultValue={license?.licenseType ?? "PER_USER"} />
        </Field>
        <Field label={t("col.seats")} htmlFor="license-seats" required hint={t("dialog.seatsHint")}>
          <Input id="license-seats" name="seats" type="number" min="1" step="1" defaultValue={license?.seats ?? 1} required />
        </Field>
        <Field label={t("col.expires")} htmlFor="license-expires" hint={t("dialog.expiresHint")}>
          <Input id="license-expires" name="expiresAt" type="date" defaultValue={license?.expiresAt ? isoDay(license.expiresAt) : ""} />
        </Field>
        <Field label={t("col.vendor")}>
          <ComboField name="vendorId" options={options.vendors} defaultValue={license?.vendorId ?? undefined} includeNone noneLabel={t("noVendor")} />
        </Field>
        <Field label={t("col.contract")}>
          <ComboField name="contractId" options={options.contracts} defaultValue={license?.contractId ?? undefined} includeNone noneLabel={t("noContract")} />
        </Field>
        <Field label={tc("owner")} hint={t("dialog.licenseOwnerHint")}>
          <ComboField
            name="ownerId"
            options={options.owners}
            defaultValue={license ? (license.ownerId ?? undefined) : currentUserId}
            includeNone
            noneLabel={t("noOwner")}
          />
        </Field>
        <Field label={t("col.cost")} htmlFor="license-cost">
          <Input id="license-cost" name="cost" type="number" min="0" step="0.01" defaultValue={license?.cost ?? ""} />
        </Field>
      </div>
      <Field label={tc("notes")} htmlFor="license-notes">
        <Textarea id="license-notes" name="notes" defaultValue={license?.notes ?? ""} className="min-h-20" />
      </Field>
    </SaveDialog>
  );
}
