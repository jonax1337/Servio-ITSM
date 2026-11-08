"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { useFormatter, useT } from "@/lib/i18n/client";
import { Loader2 } from "lucide-react";

const POLL_INTERVAL_MS = 30_000;
const CLOCK_INTERVAL_MS = 15_000;

/** Whether maintenance mode is still on; a failed request counts as "still on" (the server may be restarting). */
async function maintenanceActive(): Promise<boolean> {
  try {
    const response = await fetch("/api/maintenance", { cache: "no-store" });
    if (!response.ok) return true;
    return ((await response.json()) as { active?: boolean }).active === true;
  } catch {
    return true;
  }
}

/** Expected end (relative and absolute, in the visitor's time zone, so only after mount); polls the status API and sends visitors back to the app once maintenance is over. */
export function MaintenanceCountdown({ endsAt }: { endsAt: string }) {
  const end = new Date(endsAt);
  const t = useT("maintenance");
  const f = useFormatter();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    const firstTick = setTimeout(tick, 0);
    const clock = setInterval(tick, CLOCK_INTERVAL_MS);
    const poll = setInterval(async () => {
      if (!(await maintenanceActive())) window.location.replace("/");
    }, POLL_INTERVAL_MS);
    return () => {
      clearTimeout(firstTick);
      clearInterval(clock);
      clearInterval(poll);
    };
  }, []);

  const overdue = now !== null && end.getTime() <= now.getTime();
  return (
    <div className="mt-6 grid gap-1 border-t pt-4 text-sm">
      <p className="font-medium">
        {overdue ? t("takingLonger") : t("expectedBack")}
        {now && !overdue ? <span className="text-muted-foreground">{t("inAbout", { duration: formatDistanceToNowStrict(end, { locale: f.dateFnsLocale }) })}</span> : null}
      </p>
      {now ? <p className="text-muted-foreground">{t("plannedEnd", { date: f.date(end, "dateTime") })}</p> : null}
      <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden /> {t("refreshesItself")}
      </p>
    </div>
  );
}
