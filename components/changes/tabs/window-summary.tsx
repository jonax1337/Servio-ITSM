import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ChangeTabContext } from "@/components/changes/tabs/types";

const DISPLAY_DATE = "PP p";
const formatOrDash = (date: Date | null) => (date ? format(date, DISPLAY_DATE) : "—");

/** Read-only schedule summary for the properties rail; the window is edited on the Planning tab. */
export function WindowSummary({ change, className }: { change: ChangeTabContext["change"]; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader><CardTitle className="text-sm">Planned window</CardTitle></CardHeader>
      <CardContent className="grid gap-2.5 text-sm">
        <Meta label="Planned start" value={formatOrDash(change.plannedStart)} />
        <Meta label="Planned end" value={formatOrDash(change.plannedEnd)} />
        {change.actualStart ? <Meta label="Actual start" value={format(change.actualStart, DISPLAY_DATE)} /> : null}
        {change.actualEnd ? <Meta label="Actual end" value={format(change.actualEnd, DISPLAY_DATE)} /> : null}
        <Meta label="Created" value={format(change.createdAt, DISPLAY_DATE)} />
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
