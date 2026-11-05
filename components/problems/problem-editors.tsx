"use client";

import { toast } from "sonner";
import { updateProblemDetails, updateProblemText } from "@/lib/actions/problems";
import { EditEntityDialog } from "@/components/edit-entity-dialog";
import { EditableTextCard } from "@/components/editable-text-card";

/**
 * Surfaces a refusal (e.g. the problem was closed meanwhile) as a toast. The shared editors
 * close themselves after the action returns, so a refused edit is not kept open for retry.
 */
async function toastRefusal(result: Promise<{ ok: boolean; error?: string }>) {
  const res = await result;
  if (res.ok) toast.success("Saved");
  else toast.error(res.error);
}

type TextCardProps = Omit<React.ComponentProps<typeof EditableTextCard>, "action" | "idField">;

/** An EditableTextCard bound to the problem's text-field action, reporting refusals as a toast. */
export function ProblemTextCard(props: TextCardProps) {
  return <EditableTextCard {...props} idField="id" action={(fd) => toastRefusal(updateProblemText(fd))} />;
}

type DetailsDialogProps = Omit<React.ComponentProps<typeof EditEntityDialog>, "action" | "idField" | "entityLabel">;

/** The title/description editor of a problem, reporting refusals as a toast. */
export function ProblemDetailsDialog(props: DetailsDialogProps) {
  return <EditEntityDialog {...props} idField="id" entityLabel="problem" action={(fd) => toastRefusal(updateProblemDetails(fd))} />;
}
