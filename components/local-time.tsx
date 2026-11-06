"use client";

import { useSyncExternalStore } from "react";
import { formatDistanceToNow } from "date-fns";

const subscribeNever = () => () => {};

/** False while rendering on the server and hydrating, true from then on (and on a fresh client mount). */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}

/** "3 minutes ago" — a `render` for {@link LocalTime}. */
export const timeAgo = (date: Date): string => formatDistanceToNow(date, { addSuffix: true });

/**
 * A timestamp whose text depends on the viewer's clock or time zone ("3 minutes ago", a local
 * date). Server and browser would compute different text — a relative time crosses a boundary
 * between render and hydration, and the server formats in its own zone (UTC in Docker) — so the
 * text appears once the browser has hydrated. Server-formatted text belongs in a server component.
 */
export function LocalTime({ date, render }: { date: Date | string; render: (date: Date) => string }) {
  const hydrated = useHydrated();
  const value = new Date(date);
  return <time dateTime={value.toISOString()}>{hydrated ? render(value) : null}</time>;
}
