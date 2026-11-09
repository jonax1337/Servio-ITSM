"use client";

import type { Formatter } from "@/lib/i18n/format";

/** Date and time in the viewer's zone and language — a `render` for LocalTime (components/local-time.tsx). */
export const localDateTime = (date: Date, f: Formatter): string => f.date(date, "dateTime");
