"use client";

import { useActionState, useState } from "react";
import { Plus, Trash2, Loader2, Save, Zap, Pencil, TriangleAlert } from "lucide-react";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { createRule, updateRule, type RuleState } from "@/lib/actions/automations";
import {
  TRIGGERS, MATCH_TYPES, CONDITION_FIELDS, OPERATORS, ACTION_TYPES,
  type Condition, type AutomationAction,
} from "@/lib/automation-defs";
import {
  TICKET_STATUSES, PRIORITIES, TICKET_TYPES, IMPACT_URGENCY, TICKET_SOURCES,
  TICKET_STATUS_META, PRIORITY_META, TICKET_TYPE_META, LEVEL_META, SOURCE_META,
} from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Combobox, type ComboOption } from "@/components/combobox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useEnumT, useServerMessage, useT } from "@/lib/i18n/client";
import type { EnumTranslator } from "@/lib/i18n/enums";
import type { Translator } from "@/lib/i18n/translate";

type Opt = { value: string; label: string }[];
export type AutomationOptions = {
  agents: Opt; groups: Opt; categories: Opt; services: Opt;
};

const enumOpts = (arr: readonly string[], meta: Record<string, { label: string }>, te: EnumTranslator): ComboOption[] =>
  arr.map((v) => ({ value: v, label: meta[v] ? te(meta[v]) : v }));

const toCombo = (o: Opt): ComboOption[] => o.map((x) => ({ value: x.value, label: x.label }));

function conditionValueOptions(field: string, o: AutomationOptions, te: EnumTranslator, tc: Translator<"common">): ComboOption[] | "text" | "none" {
  switch (field) {
    case "type": return enumOpts(TICKET_TYPES, TICKET_TYPE_META, te);
    case "status": return enumOpts(TICKET_STATUSES, TICKET_STATUS_META, te);
    case "priority": return enumOpts(PRIORITIES, PRIORITY_META, te);
    case "impact":
    case "urgency": return enumOpts(IMPACT_URGENCY, LEVEL_META, te);
    case "source": return enumOpts(TICKET_SOURCES, SOURCE_META, te);
    case "categoryId": return toCombo(o.categories);
    case "groupId": return toCombo(o.groups);
    case "serviceId": return toCombo(o.services);
    case "assigneeId": return toCombo(o.agents);
    case "requesterVip": return [{ value: "true", label: tc("yes") }, { value: "false", label: tc("no") }];
    case "title": return "text";
    default: return "text";
  }
}

function actionValueOptions(type: string, o: AutomationOptions, te: EnumTranslator): ComboOption[] | "text" | "none" {
  switch (type) {
    case "set_status": return enumOpts(TICKET_STATUSES, TICKET_STATUS_META, te);
    case "set_priority": return enumOpts(PRIORITIES, PRIORITY_META, te);
    case "assign":
    case "notify": return toCombo(o.agents);
    case "set_group": return toCombo(o.groups);
    case "internal_note": return "text";
    case "webhook": return "text";
    default: return "none"; // escalate, major_incident, notify_group
  }
}

/** Placeholder for the free-text value input, per action type. */
function actionValuePlaceholder(type: string, t: Translator<"automations">): string {
  switch (type) {
    case "webhook": return "https://example.com/hook";
    case "internal_note": return t("notePlaceholder");
    default: return t("value");
  }
}

/** Lower-cased trigger label for the "runs on every ..." warning. */
function triggerLabel(trigger: string, t: Translator<"automations">): string {
  const label = t.dyn(`trigger.${trigger}`, undefined, TRIGGERS.find((x) => x.value === trigger)?.label ?? trigger);
  return label.charAt(0).toLowerCase() + label.slice(1);
}

function FieldErrors({ messages }: { messages?: string[] }) {
  const tm = useServerMessage();
  if (!messages?.length) return null;
  return (
    <ul className="grid gap-0.5 text-xs text-destructive">
      {messages.map((m) => <li key={m}>{tm(m)}</li>)}
    </ul>
  );
}

function ValuePicker({
  kind, value, onChange, placeholder,
}: {
  kind: ComboOption[] | "text" | "none";
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const t = useT("automations");
  if (kind === "none") return <span className="text-xs text-muted-foreground">—</span>;
  if (kind === "text")
    return <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? t("value")} className="h-8" />;
  return <Combobox options={kind} value={value} onChange={onChange} size="sm" placeholder={t("value")} searchPlaceholder={t("searchPlaceholder")} />;
}

