"use client";

import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-dialog";
import { SableMark } from "@/components/sable-mark";
import { draftChangePlan, type ChangeDraft } from "@/lib/actions/change-copilot";
import { updateChangeText } from "@/lib/actions/changes";
import { AI_ASSISTANT_NAME } from "@/lib/constants";
import { useServerMessage, useT } from "@/lib/i18n/client";
import type { Translator } from "@/lib/i18n/translate";

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

const draftFields = (t: Translator<"changes">): DraftField[] => [
  { key: "implementationPlan", label: t("planning.implementationPlan"), target: "implementationPlan", applyLabel: t("copilot.apply") },
  { key: "rollbackPlan", label: t("planning.rollbackPlan"), target: "rollbackPlan", applyLabel: t("copilot.apply") },
  { key: "riskRationale", label: t("copilot.riskRationale"), target: "reason", applyLabel: t("copilot.addToReason"), appliesTo: t("copilot.appliesToReason") },
];

/** What the target field holds once the draft is applied: plans replace, the rationale is appended to the reason. */
function valueToApply(field: DraftField, draft: string, current: Current, t: Translator<"changes">): string {
  if (field.key !== "riskRationale") return draft;
  return [current.reason?.trim(), t("copilot.riskAssessmentPrefix", { text: draft })].filter(Boolean).join("\n\n");
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
  const t = useT("changes");
  const tm = useServerMessage();
  const DRAFT_FIELDS = draftFields(t);

  function generate() {
    if (teaser) return void toast.info(t("aiTeaser"));
    startTransition(async () => {
      const result = await draftChangePlan(changeId);
      if (!result.ok) return void toast.error(tm(result.error));
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
    if (result.ok) toast.success(t("props.updated", { field: field.label }));
    else toast.error(tm(result.error));
  }

  return (
    <section className="rounded-xl border border-sable/25 bg-sable-muted/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <SableMark className="size-4" />
        <h3 className="flex-1 text-sm font-medium">{t("copilot.title", { name: AI_ASSISTANT_NAME })}</h3>
        <Button type="button" variant="outline" size="sm" onClick={generate} disabled={pending}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {draft ? t("copilot.draftAgain") : t("copilot.draft")}
        </Button>
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        {draft
          ? t("copilot.draftHint")
          : pending
            ? t("copilot.drafting")
            : t("copilot.intro")}
      </p>

      {draft ? (
        <div className="mt-3 grid gap-3">
          {DRAFT_FIELDS.map((field) => {
            const text = draft[field.key];
            const value = valueToApply(field, text, current, t);
            const replaces = field.key !== "riskRationale" && Boolean(current[field.target]?.trim());
            return (
              <div key={field.key} className="rounded-lg border bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{field.label}</h4>
                  {applied.has(field.key) ? (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Check className="size-3.5" /> {t("copilot.applied")}
                    </span>
                  ) : replaces ? (
                    <ConfirmButton
                      action={() => apply(field, value)}
                      title={t("copilot.replaceTitle", { field: field.label })}
                      description={t("copilot.replaceDescription")}
                      confirmLabel={t("copilot.replace")}
                      confirmVariant="default"
                      triggerVariant="outline"
                      triggerSize="xs"
                      successMessage={t("props.updated", { field: field.label })}
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
