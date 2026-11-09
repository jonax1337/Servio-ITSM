"use client";

import { useState, useTransition } from "react";
import { Pencil, Loader2, Save } from "lucide-react";
import { updateService, type ActionState } from "@/lib/actions/services";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { IconPicker } from "@/components/icon-picker";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useServerMessage, useT } from "@/lib/i18n/client";

/** Edit a service's name, service number, icon and description. The other
 *  properties (status, owner, team, …) are edited inline via ServiceProperties.
 *  Server-side is agent-gated. */
export function ServiceEditDialog({
  service,
}: {
  service: { id: string; name: string; code: string | null; description: string | null; icon: string | null };
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ActionState>(undefined);
  const [pending, start] = useTransition();
  const t = useT("services");
  const tc = useT("common");
  const tm = useServerMessage();

  function onSubmit(fd: FormData) {
    start(async () => {
      const res = await updateService(undefined, fd);
      setState(res);
      if (!res?.error) setOpen(false);
    });
  }

  const fe = state?.fieldErrors ?? {};

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Pencil className="size-4" /> {tc("edit")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("editService")}</DialogTitle>
        </DialogHeader>
        <form action={onSubmit} className="grid gap-4">
          <input type="hidden" name="id" value={service.id} />
          {state?.error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {tm(state.error)}
            </p>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor="svc-name">{tc("name")}</Label>
            <Input id="svc-name" name="name" defaultValue={service.name} required />
            {fe.name ? <p className="text-xs text-destructive">{tm(fe.name[0])}</p> : null}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="svc-code">{t("code")}</Label>
            <Input id="svc-code" name="code" defaultValue={service.code ?? ""} placeholder={t("codePlaceholder")} maxLength={32} />
            <p className="text-xs text-muted-foreground">{t("codeHint")}</p>
            {fe.code ? <p className="text-xs text-destructive">{tm(fe.code[0])}</p> : null}
          </div>
          <div className="grid gap-1.5">
            <Label>{t("icon")}</Label>
            <IconPicker name="icon" defaultValue={service.icon ?? "LifeBuoy"} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="svc-desc">{tc("description")}</Label>
            <Textarea
              id="svc-desc"
              name="description"
              defaultValue={service.description ?? ""}
              placeholder={t("descriptionPlaceholder")}
              className="min-h-28"
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {tc("saveChanges")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
