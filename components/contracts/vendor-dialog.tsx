"use client";

import { Pencil, Plus } from "lucide-react";
import { createVendor, updateVendor } from "@/lib/actions/contracts";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Field, SaveDialog } from "./save-dialog";

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
  return (
    <SaveDialog
      title={vendor ? "Edit vendor" : "New vendor"}
      description={vendor ? undefined : "A supplier you hold contracts and licenses with."}
      triggerLabel={vendor ? "Edit" : "New vendor"}
      triggerIcon={vendor ? Pencil : Plus}
      triggerVariant={vendor ? "outline" : "default"}
      triggerSize={vendor ? "sm" : size}
      submitLabel={vendor ? "Save changes" : "Create vendor"}
      action={vendor ? updateVendor : createVendor}
      openCreated={vendor ? undefined : (id) => `/contracts/vendors/${id}`}
      successMessage={vendor ? "Vendor updated" : "Vendor created"}
    >
      {vendor ? <input type="hidden" name="id" value={vendor.id} /> : null}
      <Field label="Name" htmlFor="vendor-name" required>
        <Input id="vendor-name" name="name" defaultValue={vendor?.name} placeholder="e.g. Acme Software" required />
      </Field>
      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Field label="Website" htmlFor="vendor-website">
          <Input id="vendor-website" name="website" defaultValue={vendor?.website ?? ""} placeholder="https://" />
        </Field>
        <Field label="Contact email" htmlFor="vendor-email">
          <Input id="vendor-email" name="email" type="email" defaultValue={vendor?.email ?? ""} />
        </Field>
      </div>
      <Field label="Phone" htmlFor="vendor-phone">
        <Input id="vendor-phone" name="phone" defaultValue={vendor?.phone ?? ""} />
      </Field>
      <Field label="Notes" htmlFor="vendor-notes">
        <Textarea id="vendor-notes" name="notes" defaultValue={vendor?.notes ?? ""} className="min-h-20" />
      </Field>
      {vendor ? (
        <label className="flex items-center gap-2 text-sm">
          <Switch name="isActive" defaultChecked={vendor.isActive} /> Active vendor
        </label>
      ) : null}
    </SaveDialog>
  );
}
