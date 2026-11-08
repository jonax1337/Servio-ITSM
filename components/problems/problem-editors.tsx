"use client";

import { toast } from "sonner";
import { updateProblemDetails, updateProblemText } from "@/lib/actions/problems";
import { EditEntityDialog } from "@/components/edit-entity-dialog";
import { EditableTextCard } from "@/components/editable-text-card";
import { useServerMessage, useT } from "@/lib/i18n/client";

/**
 * Surfaces a refusal (e.g. the problem was closed meanwhile) as a toast. The shared editors
 * close themselves after the action returns, so a refused edit is not kept open for retry.
 */
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

/** An EditableTextCard bound to the problem's text-field action, reporting refusals as a toast. */
export function ProblemTextCard(props: TextCardProps) {
  const toastRefusal = useToastRefusal();
  return <EditableTextCard {...props} idField="id" action={(fd) => toastRefusal(updateProblemText(fd))} />;
}

type DetailsDialogProps = Omit<React.ComponentProps<typeof EditEntityDialog>, "action" | "idField" | "entityLabel">;

/** The title/description editor of a problem, reporting refusals as a toast. */
export function ProblemDetailsDialog(props: DetailsDialogProps) {
  const toastRefusal = useToastRefusal();
  const t = useT("problems");
  return <EditEntityDialog {...props} idField="id" entityLabel={t("entityLower")} action={(fd) => toastRefusal(updateProblemDetails(fd))} />;
}
