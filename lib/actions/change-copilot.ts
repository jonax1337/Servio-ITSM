"use server";

import { z } from "zod";
import { requireAgentUser } from "@/lib/session";
import { aiConfigured, generateAiObject, generateAiText } from "@/lib/ai";
import { AI_ASSISTANT_NAME } from "@/lib/constants";
import { changeLockedMessage, isChangeLocked } from "@/lib/change-rules";
import { loadChangeBrief } from "@/lib/change-brief";
import { renderFacts, type ChangeBriefFacts } from "@/lib/change-brief-rules";

/**
 * Sable's drafts for a change. Nothing here writes: the user reviews each field and applies it with
 * the existing updateChangeText action (see components/changes/change-copilot-panel.tsx).
 */

const NOT_CONFIGURED =
  "AI is not configured. Set AI_PROVIDER (and, for external providers, AI_ALLOW_EXTERNAL=true plus the API key).";

const changeIdSchema = z.coerce.number().int().positive();

const draftSchema = z.object({
  implementationPlan: z.string().min(1),
  rollbackPlan: z.string().min(1),
  riskRationale: z.string().min(1),
});

export type ChangeDraft = z.infer<typeof draftSchema>;

export type ChangeDraftResult = { ok: true; draft: ChangeDraft } | { ok: false; error: string };
export type CabBriefProseResult = { ok: true; text: string } | { ok: false; error: string };

type Loaded = { ok: true; facts: ChangeBriefFacts } | { ok: false; error: string };

/** The shared gate of both actions: an agent, AI on, and an existing change. */
async function loadForAi(rawChangeId: number): Promise<Loaded> {
  if (!(await requireAgentUser())) return { ok: false, error: "Not authorised" };
  if (!(await aiConfigured())) return { ok: false, error: NOT_CONFIGURED };
  const changeId = changeIdSchema.safeParse(rawChangeId);
  if (!changeId.success) return { ok: false, error: "Invalid request" };
  const facts = await loadChangeBrief(changeId.data);
  if (!facts) return { ok: false, error: "Change not found" };
  return { ok: true, facts };
}

/** Models still emit bold markers now and then; the plan fields and the brief are plain text. */
const stripEmphasis = (text: string) => text.replace(/\*\*(.+?)\*\*/g, "$1");

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "AI request failed");

const DRAFT_SYSTEM = [
  `You are ${AI_ASSISTANT_NAME}, helping a change manager prepare an ITSM change for approval.`,
  "From the change record, its affected configuration items and the CMDB impact analysis, draft:",
  "- implementationPlan: concrete numbered steps in execution order, including pre-checks and verification.",
  "- rollbackPlan: concrete numbered steps to restore the previous state, and the condition that triggers them.",
  "- riskRationale: two to four sentences on why the risk is what it is, naming the affected and downstream CIs.",
  "Use ONLY facts in the record; where a detail is unknown, say what must be confirmed instead of inventing it.",
  "Write plain text (no markdown, no headings), in the language of the change description. Keep each field under 1500 characters.",
  "Use these exact JSON keys: implementationPlan, rollbackPlan, riskRationale.",
].join("\n");

/** Draft an implementation plan, a rollback plan and a risk rationale. Never saves anything. */
export async function draftChangePlan(changeId: number): Promise<ChangeDraftResult> {
  const loaded = await loadForAi(changeId);
  if (!loaded.ok) return loaded;
  if (isChangeLocked(loaded.facts.status)) return { ok: false, error: changeLockedMessage(loaded.facts.status) };

  try {
    const draft = await generateAiObject({
      system: DRAFT_SYSTEM,
      prompt: `Draft the plans for this change:\n\n${renderFacts(loaded.facts)}`,
      schema: draftSchema,
    });
    return {
      ok: true,
      draft: {
        implementationPlan: stripEmphasis(draft.implementationPlan),
        rollbackPlan: stripEmphasis(draft.rollbackPlan),
        riskRationale: stripEmphasis(draft.riskRationale),
      },
    };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

const BRIEF_SYSTEM = [
  `You are ${AI_ASSISTANT_NAME}, briefing a change advisory board (CAB) before it decides.`,
  "Write one short paragraph (at most 90 words) in plain text: what the change does, the risk and blast radius,",
  "what is missing or weak (plans, window, approvals), and your recommendation to approve, ask for more, or reject.",
  "Use ONLY the facts given; never invent details. Reply in the language of the change description.",
].join("\n");

/** A short prose briefing for the CAB, generated from the same facts the brief card shows. */
export async function summarizeChangeForCab(changeId: number): Promise<CabBriefProseResult> {
  const loaded = await loadForAi(changeId);
  if (!loaded.ok) return loaded;

  try {
    const text = await generateAiText({ system: BRIEF_SYSTEM, prompt: renderFacts(loaded.facts) });
    return { ok: true, text: stripEmphasis(text) };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
