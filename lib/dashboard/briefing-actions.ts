"use server";

import { aiConfigured, generateAiText } from "@/lib/ai";
import { AI_ASSISTANT_NAME } from "@/lib/constants";
import { requireAgentUser } from "@/lib/session";
import { loadBriefingSections } from "@/lib/dashboard/briefing";
import { briefingIsEmpty, briefingToText } from "@/lib/dashboard/briefing-rules";

export type BriefingSummaryResult = { ok: true; text: string } | { ok: false; error: string };

const NOT_CONFIGURED =
  "AI is not configured. Set AI_PROVIDER (and, for external providers, AI_ALLOW_EXTERNAL=true plus the API key).";

const ALL_CLEAR = "Nothing needs your attention right now.";

const SYSTEM = [
  `You are ${AI_ASSISTANT_NAME}, giving a support agent their morning briefing.`,
  "Write ONE short paragraph of plain text (at most 70 words): what to do first and why, then what can wait.",
  "Use only the items given, mention ticket and change references as written, never invent anything.",
].join("\n");

/** A one-paragraph AI summary of the viewer's own briefing; the facts are re-read on the server. */
export async function summarizeBriefing(): Promise<BriefingSummaryResult> {
  const me = await requireAgentUser();
  if (!me) return { ok: false, error: "Not authorised" };
  if (!(await aiConfigured())) return { ok: false, error: NOT_CONFIGURED };

  const sections = await loadBriefingSections(me.id);
  if (briefingIsEmpty(sections)) return { ok: true, text: ALL_CLEAR };

  try {
    const text = await generateAiText({ system: SYSTEM, prompt: briefingToText(sections) });
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "AI request failed" };
  }
}
