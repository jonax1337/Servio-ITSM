/** Pure rules of the daily briefing widget (lib/dashboard/briefing.ts loads the data). */

import type { BriefingSection } from "@/lib/dashboard/types";

/** Items listed per section; the rest is only counted. */
export const BRIEFING_ITEMS_PER_SECTION = 5;

const HOUR_MS = 3_600_000;
const CHANGE_LOOKAHEAD_MS = 24 * HOUR_MS;

/** Statuses of a change that has not started implementing yet. */
export const PRE_START_CHANGE_STATUSES: readonly string[] = ["DRAFT", "APPROVAL", "APPROVED", "SCHEDULED"];

/** The period in which a change counts as "starting soon": from now until 24 hours ahead. */
export function changeStartWindow(now: Date): { from: Date; to: Date } {
  return { from: now, to: new Date(now.getTime() + CHANGE_LOOKAHEAD_MS) };
}

/** The ticket waits on the agent: the latest public message came from the requester. */
export function customerRepliedLast(lastPublicAuthorId: string | null, requesterId: string): boolean {
  return lastPublicAuthorId === requesterId;
}

/** How long ago `since` was, in the coarsest unit that is not zero (for a localized label). */
export function ageParts(since: Date, now: Date): { unit: "h" | "d"; n: number } {
  const hours = Math.max(0, Math.floor((now.getTime() - since.getTime()) / HOUR_MS));
  return hours >= 24 ? { unit: "d", n: Math.floor(hours / 24) } : { unit: "h", n: hours };
}

/** How long until `at`, in hours from 60 minutes on (for a localized label). */
export function untilParts(at: Date, now: Date): { unit: "m" | "h"; n: number } {
  const minutes = Math.max(0, Math.round((at.getTime() - now.getTime()) / 60_000));
  return minutes >= 60 ? { unit: "h", n: Math.floor(minutes / 60) } : { unit: "m", n: minutes };
}

/** "3h", "2d": how long ago `since` was, in the coarsest unit that is not zero. */
export function ageLabel(since: Date, now: Date): string {
  const { unit, n } = ageParts(since, now);
  return `${n}${unit}`;
}

/** "in 5h", "in 25m": how long until `at`. */
export function untilLabel(at: Date, now: Date): string {
  const { unit, n } = untilParts(at, now);
  return `in ${n}${unit}`;
}

export function briefingIsEmpty(sections: BriefingSection[]): boolean {
  return sections.every((section) => section.total === 0);
}

/** The briefing as plain text for the AI summary: one line per listed item, counts for the rest. */
export function briefingToText(sections: BriefingSection[]): string {
  return sections
    .filter((section) => section.total > 0)
    .map((section) => {
      const lines = section.items.map((item) => `- ${item.label}: ${item.detail}`);
      const more = section.total - section.items.length;
      if (more > 0) lines.push(`- and ${more} more`);
      return `${section.title} (${section.total}):\n${lines.join("\n")}`;
    })
    .join("\n\n");
}
