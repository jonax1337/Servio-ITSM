"use client";

import { useSyncExternalStore } from "react";
import { useFormatter } from "@/lib/i18n/client";
import { createFormatter, type Formatter } from "@/lib/i18n/format";

const EN = createFormatter("en");

const subscribeNever = () => () => {};

/** False while rendering on the server and hydrating, true from then on (and on a fresh client mount). */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}

/** "3 minutes ago" / "vor 3 Minuten" — a `render` for {@link LocalTime}. */
export const timeAgo = (date: Date, f: Formatter = EN): string => f.relative(date);

/**
 * A timestamp whose text depends on the viewer's clock or time zone ("3 minutes ago", a local
 * date). Server and browser would compute different text — a relative time crosses a boundary
 * between render and hydration, and the server formats in its own zone (UTC in Docker) — so the
 * text appears once the browser has hydrated. Server-formatted text belongs in a server component.
 * `render` receives the viewer's locale formatter (lib/i18n/format.ts) as its second argument.
 */
export function LocalTime({ date, render }: { date: Date | string; render: (date: Date, f: Formatter) => string }) {
  const hydrated = useHydrated();
  const f = useFormatter();
  const value = new Date(date);
  return <time dateTime={value.toISOString()}>{hydrated ? render(value, f) : null}</time>;
}
