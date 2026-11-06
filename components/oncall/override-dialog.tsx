"use client";

import { useState, useTransition } from "react";
import { CalendarClock, Loader2, Plus, Save } from "lucide-react";
import { toast } from "sonner";
import { createOverride } from "@/lib/actions/oncall";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Combobox, type ComboOption } from "@/components/combobox";
import { toDateTimeInputValue } from "./format";
import type { PersonOption } from "./schedule-form";

const HOUR_MS = 3_600_000;
const NO_REPLACEMENT = "none";

const personOption = (p: PersonOption): ComboOption => ({
  value: p.id, label: p.name ?? p.email, avatar: p.name ?? p.email, hint: p.email,
});

/** Next full hour for 24 hours, unless the caller knows better (a swapping agent's own shift). */
function defaultWindow(preferred: { startsAt: Date; endsAt: Date } | undefined) {
  if (preferred) return preferred;
  const startsAt = new Date(Math.ceil(Date.now() / HOUR_MS) * HOUR_MS);
  return { startsAt, endsAt: new Date(startsAt.getTime() + 24 * HOUR_MS) };
}

/**
 * Add an on-call override. Managers choose anyone; a rotation member without
 * manager rights can only hand their own shift to a colleague (`swapForUserId`).
 */
export function OverrideDialog({
  scheduleId, timezone, candidates, rotationMembers, swapForUserId, suggestedWindow,
}: {
  scheduleId: string;
  timezone: string;
  /** People who can be put on call. */
  candidates: PersonOption[];
  /** Rotation members a manager may mark as replaced. */
  rotationMembers: PersonOption[];
  /** Set for a non-manager swapping their own shift: the replaced person is fixed. */
  swapForUserId?: string;
  /** Pre-filled period, e.g. the swapping agent's next shift. */
  suggestedWindow?: { startsAt: Date; endsAt: Date };
}) {
  const swapping = !!swapForUserId;
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [userId, setUserId] = useState("");
  const [replacesUserId, setReplacesUserId] = useState(NO_REPLACEMENT);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");

  const coverOpts = candidates.filter((c) => c.id !== swapForUserId).map(personOption);
  const replaceOpts: ComboOption[] = [{ value: NO_REPLACEMENT, label: "— Nobody in particular —" }, ...rotationMembers.map(personOption)];

  const onOpenChange = (next: boolean) => {
    if (next) {
      const period = defaultWindow(suggestedWindow);
      setStartsAt(toDateTimeInputValue(period.startsAt, timezone));
      setEndsAt(toDateTimeInputValue(period.endsAt, timezone));
      setUserId("");
      setReplacesUserId(NO_REPLACEMENT);
      setError(null);
    }
    setOpen(next);
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const res = await createOverride(formData);
      if (res.ok) {
        setOpen(false);
        toast.success(swapping ? "Shift handed over" : "Override added");
      } else {
        setError(res.error ?? "Could not add the override.");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Plus className="size-4" /> {swapping ? "Swap my shift" : "Add override"}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="size-4 text-primary" /> {swapping ? "Swap your shift" : "New override"}
          </DialogTitle>
          <DialogDescription>
            {swapping
              ? "Hand your on-call time to a colleague. They are notified and take over for the period."
              : "Put someone on call for a period, regardless of the rotation. The rotation resumes afterwards."}{" "}
            Times are in {timezone}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <input type="hidden" name="scheduleId" value={scheduleId} />
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="replacesUserId" value={swapForUserId ?? replacesUserId} />

          {error ? (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          ) : null}

          <div className="grid gap-1.5">
            <Label>{swapping ? "Covered by" : "On call"}</Label>
            <Combobox options={coverOpts} value={userId} onChange={setUserId} placeholder="Choose a person" searchPlaceholder="Search agents…" />
          </div>
          {swapping ? null : (
            <div className="grid gap-1.5">
              <Label>Covering</Label>
              <Combobox options={replaceOpts} value={replacesUserId} onChange={setReplacesUserId} />
              <p className="text-xs text-muted-foreground">Optional. The rotation member whose shift this covers; they are told about it.</p>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="override-starts">From</Label>
              <Input id="override-starts" name="startsAt" type="datetime-local" required value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="override-ends">Until</Label>
              <Input id="override-ends" name="endsAt" type="datetime-local" required value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="override-reason">Reason</Label>
            <Input id="override-reason" name="reason" maxLength={300} placeholder="Optional, e.g. holiday cover" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || !userId}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} {swapping ? "Hand over shift" : "Add override"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
