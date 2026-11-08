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
import { useEnumT, useServerMessage, useT } from "@/lib/i18n/client";

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
  const t = useT("problems");
  const tm = useServerMessage();
  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Combobox
        options={options}
        value={value ?? "none"}
        pending={pending}
        disabled={disabled}
        placeholder={placeholder}
        searchPlaceholder={searchable ? t("props.searchField", { field: label }) : t("props.filter")}
        onChange={(v) => {
          const fd = new FormData();
          fd.set("id", String(problemId));
          fd.set("field", field);
          fd.set("value", v);
          start(async () => {
            const res = await updateProblemField(fd);
            if (res.ok) toast.success(t("props.updated", { field: label }));
            else toast.error(tm(res.error));
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
  const t = useT("problems");
  const tc = useT("common");
  const te = useEnumT();
  const statusOpts: ComboOption[] = PROBLEM_STATUSES.map((s) => ({
    value: s, label: te(PROBLEM_STATUS_META[s]), tone: PROBLEM_STATUS_META[s].tone, icon: PROBLEM_STATUS_META[s].icon,
    disabled: allowed ? !allowed.has(s) : false,
    disabledReason: t("props.notAllowed"),
  }));
  const prioOpts: ComboOption[] = PRIORITIES.map((p) => ({
    value: p, label: te(PRIORITY_META[p]), tone: PRIORITY_META[p].tone, icon: PRIORITY_META[p].icon,
  }));
  const levelOpts: ComboOption[] = IMPACT_URGENCY.map((l) => ({
    value: l, label: te(LEVEL_META[l]), tone: LEVEL_META[l].tone,
  }));
  const none = (label: string): ComboOption => ({ value: "none", label });
  // Assignee must be a member of the problem's group (any agent if none).
  const memberIds = problem.groupId ? new Set(options.groupMembers[problem.groupId] ?? []) : null;
  const agentOpts: ComboOption[] = [
    none(tc("unassigned")),
    ...options.agents
      .filter((a) => !memberIds || memberIds.has(a.id) || a.id === problem.assigneeId)
      .map((a) => ({ value: a.id, label: a.name ?? a.email, avatar: initials(a.name ?? a.email), hint: a.email })),
  ];
  const groupOpts: ComboOption[] = [none(t("noGroup")), ...options.groups.map((g) => ({ value: g.id, label: g.name }))];
  const catOpts: ComboOption[] = [none(t("noCategory")), ...options.categories.map((c) => ({ value: c.id, label: c.name }))];

  return (
    <div className="grid gap-3">
      <Prop label={tc("status")} problemId={problem.id} field="status" value={problem.status} options={statusOpts} />
      <Prop label={tc("priority")} problemId={problem.id} field="priority" value={problem.priority} options={prioOpts} disabled={locked} />
      <Prop label={tc("impact")} problemId={problem.id} field="impact" value={problem.impact} options={levelOpts} disabled={locked} />
      <Prop label={tc("assignee")} problemId={problem.id} field="assigneeId" value={problem.assigneeId} options={agentOpts} searchable placeholder={tc("unassigned")} />
      <Prop label={tc("group")} problemId={problem.id} field="groupId" value={problem.groupId} options={groupOpts} searchable placeholder={t("noGroup")} />
      <Prop label={tc("category")} problemId={problem.id} field="categoryId" value={problem.categoryId} options={catOpts} searchable placeholder={t("noCategory")} disabled={locked} />
      {locked ? <p className="text-xs text-muted-foreground">{t("props.lockedHint")}</p> : null}
    </div>
  );
}
