/** Pure facts and wording behind the change copilot and the CAB brief (lib/change-brief.ts loads the data). */

import { CHANGE_STATUS_META, RISK_META, RISKS } from "@/lib/constants";

// ── Blast radius ─────────────────────────────────────────────────────────────

/** Downstream CIs from which the blast radius counts as high / medium (mirrors the change page). */
const HIGH_BLAST_RADIUS = 8;
const MEDIUM_BLAST_RADIUS = 3;

export function blastRadiusRisk(impactedCount: number): (typeof RISKS)[number] {
  if (impactedCount >= HIGH_BLAST_RADIUS) return "HIGH";
  return impactedCount >= MEDIUM_BLAST_RADIUS ? "MEDIUM" : "LOW";
}

/** A warning when the declared risk is lower than what the blast radius suggests; null otherwise. */
export function riskMismatch(declaredRisk: string, impactedCount: number): string | null {
  const suggested = blastRadiusRisk(impactedCount);
  if (RISKS.indexOf(declaredRisk as (typeof RISKS)[number]) >= RISKS.indexOf(suggested)) return null;
  const label = (risk: string) => RISK_META[risk]?.label.toLowerCase() ?? risk;
  return `Declared risk is ${label(declaredRisk)}, but ${impactedCount} downstream CIs suggest ${label(suggested)}.`;
}

// ── Plan completeness ────────────────────────────────────────────────────────

export type PlanItem = { label: string; done: boolean };

export type PlanSource = {
  reason: string | null;
  implementationPlan: string | null;
  rollbackPlan: string | null;
  plannedStart: Date | null;
  plannedEnd: Date | null;
};

const hasText = (value: string | null) => Boolean(value?.trim());

export function planCompleteness(change: PlanSource, affectedCount: number): PlanItem[] {
  return [
    { label: "Reason", done: hasText(change.reason) },
    { label: "Implementation plan", done: hasText(change.implementationPlan) },
    { label: "Rollback plan", done: hasText(change.rollbackPlan) },
    { label: "Planned window", done: change.plannedStart !== null && change.plannedEnd !== null },
    { label: "Affected CIs", done: affectedCount > 0 },
  ];
}

// ── Facts ────────────────────────────────────────────────────────────────────

export type BriefCi = { name: string; type: string };

export type BriefApprovals = {
  approved: number;
  rejected: number;
  pending: number;
  seated: number;
  required: number;
  satisfied: boolean;
  approvers: { name: string; status: string }[];
};

/** Other changes that overlap this one on shared CIs or services, and the freeze windows it falls into. */
export type BriefSchedule = { conflicts: { ref: string; title: string }[]; freezes: string[] };

export type ChangeBriefFacts = {
  ref: string;
  title: string;
  description: string;
  type: string;
  status: string;
  risk: string;
  impact: string;
  reason: string | null;
  implementationPlan: string | null;
  rollbackPlan: string | null;
  window: string;
  affected: BriefCi[];
  impactedCount: number;
  impactedSample: BriefCi[];
  plan: PlanItem[];
  schedule: BriefSchedule;
  /** Null for a standard change from a template: it is pre-authorized and has no board. */
  approvals: BriefApprovals | null;
};

/** Longest free text sent to the model; plans and descriptions beyond this add noise, not signal. */
const MAX_TEXT_CHARS = 3000;
const MAX_LISTED_CIS = 15;

const clip = (text: string) => (text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}…` : text);
const listCis = (cis: BriefCi[]) => cis.slice(0, MAX_LISTED_CIS).map((ci) => `${ci.name} (${ci.type})`).join(", ");

function scheduleLine({ conflicts, freezes }: BriefSchedule): string {
  const parts = [
    conflicts.length > 0 ? `overlaps with ${conflicts.map((c) => `${c.ref} ${c.title}`).join("; ")}` : "",
    freezes.length > 0 ? `falls inside the freeze window ${freezes.join(", ")}` : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join("; ") : "no conflicts";
}

function approvalLine(approvals: BriefApprovals | null): string {
  if (!approvals) return "pre-authorized (approved standard template, no CAB)";
  if (approvals.seated === 0) return "no approvers seated";
  return `${approvals.approved}/${approvals.required} approvals needed, ${approvals.pending} pending, ${approvals.rejected} rejected`;
}

/** The change as labelled plain text for a prompt; only facts present in the record appear. */
export function renderFacts(facts: ChangeBriefFacts): string {
  const lines = [
    `Change: ${facts.ref} ${facts.title}`,
    `Type: ${facts.type}; status: ${CHANGE_STATUS_META[facts.status]?.label ?? facts.status}; risk: ${facts.risk}; impact: ${facts.impact}`,
    `Planned window: ${facts.window}`,
    `Description: ${clip(facts.description) || "(none)"}`,
    `Reason: ${facts.reason?.trim() ? clip(facts.reason) : "(none)"}`,
    `Affected CIs (${facts.affected.length}): ${listCis(facts.affected) || "none"}`,
    `Downstream CIs reached by the impact analysis (${facts.impactedCount}): ${listCis(facts.impactedSample) || "none"}`,
    `Implementation plan: ${facts.implementationPlan?.trim() ? clip(facts.implementationPlan) : "(missing)"}`,
    `Rollback plan: ${facts.rollbackPlan?.trim() ? clip(facts.rollbackPlan) : "(missing)"}`,
    `Schedule: ${scheduleLine(facts.schedule)}`,
    `Approvals: ${approvalLine(facts.approvals)}`,
  ];
  return lines.join("\n");
}
