"use client";

import { AlertTriangle } from "lucide-react";
import { setChangeProblem } from "@/lib/actions/changes";
import { LinkPicker } from "@/components/link-picker";
import { LinkedChip, UnlinkButton } from "@/components/linked-records";
import type { ComboOption } from "@/components/combobox";
import { useT } from "@/lib/i18n/client";

/** The "Fixes problem" link of a change: a searchable picker to set it, a chip with unlink to show it. */
export function ChangeProblemPicker({
  changeId, options,
}: {
  changeId: number;
  options: ComboOption[];
}) {
  // LinkPicker reports the returned result as a toast and keeps the dialog open on a refusal.
  const link = (formData: FormData) => setChangeProblem(changeId, Number(formData.get("problemId")));
  const t = useT("changes");

  return (
    <LinkPicker
      action={link}
      successMessage={t("problemLink.linked")}
      triggerLabel={t("problemLink.trigger")}
      title={t("problemLink.title")}
      description={t("problemLink.description")}
      hidden={{ changeId }}
      valueName="problemId"
      options={options}
      placeholder={t("problemLink.choose")}
      searchPlaceholder={t("problemLink.search")}
      emptyText={t("problemLink.empty")}
    />
  );
}

export function ChangeProblemChip({
  changeId, problemId, label, editable,
}: {
  changeId: number;
  problemId: number;
  label: string;
  editable: boolean;
}) {
  const unlink = () => setChangeProblem(changeId, null);
  const t = useT("changes");

  return (
    <LinkedChip
      href={`/problems/${problemId}`}
      icon={<AlertTriangle className="size-3.5 text-amber-500" />}
      label={t("problemLink.fixes", { label })}
      unlink={editable ? <UnlinkButton action={unlink} fields={{ changeId }} successMessage={t("problemLink.unlinked")} /> : undefined}
    />
  );
}
