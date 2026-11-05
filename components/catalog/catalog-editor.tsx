"use client";

import { useActionState, useState } from "react";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { Plus, Pencil, Trash2, Loader2, Save, ShoppingBag } from "lucide-react";
import {
  createCatalogItem, updateCatalogItem, type CatalogAdminState,
} from "@/lib/actions/catalog-admin";
import { FIELD_TYPES, type ServiceField, type FieldType } from "@/lib/service-forms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboOption } from "@/components/combobox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { IconPicker } from "@/components/icon-picker";

type Opt = { value: string; label: string }[];
const FIELD_TYPE_OPTIONS: ComboOption[] = FIELD_TYPES.map((t) => ({ value: t, label: t }));
export type CatalogItemData = {
  id: string; name: string; description: string | null; shortDescription: string | null;
  icon: string | null; categoryId: string | null; serviceId: string | null; estimatedDays: number | null;
  isPublished: boolean; requiresApproval: boolean; approverId: string | null;
  fields: ServiceField[];
};

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "field";
}

export function CatalogEditor({
  item, categories, services, agents,
}: {
  item?: CatalogItemData;
  categories: Opt;
  services: Opt;
  agents: Opt;
}) {
  const editing = !!item;
  const [open, setOpen] = useState(false);
  // Close only on success — a validation error must stay visible with the input intact.
  const [state, action, pending] = useActionState<CatalogAdminState, FormData>(
    async (prev, fd) => {
      const result = await (editing ? updateCatalogItem : createCatalogItem)(prev, fd);
      if (!result?.error) setOpen(false);
      return result;
    },
    undefined,
  );
  const submit = useFormSubmit(action);

  const [icon, setIcon] = useState(item?.icon ?? "ShoppingBag");
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? "none");
  const [serviceId, setServiceId] = useState(item?.serviceId ?? "none");
  const [approverId, setApproverId] = useState(item?.approverId ?? "none");
  const [isPublished, setIsPublished] = useState(item?.isPublished ?? true);
  const [requiresApproval, setRequiresApproval] = useState(item?.requiresApproval ?? false);
  const [fields, setFields] = useState<ServiceField[]>(item?.fields ?? []);

  const catOpts: ComboOption[] = [{ value: "none", label: "No category" }, ...categories];
  const serviceOpts: ComboOption[] = [{ value: "none", label: "No service" }, ...services];
  const approverOpts: ComboOption[] = [{ value: "none", label: "No approver" }, ...agents.map((a) => ({ ...a, avatar: a.label.slice(0, 2).toUpperCase() }))];
  const normalized = fields.filter((f) => f.label.trim()).map((f) => ({ ...f, key: f.key || slug(f.label) }));

  const update = (i: number, patch: Partial<ServiceField>) => setFields((f) => f.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={editing ? "outline" : "default"} size={editing ? "icon-sm" : "default"} aria-label={editing ? "Edit item" : undefined} />}>
        {editing ? <Pencil className="size-4" /> : <><Plus className="size-4" /> New catalog item</>}
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShoppingBag className="size-4 text-primary" /> {editing ? "Edit" : "New"} catalog item</DialogTitle>
          <DialogDescription>What end users can request from the self-service catalog.</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="grid gap-5">
          {item ? <input type="hidden" name="id" value={item.id} /> : null}
          <input type="hidden" name="icon" value={icon} />
          <input type="hidden" name="categoryId" value={categoryId} />
          <input type="hidden" name="serviceId" value={serviceId} />
          <input type="hidden" name="approverId" value={approverId} />
          <input type="hidden" name="isPublished" value={String(isPublished)} />
          <input type="hidden" name="requiresApproval" value={String(requiresApproval)} />
          <input type="hidden" name="formSchema" value={JSON.stringify(normalized)} />

          {state?.error ? <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>Name</Label>
              <Input name="name" defaultValue={item?.name} placeholder="e.g. New laptop" required />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>Short description <span className="text-muted-foreground">(shown on the card)</span></Label>
              <Input name="shortDescription" defaultValue={item?.shortDescription ?? ""} placeholder="One line users see in the catalog" />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>Full description</Label>
              <Textarea name="description" defaultValue={item?.description ?? ""} className="min-h-20" />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>Icon</Label>
              <IconPicker value={icon} onChange={setIcon} />
            </div>
            <div className="grid gap-1.5">
              <Label>Category</Label>
              <Combobox options={catOpts} value={categoryId} onChange={setCategoryId} searchPlaceholder="Search categories…" />
            </div>
            <div className="grid gap-1.5">
              <Label>Service <span className="text-muted-foreground">(pre-routes requests)</span></Label>
              <Combobox options={serviceOpts} value={serviceId} onChange={setServiceId} searchPlaceholder="Search services…" />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>Estimated delivery (days)</Label>
              <Input name="estimatedDays" type="number" defaultValue={item?.estimatedDays ?? ""} placeholder="e.g. 3" />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 rounded-lg border p-3 text-sm">
              <Checkbox checked={isPublished} onCheckedChange={(v) => setIsPublished(!!v)} /> Published in the catalog
            </label>
            <label className="flex items-center gap-2 rounded-lg border p-3 text-sm">
              <Checkbox checked={requiresApproval} onCheckedChange={(v) => setRequiresApproval(!!v)} /> Requires approval
            </label>
          </div>
          {requiresApproval ? (
            <div className="grid gap-1.5">
              <Label>Approver</Label>
              <Combobox options={approverOpts} value={approverId} onChange={setApproverId} searchPlaceholder="Search people…" />
            </div>
          ) : null}

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>Request form</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => setFields((f) => [...f, { key: "", label: "", type: "text", required: false }])}>
                <Plus className="size-4" /> Add field
              </Button>
            </div>
            {fields.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No fields — the requester just sees a free-text box.</p>
            ) : (
              fields.map((f, i) => (
                <div key={i} className="grid gap-2 rounded-lg border bg-card p-3 sm:grid-cols-[1fr_10rem_auto_auto] sm:items-center">
                  <Input value={f.label} placeholder="Question / label" onChange={(e) => update(i, { label: e.target.value, key: slug(e.target.value) })} />
                  <Combobox options={FIELD_TYPE_OPTIONS} value={f.type} onChange={(v) => update(i, { type: (v as FieldType) || "text" })} searchPlaceholder="Search types…" />
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Checkbox checked={!!f.required} onCheckedChange={(v) => update(i, { required: !!v })} /> req.
                  </label>
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => setFields((arr) => arr.filter((_, idx) => idx !== i))}>
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                  {f.type === "select" ? (
                    <Input className="sm:col-span-4" placeholder="Options, comma separated" value={(f.options ?? []).join(", ")}
                      onChange={(e) => update(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
                  ) : null}
                </div>
              ))
            )}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {editing ? "Save item" : "Create item"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
