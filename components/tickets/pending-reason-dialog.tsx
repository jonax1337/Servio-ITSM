"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { isConfirmShortcut, keyTargetOf } from "@/lib/confirm-shortcut";
import { PENDING_REASONS, PENDING_REASON_META } from "@/lib/constants";
import { Combobox, type ComboOption } from "@/components/combobox";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useEnumT, useT } from "@/lib/i18n/client";

export type PendingPayload = { reason: string; noteHtml: string; isInternal: boolean };

/** Captures the pending/on-hold reason + note (rich text + internal/external). Confirm hands
 *  the data to onConfirm, which commits it; the dialog stays open until that returns true. */
export function PendingReasonDialog({
  status, open, onOpenChange, onConfirm,
}: {
  status: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onConfirm: (payload: PendingPayload) => Promise<boolean>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open ? <PendingForm status={status} onClose={() => onOpenChange(false)} onConfirm={onConfirm} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function PendingForm({
  status, onClose, onConfirm,
}: {
  status: string;
  onClose: () => void;
  onConfirm: (payload: PendingPayload) => Promise<boolean>;
}) {
  const [reason, setReason] = useState<string>(PENDING_REASONS[0]);
  const [noteHtml, setNoteHtml] = useState("");
  const [isInternal, setIsInternal] = useState(true); // waiting notes default to internal
  const [busy, setBusy] = useState(false);
  const t = useT("tickets");
  const tc = useT("common");
  const te = useEnumT();

  const opts: ComboOption[] = PENDING_REASONS.map((r) => ({
    value: r, label: te(PENDING_REASON_META, r), tone: PENDING_REASON_META[r].tone, icon: PENDING_REASON_META[r].icon,
  }));

  async function confirm() {
    if (busy) return;
    setBusy(true);
    const committed = await onConfirm({ reason, noteHtml, isInternal });
    if (committed) onClose();
    else setBusy(false);
  }

  function confirmOnEnter(e: React.KeyboardEvent) {
    if (!isConfirmShortcut(e, keyTargetOf(e.target))) return;
    e.preventDefault();
    void confirm();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{status === "ON_HOLD" ? t("pending.titleOnHold") : t("pending.titlePending")}</DialogTitle>
        <DialogDescription>{t("pending.description")}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-3" onKeyDown={confirmOnEnter}>
        <div className="grid gap-1.5">
          <Label>{t("pending.reason")}</Label>
          <Combobox options={opts} value={reason} onChange={setReason} />
        </div>
        <div className="grid gap-1.5">
          <Label>{t("pending.noteOptional")}</Label>
          <RichTextEditor
            name="pendingNote"
            ariaLabel={t("work.note")}
            placeholder={t("pending.notePlaceholder")}
            onChangeHTML={setNoteHtml}
          />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="pend-internal" checked={isInternal} onCheckedChange={(v) => setIsInternal(v === true)} />
          <Label htmlFor="pend-internal" className="text-xs text-muted-foreground">{t("pending.internalNote")}</Label>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>{tc("cancel")}</Button>
          <Button type="button" onClick={confirm} disabled={busy} autoFocus>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {tc("confirm")}
          </Button>
        </DialogFooter>
      </div>
    </>
  );
}
