import type { ChangeTabKey } from "@/components/changes/tabs/change-tabs";

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

const PLANNING = { key: "planning", label: "Open Planning" } as const;
const CAB = { key: "cab", label: "Open CAB & approvals" } as const;

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

function draftStep({ type, preAuthorized, submitBlockers, freezeNames }: NextStepInput): NextStep {
  if (submitBlockers.length > 0) {
    return { title: "Complete the plan to submit", detail: `Still missing: ${submitBlockers.join(", ")}.`, tab: PLANNING };
  }
  if (freezeNames.length > 0 && type !== "EMERGENCY") {
    return {
      title: "Move the planned window out of the freeze",
      detail: `It falls inside ${freezeNames.join(", ")}, so submitting is refused. Choose another window, or raise an emergency change.`,
      tab: PLANNING,
    };
  }
  if (preAuthorized) {
    return {
      title: "Ready to submit",
      detail: "This standard change follows its approved template: submitting moves it straight to Approved.",
    };
  }
  return {
    title: "Ready to submit for approval",
    detail: "Submitting asks the CAB to decide. Approvers are picked by type and risk; you can seat some yourself first.",
    tab: CAB,
  };
}

function approvalStep({ seatedApprovers, pendingApprovals }: NextStepInput): NextStep {
  if (seatedApprovers === 0) {
    return { title: "Seat approvers", detail: "Nobody can decide this change yet. Add approvers to the CAB.", tab: CAB };
  }
  return {
    title: `Waiting for ${plural(pendingApprovals, "approver")}`,
    detail: "The CAB decides by its rule. Approvers record their decision in CAB & approvals.",
    tab: CAB,
  };
}

/** What happens after the status moves on; each entry is the next manual move on the Status field. */
const STATUS_STEPS: Record<string, NextStep> = {
  APPROVED: {
    title: "Approved: schedule or start it",
    detail: "Confirm the planned window, then set the status to Scheduled, or to In progress when the work begins.",
  },
  SCHEDULED: {
    title: "Scheduled",
    detail: "Set the status to In progress when the work starts. Moving the window now needs a reason.",
  },
  IN_PROGRESS: {
    title: "Implementation under way",
    detail: "When the work is done, set the status to Review, or to Failed if it went wrong.",
  },
  REVIEW: {
    title: "Post-implementation review",
    detail: "Close the change and record its outcome and review notes.",
  },
  FAILED: {
    title: "Implementation failed",
    detail: "Record what happened by moving the change to Review or Closed.",
  },
  REJECTED: {
    title: "Rejected by the CAB",
    detail: "Revise the plan and set the status back to Draft to submit it again.",
    tab: PLANNING,
  },
};

/** The next move on a change, or null once it is closed or cancelled. */
export function changeNextStep(input: NextStepInput): NextStep | null {
  if (input.status === "DRAFT") return draftStep(input);
  if (input.status === "APPROVAL") return approvalStep(input);
  return STATUS_STEPS[input.status] ?? null;
}
