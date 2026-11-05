"use client";

import { toast } from "sonner";
import { updateChangeDetails, updateChangeText } from "@/lib/actions/changes";
import { EditEntityDialog } from "@/components/edit-entity-dialog";
import { EditableTextCard } from "@/components/editable-text-card";

/** Surfaces a refusal (e.g. the change was closed meanwhile) instead of silently closing the editor. */
async function toastRefusal(result: Promise<{ ok: boolean; error?: string }>) {
  const res = await result;
  if (res.ok) toast.success("Saved");
  else toast.error(res.error);
}

type TextCardProps = Omit<React.ComponentProps<typeof EditableTextCard>, "action" | "idField">;

/** An EditableTextCard bound to the change's text-field action, reporting refusals as a toast. */
export function ChangeTextCard(props: TextCardProps) {
  return <EditableTextCard {...props} idField="id" action={(fd) => toastRefusal(updateChangeText(fd))} />;
}

type DetailsDialogProps = Omit<React.ComponentProps<typeof EditEntityDialog>, "action" | "idField" | "entityLabel">;

/** The title/description editor of a change, reporting refusals as a toast. */
export function ChangeDetailsDialog(props: DetailsDialogProps) {
  return <EditEntityDialog {...props} idField="id" entityLabel="change" action={(fd) => toastRefusal(updateChangeDetails(fd))} />;
}
