"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateChangeField } from "@/lib/actions/changes";
import { isClosureStatus, manualStatusError } from "@/lib/change-rules";
import { CancelChangeDialog } from "@/components/changes/cancel-change";
import { ClosureDialog } from "@/components/changes/closure-dialog";
import { Combobox, type ComboOption } from "@/components/combobox";
import {
  CHANGE_STATUSES,
  CHANGE_TYPES,
  IMPACT_URGENCY,
  RISKS,
  PRIORITIES,
  CHANGE_STATUS_META,
  CHANGE_TYPE_META,
  LEVEL_META,
  RISK_META,
  PRIORITY_META,
} from "@/lib/constants";
import type { FormOptions } from "@/lib/data/options";

type Field = "status" | "type" | "risk" | "impact" | "priority" | "assigneeId" | "groupId" | "categoryId";

function initials(s: string) {
  return s.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

function Prop({
  label, changeId, field, value, options, searchable, placeholder, disabled, intercept,
}: {
  label: string;
  changeId: number;
  field: Field;
  value: string | null;
  options: ComboOption[];
  searchable?: boolean;
  placeholder?: string;
  disabled?: boolean;
  /** Handles the choice itself (e.g. opens a dialog) and returns true when it did. */
  intercept?: (value: string) => boolean;
}) {
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Combobox
        options={options}
        value={value ?? "none"}
        pending={pending}
        disabled={disabled}
        placeholder={placeholder}
        searchPlaceholder={searchable ? `Search ${label.toLowerCase()}…` : "Filter…"}
        onChange={(v) => {
          if (intercept?.(v)) return;
          const fd = new FormData();
          fd.set("id", String(changeId));
          fd.set("field", field);
          fd.set("value", v);
          start(async () => {
            const res = await updateChangeField(fd);
            if (res.ok) toast.success(`${label} updated`);
            else toast.error(res.error);
          });
        }}
      />
    </div>
  );
}

export function ChangeProperties({
  change,
  options,
  allowedStatuses,
  locked,
}: {
  change: {
    id: number;
    status: string;
    type: string;
    risk: string;
    impact: string;
    priority: string;
    assigneeId: string | null;
    groupId: string | null;
    categoryId: string | null;
    outcome: string | null;
    closureNotes: string | null;
  };
  options: FormOptions;
  /** Statuses reachable from the current one under the workflow; others grey out. */
  allowedStatuses?: string[];
  /** A closed or cancelled change is read-only. */
  locked: boolean;
}) {
  // Closing, failing and cancelling need details first, so the picker opens a dialog instead of saving.
  const [closingTo, setClosingTo] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const interceptStatus = (to: string) => {
    if (to === change.status) return true;
    if (to === "CANCELLED") setCancelOpen(true);
    else if (isClosureStatus(to)) setClosingTo(to);
    else return false;
    return true;
  };

  const allowed = allowedStatuses ? new Set(allowedStatuses) : null;
  const statusOpts: ComboOption[] = CHANGE_STATUSES.map((s) => {
    const approvalFlowReason = s === change.status ? null : manualStatusError(s);
    return {
      value: s, label: CHANGE_STATUS_META[s].label, tone: CHANGE_STATUS_META[s].tone, icon: CHANGE_STATUS_META[s].icon,
      disabled: !!approvalFlowReason || (allowed ? !allowed.has(s) : false),
      disabledReason: approvalFlowReason ?? "Not allowed from the current status by the workflow.",
    };
  });
  const typeOpts: ComboOption[] = CHANGE_TYPES.map((t) => ({
    value: t, label: CHANGE_TYPE_META[t].label, tone: CHANGE_TYPE_META[t].tone, icon: CHANGE_TYPE_META[t].icon,
  }));
  const riskOpts: ComboOption[] = RISKS.map((r) => ({
    value: r, label: RISK_META[r].label, tone: RISK_META[r].tone, icon: RISK_META[r].icon,
  }));
  const impactOpts: ComboOption[] = IMPACT_URGENCY.map((l) => ({
    value: l, label: LEVEL_META[l].label, tone: LEVEL_META[l].tone, icon: LEVEL_META[l].icon,
  }));
  const prioOpts: ComboOption[] = PRIORITIES.map((p) => ({
    value: p, label: PRIORITY_META[p].label, tone: PRIORITY_META[p].tone, icon: PRIORITY_META[p].icon,
  }));
  const none = (label: string): ComboOption => ({ value: "none", label });
  // Assignee must be a member of the change's group (any agent if none).
  const memberIds = change.groupId ? new Set(options.groupMembers[change.groupId] ?? []) : null;
  const agentOpts: ComboOption[] = [
    none("Unassigned"),
    ...options.agents
      .filter((a) => !memberIds || memberIds.has(a.id) || a.id === change.assigneeId)
      .map((a) => ({ value: a.id, label: a.name ?? a.email, avatar: initials(a.name ?? a.email), hint: a.email })),
  ];
  const groupOpts: ComboOption[] = [none("No group"), ...options.groups.map((g) => ({ value: g.id, label: g.name }))];
  const catOpts: ComboOption[] = [none("No category"), ...options.categories.map((c) => ({ value: c.id, label: c.name }))];

  return (
    <div className="grid gap-3">
      <Prop label="Status" changeId={change.id} field="status" value={change.status} options={statusOpts} disabled={locked} intercept={interceptStatus} />
      <div className="grid grid-cols-2 gap-3">
        <Prop label="Type" changeId={change.id} field="type" value={change.type} options={typeOpts} disabled={locked} />
        <Prop label="Priority" changeId={change.id} field="priority" value={change.priority} options={prioOpts} disabled={locked} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Prop label="Risk" changeId={change.id} field="risk" value={change.risk} options={riskOpts} disabled={locked} />
        <Prop label="Impact" changeId={change.id} field="impact" value={change.impact} options={impactOpts} disabled={locked} />
      </div>
      <Prop label="Assignee" changeId={change.id} field="assigneeId" value={change.assigneeId} options={agentOpts} searchable placeholder="Unassigned" disabled={locked} />
      <Prop label="Group" changeId={change.id} field="groupId" value={change.groupId} options={groupOpts} searchable placeholder="No group" disabled={locked} />
      <Prop label="Category" changeId={change.id} field="categoryId" value={change.categoryId} options={catOpts} searchable placeholder="No category" disabled={locked} />

      {closingTo ? (
        <ClosureDialog
          changeId={change.id}
          changeType={change.type}
          toStatus={closingTo}
          initialOutcome={change.outcome}
          initialNotes={change.closureNotes}
          open
          onOpenChange={(open) => { if (!open) setClosingTo(null); }}
        />
      ) : null}
      <CancelChangeDialog changeId={change.id} open={cancelOpen} onOpenChange={setCancelOpen} />
    </div>
  );
}
