"use client";

import { Trash2 } from "lucide-react";
import { deleteFreezeWindow } from "@/lib/actions/change-freeze";
import { ConfirmButton } from "@/components/confirm-dialog";

/** Deletes a freeze window behind a confirmation. */
export function DeleteFreezeButton({ id, name }: { id: string; name: string }) {
  return (
    <ConfirmButton
      action={deleteFreezeWindow}
      fields={{ id }}
      successMessage="Freeze window deleted"
      title="Delete freeze window"
      description={`Delete "${name}"? Changes planned in this period are no longer held back.`}
      triggerLabel={`Delete ${name}`}
      triggerVariant="outline"
      triggerClassName="text-muted-foreground hover:border-destructive/40 hover:text-destructive"
    >
      <Trash2 className="size-4" />
    </ConfirmButton>
  );
}
