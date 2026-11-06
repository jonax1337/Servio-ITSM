"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { isConfirmShortcut, keyTargetOf } from "@/lib/confirm-shortcut";
import { RESOLUTION_CODES, RESOLUTION_CODE_META } from "@/lib/constants";
import { Combobox, type ComboOption } from "@/components/combobox";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

export type ResolutionPayload = { code: string | null; noteHtml: string; isInternal: boolean; resolveChildren: boolean };

/** Captures the resolution/cancel note (rich text + internal/external). Confirm hands
 *  the data to onConfirm, which commits it; the dialog stays open until that returns true. */
export function ResolutionDialog({
  status, openChildCount, open, onOpenChange, onConfirm,
}: {
  status: string;
  /** Open child tickets that "Resolve" can take along. */
  openChildCount: number;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onConfirm: (payload: ResolutionPayload) => Promise<boolean>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Inner form only mounts while open, so its state resets on every open. */}
        {open ? <ResolutionForm status={status} openChildCount={openChildCount} onClose={() => onOpenChange(false)} onConfirm={onConfirm} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ResolutionForm({
  status, openChildCount, onClose, onConfirm,
}: {
  status: string;
  openChildCount: number;
  onClose: () => void;
  onConfirm: (payload: ResolutionPayload) => Promise<boolean>;
}) {
  const isCancel = status === "CANCELLED";
  // Only a resolution is shared with children; closing or cancelling a parent leaves them alone.
  const offerChildren = status === "RESOLVED" && openChildCount > 0;
  const [code, setCode] = useState<string>(RESOLUTION_CODES[0]);
  const [noteHtml, setNoteHtml] = useState("");
  const [isInternal, setIsInternal] = useState(false); // resolution note is customer-facing by default
  const [resolveChildren, setResolveChildren] = useState(true);
  const [busy, setBusy] = useState(false);

  const codeOpts: ComboOption[] = RESOLUTION_CODES.map((c) => ({
    value: c, label: RESOLUTION_CODE_META[c].label, tone: RESOLUTION_CODE_META[c].tone, icon: RESOLUTION_CODE_META[c].icon,
  }));
  const title = isCancel ? "Cancel ticket" : status === "CLOSED" ? "Close ticket" : "Resolve ticket";
  const hasNote = noteHtml.replace(/<[^>]+>/g, "").trim().length > 0;

  async function confirm() {
    if (!hasNote || busy) return;
    setBusy(true);
    const committed = await onConfirm({ code: isCancel ? null : code, noteHtml, isInternal, resolveChildren: offerChildren && resolveChildren });
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
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {isCancel ? "Add a short reason for cancelling this ticket." : "Record how this ticket was resolved so the requester knows what happened."}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3" onKeyDown={confirmOnEnter}>
        {!isCancel ? (
          <div className="grid gap-1.5">
            <Label>Resolution code</Label>
            <Combobox options={codeOpts} value={code} onChange={setCode} />
          </div>
        ) : null}
        <div className="grid gap-1.5">
          <Label>{isCancel ? "Cancellation reason" : "Resolution note"}</Label>
          <RichTextEditor
            name="resolutionNote"
            ariaLabel="Note"
            placeholder={isCancel ? "Why is this being cancelled?" : "What was done to resolve it?"}
            onChangeHTML={setNoteHtml}
            onReady={(editor) => editor.focus()}
          />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="res-internal" checked={isInternal} onCheckedChange={(v) => setIsInternal(v === true)} />
          <Label htmlFor="res-internal" className="text-xs text-muted-foreground">Internal note (not visible to the requester)</Label>
        </div>
        {offerChildren ? (
          <div className="flex items-center gap-2">
            <Checkbox id="res-children" checked={resolveChildren} onCheckedChange={(v) => setResolveChildren(v === true)} />
            <Label htmlFor="res-children" className="text-xs text-muted-foreground">
              Also resolve {openChildCount} open direct child ticket{openChildCount === 1 ? "" : "s"} with this resolution
            </Label>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="button" variant={isCancel ? "destructive" : "default"} disabled={!hasNote || busy} onClick={confirm}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {isCancel ? "Cancel ticket" : "Confirm"}
          </Button>
        </DialogFooter>
      </div>
    </>
  );
}
