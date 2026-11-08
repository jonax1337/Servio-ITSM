import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ChangeTabContext } from "@/components/changes/tabs/types";
import { getFormatter, getT } from "@/lib/i18n/server";

/** Read-only schedule summary for the properties rail; the window is edited on the Planning tab. */
export async function WindowSummary({ change, className }: { change: ChangeTabContext["change"]; className?: string }) {
  const [t, f] = await Promise.all([getT("changes"), getFormatter()]);
  const fmt = (date: Date | null) => f.date(date, "dateTime");
  return (
    <Card className={className}>
      <CardHeader><CardTitle className="text-sm">{t("planning.plannedWindow")}</CardTitle></CardHeader>
      <CardContent className="grid gap-2.5 text-sm">
        <Meta label={t("window.plannedStart")} value={fmt(change.plannedStart)} />
        <Meta label={t("window.plannedEnd")} value={fmt(change.plannedEnd)} />
        {change.actualStart ? <Meta label={t("window.actualStart")} value={fmt(change.actualStart)} /> : null}
        {change.actualEnd ? <Meta label={t("window.actualEnd")} value={fmt(change.actualEnd)} /> : null}
        <Meta label={t("window.created")} value={fmt(change.createdAt)} />
      </CardContent>
    </Card>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