export function RuleBuilder({
  options, rule,
}: {
  options: AutomationOptions;
  rule?: {
    id: string; name: string; description: string | null; trigger: string; matchType: string;
    conditions: Condition[]; actions: AutomationAction[]; isActive: boolean;
  };
}) {
  const editing = !!rule;
  const t = useT("automations");
  const tc = useT("common");
  const te = useEnumT();
  const tm = useServerMessage();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<RuleState, FormData>(
    editing ? updateRule : createRule,
    undefined,
  );

  const [name, setName] = useState(rule?.name ?? "");
  const [description, setDescription] = useState(rule?.description ?? "");
  const [trig, setTrig] = useState(rule?.trigger ?? "TICKET_CREATED");
  const [matchType, setMatchType] = useState(rule?.matchType ?? "ALL");
  const [conditions, setConditions] = useState<Condition[]>(rule?.conditions ?? []);
  const [actions, setActions] = useState<AutomationAction[]>(rule?.actions ?? [{ type: "assign", value: "" }]);

  const submit = useFormSubmit(action);
  const fe = state?.fieldErrors ?? {};

  // Close once, when a new successful result arrives.
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state?.ok) setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant={editing ? "outline" : "default"} size={editing ? "icon-sm" : "sm"} aria-label={editing ? t("editRule") : undefined} />}
      >
        {editing ? <Pencil className="size-4" /> : <><Plus className="size-4" /> {t("newRule")}</>}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Zap className="size-4 text-primary" /> {editing ? t("editAutomation") : t("newAutomation")}</DialogTitle>
          <DialogDescription>{t("builderDescription")}</DialogDescription>
        </DialogHeader>

        <form method="post" onSubmit={submit} className="grid gap-5">
          {rule ? <input type="hidden" name="id" value={rule.id} /> : null}
          <input type="hidden" name="conditions" value={JSON.stringify(conditions.filter((c) => c.field))} />
          <input type="hidden" name="actions" value={JSON.stringify(actions.filter((a) => a.type))} />

          {state?.error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{tm(state.error)}</p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>{t("ruleName")}</Label>
              <Input name="name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("ruleNamePlaceholder")} required />
              <FieldErrors messages={fe.name} />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("trigger")}</Label>
              <input type="hidden" name="trigger" value={trig} />
              <Combobox options={TRIGGERS.map((x) => ({ value: x.value, label: t(`trigger.${x.value}`) }))} value={trig} onChange={setTrig} />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("match")}</Label>
              <input type="hidden" name="matchType" value={matchType} />
              <Combobox options={MATCH_TYPES.map((x) => ({ value: x.value, label: t(`match.${x.value}`) }))} value={matchType} onChange={setMatchType} />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>{tc("description")}</Label>
              <Input name="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("descriptionPlaceholder")} />
            </div>
          </div>

          {/* Conditions */}
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>{t("conditions")}</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => setConditions((c) => [...c, { field: "priority", op: "eq", value: "" }])}>
                <Plus className="size-4" /> {t("addCondition")}
              </Button>
            </div>
            <FieldErrors messages={fe.conditions} />
            {conditions.length === 0 ? (
              <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  {t.rich("noConditions", { trigger: triggerLabel(trig, t), b: (c) => <strong>{c}</strong> })}
                </span>
              </p>
            ) : (
              conditions.map((c, i) => {
                const vk = ["empty", "not_empty"].includes(c.op) ? "none" : conditionValueOptions(c.field, options, te, tc);
                return (
                  <div key={i} className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2">
                    <Combobox options={CONDITION_FIELDS.map((f) => ({ value: f.value, label: t(`field.${f.value}`) }))} value={c.field} size="sm"
                      onChange={(v) => setConditions((arr) => arr.map((x, idx) => (idx === i ? { ...x, field: v, value: "" } : x)))} />
                    <Combobox options={OPERATORS.map((op) => ({ value: op.value, label: t(`op.${op.value}`) }))} value={c.op} size="sm"
                      onChange={(v) => setConditions((arr) => arr.map((x, idx) => (idx === i ? { ...x, op: v } : x)))} />
                    <ValuePicker kind={vk} value={c.value ?? ""} onChange={(v) => setConditions((arr) => arr.map((x, idx) => (idx === i ? { ...x, value: v } : x)))} />
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => setConditions((arr) => arr.filter((_, idx) => idx !== i))}>
                      <Trash2 className="size-4 text-muted-foreground" />
                    </Button>
                  </div>
                );
              })
            )}
          </div>

          {/* Actions */}
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>{t("thenDo")}</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => setActions((a) => [...a, { type: "set_status", value: "" }])}>
                <Plus className="size-4" /> {t("addAction")}
              </Button>
            </div>
            <FieldErrors messages={fe.actions} />
            {actions.map((a, i) => {
              const vk = actionValueOptions(a.type, options, te);
              return (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                  <Combobox options={ACTION_TYPES.map((x) => ({ value: x.value, label: t(`action.${x.value}`) }))} value={a.type} size="sm"
                    onChange={(v) => setActions((arr) => arr.map((x, idx) => (idx === i ? { ...x, type: v, value: "" } : x)))} />
                  <ValuePicker kind={vk} value={a.value ?? ""} onChange={(v) => setActions((arr) => arr.map((x, idx) => (idx === i ? { ...x, value: v } : x)))} placeholder={actionValuePlaceholder(a.type, t)} />
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => setActions((arr) => arr.filter((_, idx) => idx !== i))}>
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                </div>
              );
            })}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {editing ? t("saveRule") : t("createRule")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
