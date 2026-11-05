"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { updateProblemField } from "@/lib/actions/problems";
import { Combobox, type ComboOption } from "@/components/combobox";
import {
  PROBLEM_STATUSES,
  PRIORITIES,
  IMPACT_URGENCY,
  PROBLEM_STATUS_META,
  PRIORITY_META,
  LEVEL_META,
} from "@/lib/constants";
import type { FormOptions } from "@/lib/data/options";

type Field =
  | "status" | "priority" | "impact"
  | "assigneeId" | "groupId" | "categoryId";

function initials(s: string) {
  return s.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

function Prop({
  label, problemId, field, value, options, searchable, placeholder, disabled,
}: {
  label: string;
  problemId: number;
  field: Field;
  value: string | null;
  options: ComboOption[];
  searchable?: boolean;
  placeholder?: string;
  disabled?: boolean;
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
          const fd = new FormData();
          fd.set("id", String(problemId));
          fd.set("field", field);
          fd.set("value", v);
          start(async () => {
            const res = await updateProblemField(fd);
            if (res.ok) toast.success(`${label} updated`);
            else toast.error(res.error);
          });
        }}
      />
    </div>
  );
}

export function ProblemProperties({
  problem,
  options,
  allowedStatuses,
  locked,
}: {
  problem: {
    id: number;
    status: string;
    priority: string;
    impact: string;
    assigneeId: string | null;
    groupId: string | null;
    categoryId: string | null;
  };
  options: FormOptions;
  /** Statuses reachable from the current one under the workflow; others grey out. */
  allowedStatuses?: string[];
  /** A closed problem keeps status, assignee and group editable; the rest is read-only until reopened. */
  locked?: boolean;
}) {
  const allowed = allowedStatuses ? new Set(allowedStatuses) : null;
  const statusOpts: ComboOption[] = PROBLEM_STATUSES.map((s) => ({
    value: s, label: PROBLEM_STATUS_META[s].label, tone: PROBLEM_STATUS_META[s].tone, icon: PROBLEM_STATUS_META[s].icon,
    disabled: allowed ? !allowed.has(s) : false,
    disabledReason: "Not allowed from the current status by the workflow.",
  }));
  const prioOpts: ComboOption[] = PRIORITIES.map((p) => ({
    value: p, label: PRIORITY_META[p].label, tone: PRIORITY_META[p].tone, icon: PRIORITY_META[p].icon,
  }));
  const levelOpts: ComboOption[] = IMPACT_URGENCY.map((l) => ({
    value: l, label: LEVEL_META[l].label, tone: LEVEL_META[l].tone,
  }));
  const none = (label: string): ComboOption => ({ value: "none", label });
  // Assignee must be a member of the problem's group (any agent if none).
  const memberIds = problem.groupId ? new Set(options.groupMembers[problem.groupId] ?? []) : null;
  const agentOpts: ComboOption[] = [
    none("Unassigned"),
    ...options.agents
      .filter((a) => !memberIds || memberIds.has(a.id) || a.id === problem.assigneeId)
      .map((a) => ({ value: a.id, label: a.name ?? a.email, avatar: initials(a.name ?? a.email), hint: a.email })),
  ];
  const groupOpts: ComboOption[] = [none("No group"), ...options.groups.map((g) => ({ value: g.id, label: g.name }))];
  const catOpts: ComboOption[] = [none("No category"), ...options.categories.map((c) => ({ value: c.id, label: c.name }))];

  return (
    <div className="grid gap-3">
      <Prop label="Status" problemId={problem.id} field="status" value={problem.status} options={statusOpts} />
      <Prop label="Priority" problemId={problem.id} field="priority" value={problem.priority} options={prioOpts} disabled={locked} />
      <Prop label="Impact" problemId={problem.id} field="impact" value={problem.impact} options={levelOpts} disabled={locked} />
      <Prop label="Assignee" problemId={problem.id} field="assigneeId" value={problem.assigneeId} options={agentOpts} searchable placeholder="Unassigned" />
      <Prop label="Group" problemId={problem.id} field="groupId" value={problem.groupId} options={groupOpts} searchable placeholder="No group" />
      <Prop label="Category" problemId={problem.id} field="categoryId" value={problem.categoryId} options={catOpts} searchable placeholder="No category" disabled={locked} />
      {locked ? <p className="text-xs text-muted-foreground">Closed. Reopen the problem to edit priority, impact and category.</p> : null}
    </div>
  );
}
