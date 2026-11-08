import type { ChangeTabKey } from "@/components/changes/tabs/change-tabs";
import { createTranslator, type Translator } from "@/lib/i18n/translate";

export type NextStep = {
  title: string;
  detail: string;
  /** The tab where the step is done, when there is one. */
  tab?: { key: ChangeTabKey; label: string };
};

export type NextStepInput = {
  status: string;
  type: string;
  /** Created from an approved standard template: submitting skips the CAB. */
  preAuthorized: boolean;
  /** What a draft still lacks before it can be submitted (see submitBlockers). */
  submitBlockers: readonly string[];
  /** Change freezes the planned window falls inside; they refuse a submit unless the change is an emergency. */
  freezeNames: readonly string[];
  /** CAB seats filled, and how many of them have not decided. */
  seatedApprovers: number;
  pendingApprovals: number;
};

type T = Translator<"changes">;
const EN = createTranslator("en", "changes");

const planningTab = (t: T) => ({ key: "planning", label: t("nextStep.openPlanning") }) as const;
const cabTab = (t: T) => ({ key: "cab", label: t("nextStep.openCab") }) as const;

function draftStep({ type, preAuthorized, submitBlockers, freezeNames }: NextStepInput, t: T): NextStep {
  if (submitBlockers.length > 0) {
    return {
      title: t("nextStep.completePlan"),
      detail: t("nextStep.completePlanDetail", { items: submitBlockers.join(", ") }),
      tab: planningTab(t),
    };
  }
  if (freezeNames.length > 0 && type !== "EMERGENCY") {
    return {
      title: t("nextStep.leaveFreeze"),
      detail: t("nextStep.leaveFreezeDetail", { freezes: freezeNames.join(", ") }),
      tab: planningTab(t),
    };
  }
  if (preAuthorized) {
    return { title: t("nextStep.readyToSubmit"), detail: t("nextStep.readyToSubmitDetail") };
  }
  return { title: t("nextStep.readyForApproval"), detail: t("nextStep.readyForApprovalDetail"), tab: cabTab(t) };
}

function approvalStep({ seatedApprovers, pendingApprovals }: NextStepInput, t: T): NextStep {
  if (seatedApprovers === 0) {
    return { title: t("nextStep.seatApprovers"), detail: t("nextStep.seatApproversDetail"), tab: cabTab(t) };
  }
  return {
    title: t("nextStep.waiting", { count: pendingApprovals }),
    detail: t("nextStep.waitingDetail"),
    tab: cabTab(t),
  };
}

/** Statuses after the approval; each has a next manual move on the Status field. */
const STATUS_STEPS = ["APPROVED", "SCHEDULED", "IN_PROGRESS", "REVIEW", "FAILED", "REJECTED"] as const;
type StepStatus = (typeof STATUS_STEPS)[number];

function statusStep(status: StepStatus, t: T): NextStep {
  return {
    title: t(`nextStep.${status}.title`),
    detail: t(`nextStep.${status}.detail`),
    ...(status === "REJECTED" ? { tab: planningTab(t) } : {}),
  };
}

/** The next move on a change, or null once it is closed or cancelled. Text in `t`'s language (default English). */
export function changeNextStep(input: NextStepInput, t: T = EN): NextStep | null {
  if (input.status === "DRAFT") return draftStep(input, t);
  if (input.status === "APPROVAL") return approvalStep(input, t);
  return (STATUS_STEPS as readonly string[]).includes(input.status) ? statusStep(input.status as StepStatus, t) : null;
}
