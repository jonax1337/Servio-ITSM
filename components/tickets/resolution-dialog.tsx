"use client";

import { useState } from "react";
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

/** Captures the resolution/cancel note (rich text + internal/external). Does not
 *  apply anything itself — onConfirm hands the data back to be staged & saved. */
export function ResolutionDialog({
  status, openChildCount, open, onOpenChange, onConfirm,
}: {
  status: string;
  /** Open child tickets that "Resolve" can take along. */
  openChildCount: number;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onConfirm: (payload: ResolutionPayload) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Inner form only mounts while open, so its state resets on every open. */}
        {open ? <ResolutionForm status={status} openChildCount={openChildCount} onCancel={() => onOpenChange(false)} onConfirm={onConfirm} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ResolutionForm({
  status, openChildCount, onCancel, onConfirm,
}: {
  status: string;
  openChildCount: number;
  onCancel: () => void;
  onConfirm: (payload: ResolutionPayload) => void;
}) {
  const isCancel = status === "CANCELLED";
  // Only a resolution is shared with children; closing or cancelling a parent leaves them alone.
  const offerChildren = status === "RESOLVED" && openChildCount > 0;
  const [code, setCode] = useState<string>(RESOLUTION_CODES[0]);
  const [noteHtml, setNoteHtml] = useState("");
  const [isInternal, setIsInternal] = useState(false); // resolution note is customer-facing by default
  const [resolveChildren, setResolveChildren] = useState(true);

  const codeOpts: ComboOption[] = RESOLUTION_CODES.map((c) => ({
    value: c, label: RESOLUTION_CODE_META[c].label, tone: RESOLUTION_CODE_META[c].tone, icon: RESOLUTION_CODE_META[c].icon,
  }));
  const title = isCancel ? "Cancel ticket" : status === "CLOSED" ? "Close ticket" : "Resolve ticket";
  const hasNote = noteHtml.replace(/<[^>]+>/g, "").trim().length > 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          {isCancel ? "Add a short reason for cancelling this ticket." : "Record how this ticket was resolved so the requester knows what happened."}
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-3">
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
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button
            type="button"
            variant={isCancel ? "destructive" : "default"}
            disabled={!hasNote}
            onClick={() => onConfirm({ code: isCancel ? null : code, noteHtml, isInternal, resolveChildren: offerChildren && resolveChildren })}
          >
            {isCancel ? "Cancel ticket" : "Confirm"}
          </Button>
        </DialogFooter>
      </div>
    </>
  );
}
