"use client";

import { useState, useTransition } from "react";
import { Pencil, Loader2, Save } from "lucide-react";
import { updateGroup, type ActionState } from "@/lib/actions/groups";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ComboField } from "@/components/combo-field";
import type { ComboOption } from "@/components/combobox";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { GROUP_TYPES, GROUP_TYPE_META } from "@/lib/constants";
import { useEnumT, useServerMessage, useT } from "@/lib/i18n/client";

const initials = (s: string) => s.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

export function GroupEditDialog({
  group,
  agents,
}: {
  group: {
    id: string;
    name: string;
    type: string;
    description: string | null;
    email: string | null;
    managerId: string | null;
    color: string;
  };
  agents: { id: string; name: string | null; email: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ActionState>(undefined);
  const [pending, start] = useTransition();
  const t = useT("groups");
  const te = useEnumT();
  const tm = useServerMessage();

  function onSubmit(fd: FormData) {
    start(async () => {
      const res = await updateGroup(undefined, fd);
      setState(res);
      if (!res?.error) setOpen(false);
    });
  }

  const fe = tm.fields(state?.fieldErrors) ?? {};
  const typeOpts: ComboOption[] = GROUP_TYPES.map((v) => ({
    value: v, label: te(GROUP_TYPE_META[v]), tone: GROUP_TYPE_META[v].tone, icon: GROUP_TYPE_META[v].icon,
  }));
  const managerOpts: ComboOption[] = agents.map((a) => ({
    value: a.id, label: a.name ?? a.email, avatar: initials(a.name ?? a.email), hint: a.email,
  }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Pencil className="size-4" /> {t("edit")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("editGroup")}</DialogTitle>
        </DialogHeader>
        <form action={onSubmit} className="grid gap-4">
          <input type="hidden" name="id" value={group.id} />
          {state?.error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {tm(state.error)}
            </p>
          ) : null}

          <div className="grid gap-1.5">
            <Label htmlFor="grp-name">{t("name")}</Label>
            <Input id="grp-name" name="name" defaultValue={group.name} required />
            {fe.name ? <p className="text-xs text-destructive">{fe.name[0]}</p> : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label>{t("type")}</Label>
              <ComboField name="type" defaultValue={group.type} options={typeOpts} />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("manager")}</Label>
              <ComboField
                name="managerId"
                defaultValue={group.managerId ?? undefined}
                options={managerOpts}
                includeNone
                noneLabel={t("noManager")}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <div className="grid gap-1.5">
              <Label htmlFor="grp-email">{t("email")}</Label>
              <Input id="grp-email" name="email" type="email" defaultValue={group.email ?? ""} placeholder={t("emailPlaceholder")} />
              {fe.email ? <p className="text-xs text-destructive">{fe.email[0]}</p> : null}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="grp-color">{t("colour")}</Label>
              <Input
                id="grp-color"
                name="color"
                type="color"
                defaultValue={group.color}
                className="h-9 w-16 cursor-pointer p-1"
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="grp-desc">{t("descriptionLabel")}</Label>
            <Textarea id="grp-desc" name="description" defaultValue={group.description ?? ""} className="min-h-24" />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {t("saveChanges")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
