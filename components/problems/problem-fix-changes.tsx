"use client";

import { setChangeProblem } from "@/lib/actions/changes";
import { setTicketProblem } from "@/lib/actions/tickets";
import { LinkPicker } from "@/components/link-picker";
import { UnlinkButton } from "@/components/linked-records";
import type { ComboOption } from "@/components/combobox";
import { useT } from "@/lib/i18n/client";

/** Picker that links an existing change to this problem as its fix. */
export function ProblemChangePicker({
  problemId, options,
}: {
  problemId: number;
  options: ComboOption[];
}) {
  const t = useT("problems");
  const link = (formData: FormData) => setChangeProblem(Number(formData.get("changeId")), problemId);

  return (
    <LinkPicker
      action={link}
      successMessage={t("changes.linked")}
      triggerLabel={t("changes.link")}
      title={t("changes.linkTitle")}
      description={t("changes.linkDescription")}
      hidden={{ problemId }}
      valueName="changeId"
      options={options}
      placeholder={t("changes.choose")}
      searchPlaceholder={t("changes.search")}
      emptyText={t("changes.noneAvailable")}
    />
  );
}

/** Unlink control for a fix-change row; the row must carry the `group/chip` class that reveals it on hover. */
export function UnlinkChangeButton({ changeId }: { changeId: number }) {
  const t = useT("problems");
  return (
    <UnlinkButton
      action={() => setChangeProblem(changeId, null)}
      fields={{ changeId }}
      successMessage={t("changes.unlinked")}
    />
  );
}

/** Unlink control for a linked-incident row; the row must carry the `group/chip` class that reveals it on hover. */
export function UnlinkIncidentButton({ ticketId }: { ticketId: number }) {
  const t = useT("problems");
  return (
    <UnlinkButton
      action={setTicketProblem}
      fields={{ ticketId, problemId: "" }}
      successMessage={t("incidents.unlinked")}
    />
  );
}
