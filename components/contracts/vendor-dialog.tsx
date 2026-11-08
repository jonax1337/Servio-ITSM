"use client";

import { Pencil, Plus } from "lucide-react";
import { createVendor, updateVendor } from "@/lib/actions/contracts";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Field, SaveDialog } from "./save-dialog";
import { useT } from "@/lib/i18n/client";

export type VendorValues = {
  id: string;
  name: string;
  website: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  isActive: boolean;
};

/** Create a vendor, or edit one when `vendor` is given. */
export function VendorDialog({ vendor, size }: { vendor?: VendorValues; size?: "default" | "sm" }) {
  const t = useT("contracts");
  const tc = useT("common");
  return (
    <SaveDialog
      title={vendor ? t("dialog.editVendor") : t("dialog.newVendor")}
      description={vendor ? undefined : t("dialog.newVendorDescription")}
      triggerLabel={vendor ? tc("edit") : t("dialog.newVendor")}
      triggerIcon={vendor ? Pencil : Plus}
      triggerVariant={vendor ? "outline" : "default"}
      triggerSize={vendor ? "sm" : size}
      submitLabel={vendor ? tc("saveChanges") : t("dialog.createVendor")}
      action={vendor ? updateVendor : createVendor}
      openCreated={vendor ? undefined : (id) => `/contracts/vendors/${id}`}
      successMessage={vendor ? t("dialog.vendorUpdated") : t("dialog.vendorCreated")}
    >
      {vendor ? <input type="hidden" name="id" value={vendor.id} /> : null}
      <Field label={tc("name")} htmlFor="vendor-name" required>
        <Input id="vendor-name" name="name" defaultValue={vendor?.name} placeholder={t("dialog.vendorNamePlaceholder")} required />
      </Field>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field label={t("field.website")} htmlFor="vendor-website">
          <Input id="vendor-website" name="website" defaultValue={vendor?.website ?? ""} placeholder="https://" />
        </Field>
        <Field label={t("field.contactEmail")} htmlFor="vendor-email">
          <Input id="vendor-email" name="email" type="email" defaultValue={vendor?.email ?? ""} />
        </Field>
      </div>
      <Field label={tc("phone")} htmlFor="vendor-phone">
        <Input id="vendor-phone" name="phone" defaultValue={vendor?.phone ?? ""} />
      </Field>
      <Field label={tc("notes")} htmlFor="vendor-notes">
        <Textarea id="vendor-notes" name="notes" defaultValue={vendor?.notes ?? ""} className="min-h-20" />
      </Field>
      {vendor ? (
        <label className="flex items-center gap-2 text-sm">
          <Switch name="isActive" defaultChecked={vendor.isActive} /> {t("field.activeVendor")}
        </label>
      ) : null}
    </SaveDialog>
  );
}
