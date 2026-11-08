"use client";

import { Trash2 } from "lucide-react";
import { deleteFreezeWindow } from "@/lib/actions/change-freeze";
import { ConfirmButton } from "@/components/confirm-dialog";
import { useT } from "@/lib/i18n/client";

/** Deletes a freeze window behind a confirmation. */
export function DeleteFreezeButton({ id, name }: { id: string; name: string }) {
  const t = useT("changes");
  return (
    <ConfirmButton
      action={deleteFreezeWindow}
      fields={{ id }}
      successMessage={t("freeze.deleted")}
      title={t("freeze.deleteTitle")}
      description={t("freeze.deleteDescription", { name })}
      triggerLabel={t("freeze.deleteLabel", { name })}
      triggerVariant="outline"
      triggerClassName="text-muted-foreground hover:border-destructive/40 hover:text-destructive"
    >
      <Trash2 className="size-4" />
    </ConfirmButton>
  );
}
