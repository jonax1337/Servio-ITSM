"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { HardDrive, Loader2, Plus, Users } from "lucide-react";
import { toast } from "sonner";
import { assignLicense, unassignLicense } from "@/lib/actions/contracts";
import { formatDay, licenseCompliance } from "@/lib/contract-rules";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Combobox, type ComboOption } from "@/components/combobox";
import { UnlinkButton } from "@/components/linked-records";
import { UserAvatar } from "@/components/user-avatar";

export type SeatAssignment = {
  id: string;
  assignedAt: Date;
  user: { name: string | null; email: string } | null;
  asset: { id: string; name: string } | null;
};

/** What assigning one more seat does to the license, said before the manager commits to it. */
function seatOutlook(seats: number, used: number): { text: string; overAllocates: boolean } {
  const { free } = licenseCompliance(seats, used);
  if (free > 0) return { text: `${free} of ${seats} ${seats === 1 ? "seat is" : "seats are"} free.`, overAllocates: false };
  return { text: `All ${seats} ${seats === 1 ? "seat is" : "seats are"} taken. Assigning another over-allocates the license.`, overAllocates: true };
}

function AssignSeatDialog({
  licenseId,
  seats,
  used,
  userOptions,
  assetOptions,
}: {
  licenseId: string;
  seats: number;
  used: number;
  userOptions: ComboOption[];
  assetOptions: ComboOption[];
}) {
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [pending, startTransition] = useTransition();
  const outlook = seatOutlook(seats, used);

  function submit() {
    const formData = new FormData();
    formData.set("licenseId", licenseId);
    formData.set("userId", userId);
    formData.set("assetId", assetId);
    startTransition(async () => {
      const result = await assignLicense(formData);
      if (!result.ok) {
        toast.error(result.error ?? "Could not assign the seat.");
        return;
      }
      toast.success("Seat assigned");
      setOpen(false);
      setUserId("");
      setAssetId("");
    });
  }

  return (
    <>
      <Button type="button" variant="outline" size="xs" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" /> Assign seat
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assign a seat</DialogTitle>
            <DialogDescription>Give a seat to a user, to an asset, or to a user on a specific asset.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>User</Label>
              <Combobox options={[{ value: "", label: "No user" }, ...userOptions]} value={userId} onChange={setUserId} placeholder="No user" searchPlaceholder="Search users…" />
            </div>
            <div className="grid gap-1.5">
              <Label>Asset</Label>
              <Combobox options={[{ value: "", label: "No asset" }, ...assetOptions]} value={assetId} onChange={setAssetId} placeholder="No asset" searchPlaceholder="Search assets…" />
            </div>
            <p className={outlook.overAllocates ? "text-xs text-amber-600 dark:text-amber-400" : "text-xs text-muted-foreground"}>
              {outlook.text}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" onClick={submit} disabled={pending || (!userId && !assetId)}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** The seats of a license: who or what holds each one, with assign / release for managers. */
export function LicenseAssignments({
  licenseId,
  seats,
  assignments,
  userOptions,
  assetOptions,
  canEdit,
}: {
  licenseId: string;
  seats: number;
  assignments: SeatAssignment[];
  userOptions: ComboOption[];
  assetOptions: ComboOption[];
  canEdit: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Users className="size-4 text-muted-foreground" />
          Assigned seats · {assignments.length}
          {canEdit ? (
            <span className="ml-auto">
              <AssignSeatDialog
                licenseId={licenseId}
                seats={seats}
                used={assignments.length}
                userOptions={userOptions}
                assetOptions={assetOptions}
              />
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        {assignments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {canEdit
              ? "No seat is assigned yet. Use Assign seat to give one to a user, an asset, or both."
              : "No seat is assigned yet."}
          </p>
        ) : (
          assignments.map((a) => (
            <div key={a.id} className="group/chip flex flex-wrap items-center gap-x-3 gap-y-1">
              {a.user ? (
                <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                  <UserAvatar name={a.user.name} email={a.user.email} size="xs" />
                  <span className="truncate">{a.user.name ?? a.user.email}</span>
                </span>
              ) : null}
              {a.asset ? (
                <Link href={`/assets/${a.asset.id}`} className="flex min-w-0 items-center gap-1.5 text-sm hover:text-primary">
                  <HardDrive className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{a.asset.name}</span>
                </Link>
              ) : null}
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">since {formatDay(a.assignedAt)}</span>
              {canEdit ? <UnlinkButton action={unassignLicense} fields={{ assignmentId: a.id }} successMessage="Seat released" /> : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
