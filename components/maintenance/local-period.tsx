"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";

const PERIOD_DATE = "PP p";

function periodLabel(startsAt: string | null, endsAt: string): string {
  const end = format(new Date(endsAt), PERIOD_DATE);
  return startsAt ? `${format(new Date(startsAt), PERIOD_DATE)} – ${end}` : `Planned end: ${end}`;
}

/**
 * A maintenance period in the viewer's own time zone. The server would format it in its
 * zone (UTC in Docker) without saying so, so the text appears once the browser has mounted.
 */
export function LocalPeriod({ startsAt, endsAt }: { startsAt: string | null; endsAt: string }) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setLabel(periodLabel(startsAt, endsAt)), 0);
    return () => clearTimeout(timer);
  }, [startsAt, endsAt]);

  return <span className="tabular-nums">{label}</span>;
}
