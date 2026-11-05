"use client";

import { useState, useTransition } from "react";
import { SlidersHorizontal, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { setCabRule } from "@/lib/actions/changes";
import { Combobox, type ComboOption } from "@/components/combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CAB_APPROVAL_RULE_META, CAB_APPROVAL_RULES } from "@/lib/constants";

const RULE_OPTIONS: ComboOption[] = CAB_APPROVAL_RULES.map((r) => ({
  value: r,
  label: CAB_APPROVAL_RULE_META[r]?.label ?? r,
}));

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

  const needsThreshold = rule === "QUORUM" || rule === "PERCENT";
  const dirty = rule !== initialRule || (needsThreshold && String(initialThreshold ?? "") !== threshold);

  const save = () => {
    const fd = new FormData();
    fd.set("changeId", String(changeId));
    fd.set("rule", rule);
    if (needsThreshold && threshold.trim() !== "") fd.set("threshold", threshold.trim());
    start(async () => {
      const result = await setCabRule(fd);
      if (result.ok) toast.success("CAB rule updated");
      else toast.error(result.error);
    });
  };

  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <SlidersHorizontal className="size-3.5" /> Decision rule
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Combobox
          options={RULE_OPTIONS}
          value={rule}
          onChange={(v) => setRule(v || "UNANIMOUS")}
          className="w-44"
          size="sm"
          searchPlaceholder="Search rules…"
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
              {rule === "PERCENT" ? "% of seats" : "approvals"}
            </span>
          </div>
        ) : null}
        <Button size="sm" variant="outline" disabled={pending || !dirty} onClick={save}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : null} Save
        </Button>
      </div>
    </div>
  );
}
