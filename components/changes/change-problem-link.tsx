"use client";

import { AlertTriangle } from "lucide-react";
import { setChangeProblem } from "@/lib/actions/changes";
import { LinkPicker } from "@/components/link-picker";
import { LinkedChip, UnlinkButton } from "@/components/linked-records";
import type { ComboOption } from "@/components/combobox";

/** The "Fixes problem" link of a change: a searchable picker to set it, a chip with unlink to show it. */
export function ChangeProblemPicker({
  changeId, options,
}: {
  changeId: number;
  options: ComboOption[];
}) {
  // LinkPicker reports the returned result as a toast and keeps the dialog open on a refusal.
  const link = (formData: FormData) => setChangeProblem(changeId, Number(formData.get("problemId")));

  return (
    <LinkPicker
      action={link}
      successMessage="Problem linked"
      triggerLabel="Fixes problem"
      title="Link the problem this change fixes"
      description="Choose the problem record that this change resolves."
      hidden={{ changeId }}
      valueName="problemId"
      options={options}
      placeholder="Choose a problem"
      searchPlaceholder="Search problems…"
      emptyText="No other problems available to link."
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

  return (
    <LinkedChip
      href={`/problems/${problemId}`}
      icon={<AlertTriangle className="size-3.5 text-amber-500" />}
      label={`Fixes ${label}`}
      unlink={editable ? <UnlinkButton action={unlink} fields={{ changeId }} successMessage="Problem unlinked" /> : undefined}
    />
  );
}
