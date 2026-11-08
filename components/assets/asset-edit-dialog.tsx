"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Pencil, Loader2, Save } from "lucide-react";
import { updateAsset } from "@/lib/actions/assets";
import {
  ASSET_TYPES, ASSET_STATUSES, ASSET_TYPE_META, ASSET_STATUS_META,
} from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Combobox, type ComboOption } from "@/components/combobox";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useEnumT, useT } from "@/lib/i18n/client";

type Opt = { value: string; label: string }[];
type Asset = {
  id: string; name: string; assetTag: string | null; type: string; status: string;
  serial: string | null; model: string | null; manufacturer: string | null; os: string | null;
  cpu: string | null; ramGb: number | null; storageGb: number | null; ipAddress: string | null;
  macAddress: string | null; location: string | null; locationId: string | null;
  ownerId: string | null; groupId: string | null; cost: number | null; notes: string | null;
  purchaseDate: Date | null; warrantyEnd: Date | null;
};

function SaveBtn() {
  const { pending } = useFormStatus();
  const t = useT("assets");
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} {t("edit.save")}
    </Button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid gap-1.5"><Label>{label}</Label>{children}</div>;
}

const dateVal = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");

export function AssetEditDialog({
  asset, options,
}: {
  asset: Asset;
  options: { locations: Opt; agents: Opt; groups: Opt };
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState(asset.type);
  const [status, setStatus] = useState(asset.status);
  const [locationId, setLocationId] = useState(asset.locationId ?? "none");
  const [ownerId, setOwnerId] = useState(asset.ownerId ?? "none");
  const [groupId, setGroupId] = useState(asset.groupId ?? "none");
  const t = useT("assets");
  const tc = useT("common");
  const te = useEnumT();

  const typeOpts: ComboOption[] = ASSET_TYPES.map((ty) => ({ value: ty, label: te(ASSET_TYPE_META[ty]), tone: ASSET_TYPE_META[ty].tone, icon: ASSET_TYPE_META[ty].icon }));
  const statusOpts: ComboOption[] = ASSET_STATUSES.map((s) => ({ value: s, label: te(ASSET_STATUS_META[s]), tone: ASSET_STATUS_META[s].tone }));
  const withNone = (o: Opt, none: string): ComboOption[] => [{ value: "none", label: none }, ...o];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Pencil className="size-4" /> {tc("edit")}
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{t("edit.title")}</DialogTitle></DialogHeader>
        <form action={async (fd) => { await updateAsset(fd); setOpen(false); }} className="grid gap-4">
          <input type="hidden" name="id" value={asset.id} />
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="status" value={status} />
          <input type="hidden" name="locationId" value={locationId} />
          <input type="hidden" name="ownerId" value={ownerId} />
          <input type="hidden" name="groupId" value={groupId} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={tc("name")}><Input name="name" defaultValue={asset.name} required /></Field>
            <Field label={t("field.assetTag")}><Input name="assetTag" defaultValue={asset.assetTag ?? ""} /></Field>
            <Field label={tc("type")}><Combobox options={typeOpts} value={type} onChange={setType} /></Field>
            <Field label={tc("status")}><Combobox options={statusOpts} value={status} onChange={setStatus} /></Field>
            <Field label={t("field.manufacturer")}><Input name="manufacturer" defaultValue={asset.manufacturer ?? ""} /></Field>
            <Field label={t("field.model")}><Input name="model" defaultValue={asset.model ?? ""} /></Field>
            <Field label={t("field.serial")}><Input name="serial" defaultValue={asset.serial ?? ""} /></Field>
            <Field label={t("field.os")}><Input name="os" defaultValue={asset.os ?? ""} /></Field>
            <Field label={t("field.cpu")}><Input name="cpu" defaultValue={asset.cpu ?? ""} /></Field>
            <Field label={t("field.ramGb")}><Input name="ramGb" type="number" defaultValue={asset.ramGb ?? ""} /></Field>
            <Field label={t("field.storageGb")}><Input name="storageGb" type="number" defaultValue={asset.storageGb ?? ""} /></Field>
            <Field label={t("field.cost")}><Input name="cost" type="number" defaultValue={asset.cost ?? ""} /></Field>
            <Field label={t("field.ipAddress")}><Input name="ipAddress" defaultValue={asset.ipAddress ?? ""} /></Field>
            <Field label={t("field.macAddress")}><Input name="macAddress" defaultValue={asset.macAddress ?? ""} /></Field>
            <Field label={tc("location")}><Combobox options={withNone(options.locations, t("noLocation"))} value={locationId} onChange={setLocationId} searchPlaceholder={t("edit.searchLocations")} /></Field>
            <Field label={t("field.locationNote")}><Input name="location" defaultValue={asset.location ?? ""} placeholder={t("form.locationNotePlaceholder")} /></Field>
            <Field label={tc("owner")}><Combobox options={withNone(options.agents, t("noOwner"))} value={ownerId} onChange={setOwnerId} searchPlaceholder={t("edit.searchPeople")} /></Field>
            <Field label={tc("group")}><Combobox options={withNone(options.groups, t("noGroup"))} value={groupId} onChange={setGroupId} searchPlaceholder={t("edit.searchGroups")} /></Field>
            <Field label={t("field.purchaseDate")}><Input name="purchaseDate" type="date" defaultValue={dateVal(asset.purchaseDate)} /></Field>
            <Field label={t("field.warrantyEnd")}><Input name="warrantyEnd" type="date" defaultValue={dateVal(asset.warrantyEnd)} /></Field>
            <div className="sm:col-span-2"><Field label={tc("notes")}><Textarea name="notes" defaultValue={asset.notes ?? ""} className="min-h-20" /></Field></div>
          </div>

          <DialogFooter><SaveBtn /></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
