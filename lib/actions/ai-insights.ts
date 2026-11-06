"use server";

import { z } from "zod";
import { requireAgentUser } from "@/lib/session";
import {
  createProblemFromCluster, dismissInsight, draftArticleFromGap, type InsightActor, type InsightResult,
} from "@/lib/ai-insights-handling";

const NOT_AUTHORISED = "Not authorised.";
const insightIdSchema = z.string().min(1);

/** Runs `handle` for the insight named in the form, after re-checking the agent against the database. */
async function handleInsight<T extends object>(
  formData: FormData,
  handle: (insightId: string, actor: InsightActor) => Promise<InsightResult<T>>,
): Promise<InsightResult<T>> {
  const me = await requireAgentUser();
  if (!me) return { ok: false, error: NOT_AUTHORISED };
  const insightId = insightIdSchema.safeParse(formData.get("insightId"));
  if (!insightId.success) return { ok: false, error: "Missing insight." };
  return handle(insightId.data, me);
}

/** Opens a problem for an incident cluster and links its tickets. */
export async function createProblemFromInsight(formData: FormData) {
  return handleInsight(formData, createProblemFromCluster);
}

/** Drafts a knowledge article for a knowledge gap. */
export async function draftArticleFromInsight(formData: FormData) {
  return handleInsight(formData, draftArticleFromGap);
}

export async function dismissAiInsight(formData: FormData) {
  return handleInsight(formData, dismissInsight);
}
