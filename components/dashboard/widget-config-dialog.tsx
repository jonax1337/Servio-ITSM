"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Combobox, type ComboOption } from "@/components/combobox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  TICKET_STATUSES, PRIORITIES, TICKET_TYPES, IMPACT_URGENCY, TICKET_SOURCES,
  TICKET_STATUS_META, PRIORITY_META, TICKET_TYPE_META, LEVEL_META, SOURCE_META,
} from "@/lib/constants";
import { Plus, Trash2 } from "lucide-react";
import { WIDGET_LABELS, type Widget, type WidgetType, type TicketFilters, type BreakdownField, type Tone, type Threshold } from "@/lib/dashboard/types";

const ACCENT_OPTS: ComboOption[] = [
  { value: "", label: "No accent" },
  { value: "primary", label: "Primary" },
  { value: "success", label: "Green" },
  { value: "warning", label: "Amber" },
  { value: "danger", label: "Red" },
  { value: "info", label: "Blue" },
  { value: "neutral", label: "Grey" },
];
const TONE_OPTS: ComboOption[] = ACCENT_OPTS.slice(1);
const OP_OPTS: ComboOption[] = [
  { value: "lt", label: "< less than" },
  { value: "lte", label: "≤ at most" },
  { value: "gt", label: "> greater than" },
  { value: "gte", label: "≥ at least" },
  { value: "eq", label: "= equals" },
];

export type EditorOptions = {
  agents: { value: string; label: string }[];
  groups: { value: string; label: string }[];
  categories: { value: string; label: string }[];
  services: { value: string; label: string }[];
};

const DEFAULT_SIZE: Record<WidgetType, { w: number; h: number }> = {
  stat: { w: 3, h: 1 },
  sla: { w: 4, h: 1 },
  csat: { w: 3, h: 1 },
  breakdown: { w: 4, h: 2 },
  volume: { w: 8, h: 2 },
  aging: { w: 6, h: 2 },
  list: { w: 12, h: 2 },
  briefing: { w: 6, h: 3 },
};

const TYPE_OPTS: ComboOption[] = (Object.keys(WIDGET_LABELS) as WidgetType[]).map((t) => ({
  value: t,
  label: WIDGET_LABELS[t],
}));

const GROUPBY_LABELS: Record<BreakdownField, string> = {
  priority: "Priority",
  status: "Status",
  type: "Type",
  assignee: "Assignee",
  group: "Team",
  category: "Category",
  service: "Service",
  source: "Source",
  impact: "Impact",
  urgency: "Urgency",
};
const GROUPBY_OPTS: ComboOption[] = (Object.keys(GROUPBY_LABELS) as BreakdownField[]).map((g) => ({
  value: g,
  label: GROUPBY_LABELS[g],
}));

const DAYS_OPTS: ComboOption[] = [
  { value: "7", label: "Last 7 days" },
  { value: "14", label: "Last 14 days" },
  { value: "30", label: "Last 30 days" },
];

function newId() {
  return `w-${Math.random().toString(36).slice(2, 9)}`;
}

