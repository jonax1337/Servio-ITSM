/**
 * Scheduler tick for Sable insights: raises AiInsight rows for incident
 * clusters and knowledge-base gaps (each at most once via `dedupeKey`).
 * Run by lib/scheduler.ts with an overlap guard and error isolation.
 */
import { getBoolSetting } from "@/lib/settings";
import { detectInsights } from "@/lib/ai-insights";

export async function runInsightsTick(): Promise<void> {
  if (!(await getBoolSetting("INSIGHTS_ENABLED", true))) return;
  const { clusters, kbGaps } = await detectInsights();
  if (clusters + kbGaps > 0) {
    console.log(`[servio:insights] raised ${clusters} incident cluster(s) and ${kbGaps} knowledge gap(s)`);
  }
}
