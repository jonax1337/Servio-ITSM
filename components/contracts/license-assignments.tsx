"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { HardDrive, Loader2, Plus, Users } from "lucide-react";
import { toast } from "sonner";
import { assignLicense, unassignLicense } from "@/lib/actions/contracts";
import { licenseCompliance } from "@/lib/contract-rules";
import { useServerMessage, useT } from "@/lib/i18n/client";
import type { Translator } from "@/lib/i18n/translate";
import { formatDayIn } from "./contract-format";
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
function seatOutlook(t: Translator<"contracts">, seats: number, used: number): { text: string; overAllocates: boolean } {
  const { free } = licenseCompliance(seats, used);
  if (free > 0) return { text: t("seats.outlookFree", { free, seats }), overAllocates: false };
  return { text: t("seats.outlookTaken", { seats }), overAllocates: true };
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
  const t = useT("contracts");
  const tm = useServerMessage();
  const outlook = seatOutlook(t, seats, used);

  function submit() {
    const formData = new FormData();
    formData.set("licenseId", licenseId);
    formData.set("userId", userId);
    formData.set("assetId", assetId);
    startTransition(async () => {
      const result = await assignLicense(formData);
      if (!result.ok) {
        toast.error(result.error ? tm(result.error) : t("seats.couldNotAssign"));
        return;
      }
      toast.success(t("seats.assignedToast"));
      setOpen(false);
      setUserId("");
      setAssetId("");
    });
  }

  return (
    <>
      <Button type="button" variant="outline" size="xs" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" /> {t("seats.assignSeat")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("seats.assignTitle")}</DialogTitle>
            <DialogDescription>{t("seats.assignDescription")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>{t("seats.user")}</Label>
              <Combobox options={[{ value: "", label: t("seats.noUser") }, ...userOptions]} value={userId} onChange={setUserId} placeholder={t("seats.noUser")} searchPlaceholder={t("seats.searchUsers")} />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("seats.asset")}</Label>
              <Combobox options={[{ value: "", label: t("seats.noAsset") }, ...assetOptions]} value={assetId} onChange={setAssetId} placeholder={t("seats.noAsset")} searchPlaceholder={t("seats.searchAssets")} />
            </div>
            <p className={outlook.overAllocates ? "text-xs text-amber-600 dark:text-amber-400" : "text-xs text-muted-foreground"}>
              {outlook.text}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" onClick={submit} disabled={pending || (!userId && !assetId)}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("seats.assign")}
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
  const t = useT("contracts");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Users className="size-4 text-muted-foreground" />
          {t("seats.assignedCount", { count: assignments.length })}
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
            {canEdit ? t("seats.emptyEditable") : t("seats.empty")}
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
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">{t("seats.since", { date: formatDayIn(t.locale, new Date(a.assignedAt)) })}</span>
              {canEdit ? <UnlinkButton action={unassignLicense} fields={{ assignmentId: a.id }} successMessage={t("seats.released")} /> : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
