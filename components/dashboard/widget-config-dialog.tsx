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
import { useEnumT, useT } from "@/lib/i18n/client";

const TONES: Tone[] = ["primary", "success", "warning", "danger", "info", "neutral"];
const OPS: Threshold["op"][] = ["lt", "lte", "gt", "gte", "eq"];

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

const WIDGET_TYPE_LIST = Object.keys(WIDGET_LABELS) as WidgetType[];

const GROUPBY_FIELDS: BreakdownField[] = [
  "priority", "status", "type", "assignee", "group", "category", "service", "source", "impact", "urgency",
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
  const t = useT("dashboard");
  const te = useEnumT();
  const ACCENT_OPTS: ComboOption[] = [
    { value: "", label: t("accent.none") },
    ...TONES.map((tone) => ({ value: tone, label: t(`accent.${tone}`) })),
  ];
  const TONE_OPTS: ComboOption[] = ACCENT_OPTS.slice(1);
  const OP_OPTS: ComboOption[] = OPS.map((op) => ({ value: op, label: t(`op.${op}`) }));
  const TYPE_OPTS: ComboOption[] = WIDGET_TYPE_LIST.map((wt) => ({ value: wt, label: t(`widget.${wt}`) }));
  const GROUPBY_OPTS: ComboOption[] = GROUPBY_FIELDS.map((g) => ({ value: g, label: t(`groupBy.${g}`) }));
  const DAYS_OPTS: ComboOption[] = [
    { value: "7", label: t("last7") },
    { value: "14", label: t("last14") },
    { value: "30", label: t("last30") },
  ];
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
    { value: "", label: t("anyStatus") },
    { value: "open", label: t("openActive") },
    ...te.options(TICKET_STATUS_META, TICKET_STATUSES),
  ];
  const prioOpts: ComboOption[] = [{ value: "", label: t("anyPriority") }, ...te.options(PRIORITY_META, PRIORITIES)];
  const typeOpts: ComboOption[] = [{ value: "", label: t("anyType") }, ...te.options(TICKET_TYPE_META, TICKET_TYPES)];
  const teamOpts: ComboOption[] = [{ value: "", label: t("anyTeam") }, ...options.groups];
  const agentOpts: ComboOption[] = [{ value: "", label: t("anyAssignee") }, { value: "unassigned", label: t("unassigned") }, ...options.agents];
  const catOpts: ComboOption[] = [{ value: "", label: t("anyCategory") }, ...options.categories];
  const svcOpts: ComboOption[] = [{ value: "", label: t("anyService") }, ...options.services];
  const impactOpts: ComboOption[] = [{ value: "", label: t("anyImpact") }, ...te.options(LEVEL_META, IMPACT_URGENCY)];
  const urgencyOpts: ComboOption[] = [{ value: "", label: t("anyUrgency") }, ...te.options(LEVEL_META, IMPACT_URGENCY)];
  const sourceOpts: ComboOption[] = [{ value: "", label: t("anySource") }, ...te.options(SOURCE_META, TICKET_SOURCES)];
  const yesAny = (any: string): ComboOption[] => [{ value: "", label: any }, { value: "true", label: t("yes") }];

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
      title: title.trim() || t(`widget.${type}`),
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
          <DialogTitle>{initial ? t("editWidget") : t("addWidget")}</DialogTitle>
          <DialogDescription>{t("widgetDialogDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>{t("type")}</Label>
              <Combobox options={TYPE_OPTS} value={type} onChange={(v) => setType((v as WidgetType) || "stat")} />
            </div>
            {type === "breakdown" ? (
              <div className="grid gap-1.5">
                <Label>{t("groupBy")}</Label>
                <Combobox options={GROUPBY_OPTS} value={groupBy} onChange={(v) => setGroupBy((v as BreakdownField) || "priority")} />
              </div>
            ) : isTimeBased ? (
              <div className="grid gap-1.5">
                <Label>{t("range")}</Label>
                <Combobox options={DAYS_OPTS} value={filters.days ?? "14"} onChange={(v) => setF("days", v || "14")} />
              </div>
            ) : (
              <div />
            )}
          </div>

          {type === "breakdown" ? (
            <div className="grid gap-1.5">
              <Label>{t("chartType")}</Label>
              <Combobox
                options={[{ value: "bar", label: t("chartBar") }, { value: "donut", label: t("chartDonut") }]}
                value={chartType}
                onChange={(v) => setChartType((v as "bar" | "donut") || "bar")}
              />
            </div>
          ) : null}

          <div className="grid gap-1.5">
            <Label htmlFor="w-title">{t("widgetTitle")}</Label>
            <Input id="w-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t(`widget.${type}`)} />
          </div>

          <div className="grid gap-1.5">
            <Label>{t("accentColour")}</Label>
            <Combobox options={ACCENT_OPTS} value={accent} onChange={setAccent} />
          </div>

          {type === "stat" ? (
            <div className="grid gap-2 rounded-lg border p-2.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">{t("thresholds")}</Label>
                <Button type="button" variant="ghost" size="xs" onClick={addThreshold} disabled={thresholds.length >= 5}>
                  <Plus className="size-3.5" /> {t("add")}
                </Button>
              </div>
              {thresholds.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("noThresholds")}</p>
              ) : null}
              {thresholds.map((th, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="shrink-0 text-xs text-muted-foreground">{t("thresholdValue")}</span>
                  <Combobox options={OP_OPTS} value={th.op} onChange={(v) => updateThreshold(i, { op: (v || "lt") as Threshold["op"] })} size="sm" className="w-auto min-w-[8rem]" />
                  <Input
                    type="number"
                    value={String(th.value)}
                    onChange={(e) => updateThreshold(i, { value: Number(e.target.value) })}
                    className="h-8 w-20"
                  />
                  <span className="shrink-0 text-xs text-muted-foreground">→</span>
                  <Combobox options={TONE_OPTS} value={th.tone} onChange={(v) => updateThreshold(i, { tone: (v || "danger") as Tone })} size="sm" className="w-auto min-w-[7rem]" />
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeThreshold(i)} aria-label={t("removeThreshold")}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

          {type === "briefing" ? (
            <p className="border-t pt-3 text-xs text-muted-foreground">
              {t("briefingNoFilters")}
            </p>
          ) : (
          <div className="grid grid-cols-2 gap-3 border-t pt-3">
            <Field label={t("filterStatus")}><Combobox options={statusOpts} value={filters.status ?? ""} onChange={(v) => setF("status", v)} /></Field>
            <Field label={t("filterPriority")}><Combobox options={prioOpts} value={filters.priority ?? ""} onChange={(v) => setF("priority", v)} /></Field>
            <Field label={t("filterType")}><Combobox options={typeOpts} value={filters.type ?? ""} onChange={(v) => setF("type", v)} /></Field>
            <Field label={t("filterTeam")}><Combobox options={teamOpts} value={filters.group ?? ""} onChange={(v) => setF("group", v)} searchPlaceholder={t("searchTeams")} /></Field>
            <Field label={t("filterAssignee")}><Combobox options={agentOpts} value={filters.assignee ?? ""} onChange={(v) => setF("assignee", v)} searchPlaceholder={t("searchAgents")} /></Field>
            <Field label={t("filterCategory")}><Combobox options={catOpts} value={filters.category ?? ""} onChange={(v) => setF("category", v)} searchPlaceholder={t("searchCategories")} /></Field>
            <Field label={t("filterService")}><Combobox options={svcOpts} value={filters.service ?? ""} onChange={(v) => setF("service", v)} searchPlaceholder={t("searchServices")} /></Field>
            <Field label={t("filterImpact")}><Combobox options={impactOpts} value={filters.impact ?? ""} onChange={(v) => setF("impact", v)} /></Field>
            <Field label={t("filterUrgency")}><Combobox options={urgencyOpts} value={filters.urgency ?? ""} onChange={(v) => setF("urgency", v)} /></Field>
            <Field label={t("filterSource")}><Combobox options={sourceOpts} value={filters.source ?? ""} onChange={(v) => setF("source", v)} /></Field>
            <Field label={t("filterMajor")}><Combobox options={yesAny(t("any"))} value={filters.major ?? ""} onChange={(v) => setF("major", v)} /></Field>
            <Field label={t("filterVip")}><Combobox options={yesAny(t("any"))} value={filters.vip ?? ""} onChange={(v) => setF("vip", v)} /></Field>
            <Field label={t("filterBreached")}><Combobox options={yesAny(t("any"))} value={filters.breached ?? ""} onChange={(v) => setF("breached", v)} /></Field>
          </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
          <Button type="button" onClick={save}>{initial ? t("saveWidget") : t("addWidget")}</Button>
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
