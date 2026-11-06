"use client";

import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-dialog";
import { SableMark } from "@/components/sable-mark";
import { draftChangePlan, type ChangeDraft } from "@/lib/actions/change-copilot";
import { updateChangeText } from "@/lib/actions/changes";
import { AI_TEASER_MESSAGE } from "@/lib/constants";

type TextField = "reason" | "implementationPlan" | "rollbackPlan";

type Current = Record<TextField, string | null>;

type DraftField = {
  key: keyof ChangeDraft;
  label: string;
  /** The change field the draft is applied to. */
  target: TextField;
  applyLabel: string;
  /** Where the applied text ends up, when that is not obvious from the label. */
  appliesTo?: string;
};

const DRAFT_FIELDS: DraftField[] = [
  { key: "implementationPlan", label: "Implementation plan", target: "implementationPlan", applyLabel: "Apply" },
  { key: "rollbackPlan", label: "Rollback plan", target: "rollbackPlan", applyLabel: "Apply" },
  { key: "riskRationale", label: "Risk rationale", target: "reason", applyLabel: "Add to reason", appliesTo: "Added to the end of the reason for change (Overview tab)." },
];

/** What the target field holds once the draft is applied: plans replace, the rationale is appended to the reason. */
function valueToApply(field: DraftField, draft: string, current: Current): string {
  if (field.key !== "riskRationale") return draft;
  return [current.reason?.trim(), `Risk assessment: ${draft}`].filter(Boolean).join("\n\n");
}

export function ChangeCopilotPanel({
  changeId,
  current,
  teaser,
}: {
  changeId: number;
  current: Current;
  teaser: boolean;
}) {
  const [draft, setDraft] = useState<ChangeDraft | null>(null);
  const [applied, setApplied] = useState<ReadonlySet<keyof ChangeDraft>>(new Set());
  const [pending, startTransition] = useTransition();

  function generate() {
    if (teaser) return void toast.info(AI_TEASER_MESSAGE);
    startTransition(async () => {
      const result = await draftChangePlan(changeId);
      if (!result.ok) return void toast.error(result.error);
      setDraft(result.draft);
      setApplied(new Set());
    });
  }

  async function apply(field: DraftField, value: string) {
    const formData = new FormData();
    formData.set("id", String(changeId));
    formData.set("field", field.target);
    formData.set("value", value);
    const result = await updateChangeText(formData);
    if (result.ok) setApplied((done) => new Set(done).add(field.key));
    return result;
  }

  async function applyAndReport(field: DraftField, value: string) {
    const result = await apply(field, value);
    if (result.ok) toast.success(`${field.label} updated`);
    else toast.error(result.error);
  }

  return (
    <section className="rounded-xl border border-sable/25 bg-sable-muted/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <SableMark className="size-4" />
        <h3 className="flex-1 text-sm font-medium">Sable copilot</h3>
        <Button type="button" variant="outline" size="sm" onClick={generate} disabled={pending}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {draft ? "Draft again" : "Draft plans"}
        </Button>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {draft
          ? "AI-generated draft: check it against what you know before applying. Nothing is saved until you click Apply."
          : pending
            ? "Drafting from the change and its affected CIs. This can take up to a minute."
            : "Drafts an implementation plan, a rollback plan and a risk rationale from the affected CIs and their impact. Nothing is saved until you apply it."}
      </p>

      {draft ? (
        <div className="mt-3 grid gap-3">
          {DRAFT_FIELDS.map((field) => {
            const text = draft[field.key];
            const value = valueToApply(field, text, current);
            const replaces = field.key !== "riskRationale" && Boolean(current[field.target]?.trim());
            return (
              <div key={field.key} className="rounded-lg border bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{field.label}</h4>
                  {applied.has(field.key) ? (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Check className="size-3.5" /> Applied
                    </span>
                  ) : replaces ? (
                    <ConfirmButton
                      action={() => apply(field, value)}
                      title={`Replace the ${field.label.toLowerCase()}?`}
                      description="The current text is overwritten with this draft."
                      confirmLabel="Replace"
                      confirmVariant="default"
                      triggerVariant="outline"
                      triggerSize="xs"
                      successMessage={`${field.label} updated`}
                    >
                      {field.applyLabel}
                    </ConfirmButton>
                  ) : (
                    <Button type="button" variant="outline" size="xs" onClick={() => applyAndReport(field, value)}>
                      {field.applyLabel}
                    </Button>
                  )}
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
                {field.appliesTo ? <p className="mt-1.5 text-xs text-muted-foreground">{field.appliesTo}</p> : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
