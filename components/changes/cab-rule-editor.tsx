"use client";

import { useState, useTransition } from "react";
import { SlidersHorizontal, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { setCabRule } from "@/lib/actions/changes";
import { Combobox, type ComboOption } from "@/components/combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CAB_APPROVAL_RULE_META, CAB_APPROVAL_RULES } from "@/lib/constants";
import { useEnumT, useServerMessage, useT } from "@/lib/i18n/client";

/**
 * Manager control for the CAB decision rule. UNANIMOUS needs no threshold;
 * QUORUM takes a minimum approver count; PERCENT takes a 1–100 percentage.
 */
export function CabRuleEditor({
  changeId,
  rule: initialRule,
  threshold: initialThreshold,
  seated,
}: {
  changeId: number;
  rule: string;
  threshold: number | null;
  seated: number;
}) {
  const [rule, setRule] = useState(initialRule);
  const [threshold, setThreshold] = useState(initialThreshold != null ? String(initialThreshold) : "");
  const [pending, start] = useTransition();
  const t = useT("changes");
  const tc = useT("common");
  const te = useEnumT();
  const tm = useServerMessage();
  const RULE_OPTIONS: ComboOption[] = CAB_APPROVAL_RULES.map((r) => ({ value: r, label: te(CAB_APPROVAL_RULE_META, r) }));

  const needsThreshold = rule === "QUORUM" || rule === "PERCENT";
  const dirty = rule !== initialRule || (needsThreshold && String(initialThreshold ?? "") !== threshold);

  const save = () => {
    const fd = new FormData();
    fd.set("changeId", String(changeId));
    fd.set("rule", rule);
    if (needsThreshold && threshold.trim() !== "") fd.set("threshold", threshold.trim());
    start(async () => {
      const result = await setCabRule(fd);
      if (result.ok) toast.success(t("cabRule.updated"));
      else toast.error(tm(result.error));
    });
  };

  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <SlidersHorizontal className="size-3.5" /> {t("cabRule.decisionRule")}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Combobox
          options={RULE_OPTIONS}
          value={rule}
          onChange={(v) => setRule(v || "UNANIMOUS")}
          className="w-44"
          size="sm"
          searchPlaceholder={t("cabRule.searchRules")}
        />
        {needsThreshold ? (
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              min={1}
              max={rule === "PERCENT" ? 100 : seated || undefined}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder={rule === "PERCENT" ? "%" : "N"}
              className="h-8 w-20"
            />
            <span className="text-xs text-muted-foreground">
              {rule === "PERCENT" ? t("cabRule.percentSuffix") : t("cabRule.approvalsSuffix")}
            </span>
          </div>
        ) : null}
        <Button size="sm" variant="outline" disabled={pending || !dirty} onClick={save}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : null} {tc("save")}
        </Button>
      </div>
    </div>
  );
}
