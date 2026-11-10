import { MetaRow, RailCard } from "@/components/detail-layout";
import type { ChangeTabContext } from "@/components/changes/tabs/types";
import { getFormatter, getT } from "@/lib/i18n/server";

/** Read-only schedule summary for the detail page rail; the window is edited on the Planning tab. */
export async function WindowSummary({ change }: { change: ChangeTabContext["change"] }) {
  const [t, f] = await Promise.all([getT("changes"), getFormatter()]);
  const fmt = (date: Date | null) => f.date(date, "dateTime");
  return (
    <RailCard title={t("planning.plannedWindow")}>
      <MetaRow label={t("window.plannedStart")}>{fmt(change.plannedStart)}</MetaRow>
      <MetaRow label={t("window.plannedEnd")}>{fmt(change.plannedEnd)}</MetaRow>
      {change.actualStart ? <MetaRow label={t("window.actualStart")}>{fmt(change.actualStart)}</MetaRow> : null}
      {change.actualEnd ? <MetaRow label={t("window.actualEnd")}>{fmt(change.actualEnd)}</MetaRow> : null}
      <MetaRow label={t("window.created")}>{fmt(change.createdAt)}</MetaRow>
    </RailCard>
  );
}

