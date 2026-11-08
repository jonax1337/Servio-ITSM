"use client";

import { useActionState, useState } from "react";
import { Plus, Pencil, Loader2, Save } from "lucide-react";
import {
  createLocation, updateLocation, type LocationState,
} from "@/lib/actions/locations";
import { LOCATION_TYPES, LOCATION_TYPE_META } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Combobox, type ComboOption } from "@/components/combobox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useEnumT, useServerMessage, useT } from "@/lib/i18n/client";

type Loc = { id: string; name: string; type: string; parentId: string | null; address: string | null; city: string | null; country: string | null; notes: string | null };

export function LocationDialog({
  parents, location, size = "default",
}: {
  parents: { value: string; label: string }[];
  location?: Loc;
  size?: "default" | "sm" | "icon-sm";
}) {
  const editing = !!location;
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<LocationState, FormData>(
    editing ? updateLocation : createLocation,
    undefined,
  );
  const [type, setType] = useState(location?.type ?? "BUILDING");
  const [parentId, setParentId] = useState(location?.parentId ?? "none");
  const t = useT("locations");
  const tc = useT("common");
  const te = useEnumT();
  const tm = useServerMessage();

  const typeOpts: ComboOption[] = LOCATION_TYPES.map((ty) => ({
    value: ty, label: te(LOCATION_TYPE_META[ty]), tone: LOCATION_TYPE_META[ty].tone, icon: LOCATION_TYPE_META[ty].icon,
  }));
  const parentOpts: ComboOption[] = [
    { value: "none", label: t("dialog.topLevel") },
    ...parents.filter((p) => p.value !== location?.id),
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={editing ? "outline" : "default"} size={size} aria-label={editing ? t("dialog.editTitle") : undefined} />}>
        {editing ? <Pencil className="size-4" /> : <><Plus className="size-4" /> {t("dialog.newTitle")}</>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? t("dialog.editTitle") : t("dialog.newTitle")}</DialogTitle>
          <DialogDescription>{t("dialog.description")}</DialogDescription>
        </DialogHeader>
        <form action={async (fd) => { await action(fd); setOpen(false); }} className="grid gap-4">
          {location ? <input type="hidden" name="id" value={location.id} /> : null}
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="parentId" value={parentId} />

          {state?.error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{tm(state.error)}</p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>{tc("name")}</Label>
              <Input name="name" defaultValue={location?.name} placeholder={t("dialog.namePlaceholder")} required />
            </div>
            <div className="grid gap-1.5">
              <Label>{tc("type")}</Label>
              <Combobox options={typeOpts} value={type} onChange={setType} />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("dialog.inside")}</Label>
              <Combobox options={parentOpts} value={parentId} onChange={setParentId} searchPlaceholder={t("dialog.searchLocations")} />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("dialog.city")}</Label>
              <Input name="city" defaultValue={location?.city ?? ""} />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("dialog.country")}</Label>
              <Input name="country" defaultValue={location?.country ?? ""} />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>{t("dialog.address")}</Label>
              <Input name="address" defaultValue={location?.address ?? ""} />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>{tc("notes")}</Label>
              <Textarea name="notes" defaultValue={location?.notes ?? ""} className="min-h-20" />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {editing ? t("dialog.save") : t("dialog.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
