"use client";

import { useState, useTransition } from "react";
import { Trash2, Loader2 } from "lucide-react";
import { deleteService } from "@/lib/actions/services";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/lib/i18n/client";

/** Delete a service behind a confirmation dialog. Server-side is agent-gated. */
export function DeleteServiceButton({ serviceId, serviceName }: { serviceId: string; serviceName: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const t = useT("services");
  const tc = useT("common");

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label={t("deleteService")}
        title={t("deleteService")}
        onClick={() => setOpen(true)}
        className="text-muted-foreground hover:border-destructive/40 hover:text-destructive"
      >
        <Trash2 className="size-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("deleteService")}</DialogTitle>
            <DialogDescription>
              {t.rich("deleteDescription", { name: serviceName, b: (c) => <span className="font-medium text-foreground">{c}</span> })}
            </DialogDescription>
          </DialogHeader>
          <form action={(fd) => start(async () => { await deleteService(fd); })}>
            <input type="hidden" name="id" value={serviceId} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                {tc("cancel")}
              </Button>
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                {t("deleteService")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