/** Add or edit a single widget. Returns the widget to the parent on save. */
export function WidgetConfigDialog({
  open,
  onOpenChange,
  initial,
  options,
  onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: Widget | null;
  options: EditorOptions;
  onSave: (w: Widget) => void;
}) {
  const [type, setType] = useState<WidgetType>("stat");
  const [title, setTitle] = useState("");
  const [groupBy, setGroupBy] = useState<BreakdownField>("priority");
  const [chartType, setChartType] = useState<"bar" | "donut">("bar");
  const [accent, setAccent] = useState<string>("");
  const [thresholds, setThresholds] = useState<Threshold[]>([]);
  const [filters, setFilters] = useState<TicketFilters>({});

  // Re-seed the form whenever the dialog opens for a new/different widget.
  useEffect(() => {
    if (!open) return;
    // intentional: re-seed the editable form fields from the incoming widget
    // whenever the dialog opens for a new/different widget.
    /* eslint-disable react-hooks/set-state-in-effect */
    setType(initial?.type ?? "stat");
    setTitle(initial?.title ?? "");
    setGroupBy((initial?.options?.groupBy as BreakdownField) ?? "priority");
    setChartType((initial?.options?.chartType as "bar" | "donut") ?? "bar");
    setAccent(initial?.options?.accent ?? "");
    setThresholds(initial?.options?.thresholds ?? []);
    setFilters(initial?.filters ?? {});
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, initial]);

  const addThreshold = () =>
    setThresholds((t) => [...t, { op: "lt", value: 0, tone: "danger" } as Threshold].slice(0, 5));
  const updateThreshold = (i: number, patch: Partial<Threshold>) =>
    setThresholds((t) => t.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const removeThreshold = (i: number) => setThresholds((t) => t.filter((_, j) => j !== i));

  const setF = (k: keyof TicketFilters, v: string) =>
    setFilters((f) => {
      const next = { ...f };
      if (!v) delete next[k];
      else next[k] = v;
      return next;
    });

  const statusOpts: ComboOption[] = [
    { value: "", label: "Any status" },
    { value: "open", label: "Open (active)" },
    ...TICKET_STATUSES.map((s) => ({ value: s, label: TICKET_STATUS_META[s].label })),
  ];
  const prioOpts: ComboOption[] = [{ value: "", label: "Any priority" }, ...PRIORITIES.map((p) => ({ value: p, label: PRIORITY_META[p].label }))];
  const typeOpts: ComboOption[] = [{ value: "", label: "Any type" }, ...TICKET_TYPES.map((t) => ({ value: t, label: TICKET_TYPE_META[t].label }))];
  const teamOpts: ComboOption[] = [{ value: "", label: "Any team" }, ...options.groups];
  const agentOpts: ComboOption[] = [{ value: "", label: "Any assignee" }, { value: "unassigned", label: "Unassigned" }, ...options.agents];
  const catOpts: ComboOption[] = [{ value: "", label: "Any category" }, ...options.categories];
  const svcOpts: ComboOption[] = [{ value: "", label: "Any service" }, ...options.services];
  const impactOpts: ComboOption[] = [{ value: "", label: "Any impact" }, ...IMPACT_URGENCY.map((l) => ({ value: l, label: LEVEL_META[l].label }))];
  const urgencyOpts: ComboOption[] = [{ value: "", label: "Any urgency" }, ...IMPACT_URGENCY.map((l) => ({ value: l, label: LEVEL_META[l].label }))];
  const sourceOpts: ComboOption[] = [{ value: "", label: "Any source" }, ...TICKET_SOURCES.map((s) => ({ value: s, label: SOURCE_META[s]?.label ?? s }))];
  const yesAny = (any: string): ComboOption[] => [{ value: "", label: any }, { value: "true", label: "Yes" }];

  const isTimeBased = type === "volume" || type === "sla";

  function save() {
    const size = initial ? { w: initial.w, h: initial.h } : DEFAULT_SIZE[type];
    const options: NonNullable<Widget["options"]> = {};
    if (type === "breakdown") {
      options.groupBy = groupBy;
      options.chartType = chartType;
    }
    if (accent) options.accent = accent as Tone;
    if (type === "stat" && thresholds.length) options.thresholds = thresholds;
    const widget: Widget = {
      id: initial?.id ?? newId(),
      type,
      title: title.trim() || WIDGET_LABELS[type],
      filters: type === "briefing" ? {} : filters,
      x: initial?.x ?? 0,
      y: initial?.y ?? Infinity, // Infinity → RGL drops it at the bottom
      w: size.w,
      h: size.h,
      options: Object.keys(options).length ? options : undefined,
    };
    onSave(widget);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit widget" : "Add widget"}</DialogTitle>
          <DialogDescription>Pick a metric, give it a title, and scope it with filters.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Type</Label>
              <Combobox options={TYPE_OPTS} value={type} onChange={(v) => setType((v as WidgetType) || "stat")} />
            </div>
            {type === "breakdown" ? (
              <div className="grid gap-1.5">
                <Label>Group by</Label>
                <Combobox options={GROUPBY_OPTS} value={groupBy} onChange={(v) => setGroupBy((v as BreakdownField) || "priority")} />
              </div>
            ) : isTimeBased ? (
              <div className="grid gap-1.5">
                <Label>Range</Label>
                <Combobox options={DAYS_OPTS} value={filters.days ?? "14"} onChange={(v) => setF("days", v || "14")} />
              </div>
            ) : (
              <div />
            )}
          </div>

          {type === "breakdown" ? (
            <div className="grid gap-1.5">
              <Label>Chart type</Label>
              <Combobox
                options={[{ value: "bar", label: "Bar" }, { value: "donut", label: "Donut" }]}
                value={chartType}
                onChange={(v) => setChartType((v as "bar" | "donut") || "bar")}
              />
            </div>
          ) : null}

          <div className="grid gap-1.5">
            <Label htmlFor="w-title">Title</Label>
            <Input id="w-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={WIDGET_LABELS[type]} />
          </div>

          <div className="grid gap-1.5">
            <Label>Accent colour</Label>
            <Combobox options={ACCENT_OPTS} value={accent} onChange={setAccent} />
          </div>

          {type === "stat" ? (
            <div className="grid gap-2 rounded-lg border p-2.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Colour thresholds (first match wins)</Label>
                <Button type="button" variant="ghost" size="xs" onClick={addThreshold} disabled={thresholds.length >= 5}>
                  <Plus className="size-3.5" /> Add
                </Button>
              </div>
              {thresholds.length === 0 ? (
                <p className="text-xs text-muted-foreground">No thresholds — the card uses the accent colour.</p>
              ) : null}
              {thresholds.map((t, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="shrink-0 text-xs text-muted-foreground">value</span>
                  <Combobox options={OP_OPTS} value={t.op} onChange={(v) => updateThreshold(i, { op: (v || "lt") as Threshold["op"] })} size="sm" className="w-auto min-w-[8rem]" />
                  <Input
                    type="number"
                    value={String(t.value)}
                    onChange={(e) => updateThreshold(i, { value: Number(e.target.value) })}
                    className="h-8 w-20"
                  />
                  <span className="shrink-0 text-xs text-muted-foreground">→</span>
                  <Combobox options={TONE_OPTS} value={t.tone} onChange={(v) => updateThreshold(i, { tone: (v || "danger") as Tone })} size="sm" className="w-auto min-w-[7rem]" />
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeThreshold(i)} aria-label="Remove threshold">
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

          {type === "briefing" ? (
            <p className="border-t pt-3 text-xs text-muted-foreground">
              The briefing always lists your own queue, so it has no filters.
            </p>
          ) : (
          <div className="grid grid-cols-2 gap-3 border-t pt-3">
            <Field label="Status"><Combobox options={statusOpts} value={filters.status ?? ""} onChange={(v) => setF("status", v)} /></Field>
            <Field label="Priority"><Combobox options={prioOpts} value={filters.priority ?? ""} onChange={(v) => setF("priority", v)} /></Field>
            <Field label="Type"><Combobox options={typeOpts} value={filters.type ?? ""} onChange={(v) => setF("type", v)} /></Field>
            <Field label="Team"><Combobox options={teamOpts} value={filters.group ?? ""} onChange={(v) => setF("group", v)} searchPlaceholder="Search teams…" /></Field>
            <Field label="Assignee"><Combobox options={agentOpts} value={filters.assignee ?? ""} onChange={(v) => setF("assignee", v)} searchPlaceholder="Search agents…" /></Field>
            <Field label="Category"><Combobox options={catOpts} value={filters.category ?? ""} onChange={(v) => setF("category", v)} searchPlaceholder="Search categories…" /></Field>
            <Field label="Service"><Combobox options={svcOpts} value={filters.service ?? ""} onChange={(v) => setF("service", v)} searchPlaceholder="Search services…" /></Field>
            <Field label="Impact"><Combobox options={impactOpts} value={filters.impact ?? ""} onChange={(v) => setF("impact", v)} /></Field>
            <Field label="Urgency"><Combobox options={urgencyOpts} value={filters.urgency ?? ""} onChange={(v) => setF("urgency", v)} /></Field>
            <Field label="Source"><Combobox options={sourceOpts} value={filters.source ?? ""} onChange={(v) => setF("source", v)} /></Field>
            <Field label="Major incident"><Combobox options={yesAny("Any")} value={filters.major ?? ""} onChange={(v) => setF("major", v)} /></Field>
            <Field label="VIP requester"><Combobox options={yesAny("Any")} value={filters.vip ?? ""} onChange={(v) => setF("vip", v)} /></Field>
            <Field label="SLA breached"><Combobox options={yesAny("Any")} value={filters.breached ?? ""} onChange={(v) => setF("breached", v)} /></Field>
          </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={save}>{initial ? "Save widget" : "Add widget"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
