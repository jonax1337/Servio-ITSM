"use client";

import { setChangeProblem } from "@/lib/actions/changes";
import { setTicketProblem } from "@/lib/actions/tickets";
import { LinkPicker } from "@/components/link-picker";
import { UnlinkButton } from "@/components/linked-records";
import type { ComboOption } from "@/components/combobox";

/** Picker that links an existing change to this problem as its fix. */
export function ProblemChangePicker({
  problemId, options,
}: {
  problemId: number;
  options: ComboOption[];
}) {
  const link = (formData: FormData) => setChangeProblem(Number(formData.get("changeId")), problemId);

  return (
    <LinkPicker
      action={link}
      successMessage="Change linked"
      triggerLabel="Link change"
      title="Link a fix change"
      description="Attach an existing change that fixes this problem."
      hidden={{ problemId }}
      valueName="changeId"
      options={options}
      placeholder="Choose a change"
      searchPlaceholder="Search changes…"
      emptyText="No unlinked changes available."
    />
  );
}

/** Unlink control for a fix-change row; the row must carry the `group/chip` class that reveals it on hover. */
export function UnlinkChangeButton({ changeId }: { changeId: number }) {
  return (
    <UnlinkButton
      action={() => setChangeProblem(changeId, null)}
      fields={{ changeId }}
      successMessage="Change unlinked"
    />
  );
}

/** Unlink control for a linked-incident row; the row must carry the `group/chip` class that reveals it on hover. */
export function UnlinkIncidentButton({ ticketId }: { ticketId: number }) {
  return (
    <UnlinkButton
      action={setTicketProblem}
      fields={{ ticketId, problemId: "" }}
      successMessage="Incident unlinked"
    />
  );
}
