"use client";

import { toast } from "sonner";
import { updateChangeDetails, updateChangeText } from "@/lib/actions/changes";
import { EditEntityDialog } from "@/components/edit-entity-dialog";
import { EditableTextCard } from "@/components/editable-text-card";
import { useServerMessage, useT } from "@/lib/i18n/client";

/** Surfaces a refusal (e.g. the change was closed meanwhile) instead of silently closing the editor. */
function useToastRefusal() {
  const tc = useT("common");
  const tm = useServerMessage();
  return async (result: Promise<{ ok: boolean; error?: string }>) => {
    const res = await result;
    if (res.ok) toast.success(tc("saved"));
    else toast.error(tm(res.error));
  };
}

type TextCardProps = Omit<React.ComponentProps<typeof EditableTextCard>, "action" | "idField">;

/** An EditableTextCard bound to the change's text-field action, reporting refusals as a toast. */
export function ChangeTextCard(props: TextCardProps) {
  const toastRefusal = useToastRefusal();
  return <EditableTextCard {...props} idField="id" action={(fd) => toastRefusal(updateChangeText(fd))} />;
}

type DetailsDialogProps = Omit<React.ComponentProps<typeof EditEntityDialog>, "action" | "idField" | "entityLabel">;

/** The title/description editor of a change, reporting refusals as a toast. */
export function ChangeDetailsDialog(props: DetailsDialogProps) {
  const toastRefusal = useToastRefusal();
  const t = useT("changes");
  return <EditEntityDialog {...props} idField="id" entityLabel={t("detail.entityLabel")} action={(fd) => toastRefusal(updateChangeDetails(fd))} />;
}
