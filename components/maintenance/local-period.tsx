"use client";

import { useEffect, useState } from "react";
import { useFormatter, useT } from "@/lib/i18n/client";
import type { Formatter } from "@/lib/i18n/format";
import type { Translator } from "@/lib/i18n/translate";

function periodLabel(startsAt: string | null, endsAt: string, f: Formatter, t: Translator<"maintenance">): string {
  const end = f.date(endsAt, "dateTime");
  return startsAt ? `${f.date(startsAt, "dateTime")} – ${end}` : t("plannedEnd", { date: end });
}

/**
 * A maintenance period in the viewer's own time zone. The server would format it in its
 * zone (UTC in Docker) without saying so, so the text appears once the browser has mounted.
 */
export function LocalPeriod({ startsAt, endsAt }: { startsAt: string | null; endsAt: string }) {
  const [label, setLabel] = useState<string | null>(null);
  const f = useFormatter();
  const t = useT("maintenance");

  useEffect(() => {
    const timer = setTimeout(() => setLabel(periodLabel(startsAt, endsAt, f, t)), 0);
    return () => clearTimeout(timer);
  }, [startsAt, endsAt, f, t]);

  return <span className="tabular-nums">{label}</span>;
}
