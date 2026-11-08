"use client";

import { useState, useTransition } from "react";
import { Trash2, Loader2 } from "lucide-react";
import { deleteAsset } from "@/lib/actions/assets";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/lib/i18n/client";

/** Delete an asset behind a confirmation dialog. Server-side is agent-gated. */
export function DeleteAssetButton({ assetId, assetName }: { assetId: string; assetName: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const t = useT("assets");
  const tc = useT("common");

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label={t("delete.title")}
        title={t("delete.title")}
        onClick={() => setOpen(true)}
        className="text-muted-foreground hover:border-destructive/40 hover:text-destructive"
      >
        <Trash2 className="size-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("delete.title")}</DialogTitle>
            <DialogDescription>
              {t.rich("delete.description", {
                name: <span className="font-medium text-foreground">{assetName}</span>,
              })}
            </DialogDescription>
          </DialogHeader>
          <form
            action={(fd) => start(async () => { await deleteAsset(fd); })}
          >
            <input type="hidden" name="id" value={assetId} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                {tc("cancel")}
              </Button>
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                {t("delete.title")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
