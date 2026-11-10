/**
 * Scheduler tick that keeps the generated public holidays of business calendars current: it adds
 * the days of the coming year once a year turns and picks up rule corrections. A calendar without a
 * region is not touched. Run by lib/scheduler.ts with an overlap guard and error isolation; the work
 * (and the rules) live in lib/holiday-sync.ts and lib/public-holidays.ts.
 */
import { syncAllGeneratedHolidays } from "@/lib/holiday-sync";

export async function runHolidaysTick(): Promise<void> {
  const res = await syncAllGeneratedHolidays();
  if (res.created || res.removed || res.renamed) {
    console.log(`[servio:holidays] calendars=${res.calendars} created=${res.created} removed=${res.removed} renamed=${res.renamed}`);
  }
}
