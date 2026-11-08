"use client";

import { useActionState, useState } from "react";
import { Plus, Trash2, Loader2, Save, Pencil, SlidersHorizontal } from "lucide-react";
import { createCustomField, updateCustomField, type FieldState } from "@/lib/actions/custom-fields";
import {
  CUSTOM_FIELD_TYPES, CUSTOM_FIELD_TYPE_LABELS, VISIBILITY_FIELDS,
  type CustomFieldDef, type CustomFieldEntity,
} from "@/lib/custom-fields";
import { MATCH_TYPES, OPERATORS, type Condition } from "@/lib/automation-defs";
import {
  TICKET_STATUSES, PRIORITIES, TICKET_TYPES, IMPACT_URGENCY, TICKET_SOURCES,
  PROBLEM_STATUSES, CHANGE_STATUSES, CHANGE_TYPES, RISKS,
  TICKET_STATUS_META, PRIORITY_META, TICKET_TYPE_META, LEVEL_META, SOURCE_META,
  PROBLEM_STATUS_META, CHANGE_STATUS_META, CHANGE_TYPE_META,
} from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Combobox, type ComboOption } from "@/components/combobox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useEnumT, useServerMessage, useT } from "@/lib/i18n/client";
import type { EnumTranslator } from "@/lib/i18n/enums";
import type { Translator } from "@/lib/i18n/translate";

const enumOptsFor = (te: EnumTranslator) => (arr: readonly string[], meta: Record<string, { label: string }>): ComboOption[] =>
  arr.map((v) => ({ value: v, label: meta[v] ? te(meta, v) : v }));

// Value options for a visibility condition, keyed by (entity, built-in field).
function conditionValueOptions(entity: CustomFieldEntity, field: string, te: EnumTranslator): ComboOption[] | "text" {
  const enumOpts = enumOptsFor(te);
  const map: Record<string, ComboOption[] | "text"> = {
    type: entity === "CHANGE" ? enumOpts(CHANGE_TYPES, CHANGE_TYPE_META) : enumOpts(TICKET_TYPES, TICKET_TYPE_META),
    status:
      entity === "PROBLEM"
        ? enumOpts(PROBLEM_STATUSES, PROBLEM_STATUS_META)
        : entity === "CHANGE"
          ? enumOpts(CHANGE_STATUSES, CHANGE_STATUS_META)
          : enumOpts(TICKET_STATUSES, TICKET_STATUS_META),
    priority: enumOpts(PRIORITIES, PRIORITY_META),
    impact: enumOpts(IMPACT_URGENCY, LEVEL_META),
    urgency: enumOpts(IMPACT_URGENCY, LEVEL_META),
    risk: enumOpts(RISKS, LEVEL_META),
    source: enumOpts(TICKET_SOURCES, SOURCE_META),
    categoryId: "text",
  };
  return map[field] ?? "text";
}

function ValuePicker({
  kind, value, onChange,
}: {
  kind: ComboOption[] | "text" | "none";
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useT("settings");
  if (kind === "none") return <span className="text-xs text-muted-foreground">—</span>;
  if (kind === "text")
    return <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={t("cfEditor.value")} className="h-8" />;
  return <Combobox options={kind} value={value} onChange={onChange} size="sm" placeholder={t("cfEditor.value")} />;
}

const typeOpts = (t: Translator<"settings">): ComboOption[] =>
  CUSTOM_FIELD_TYPES.map((ty) => ({ value: ty, label: t.dyn(`customFields.type.${ty}`, undefined, CUSTOM_FIELD_TYPE_LABELS[ty]) }));

function slugPreview(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
}

export function CustomFieldEditor({
  entityType,
  def,
}: {
  entityType: CustomFieldEntity;
  def?: CustomFieldDef;
}) {
  const editing = !!def;
  const t = useT("settings");
  const te = useEnumT();
  const tm = useServerMessage();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<FieldState, FormData>(
    editing ? updateCustomField : createCustomField,
    undefined,
  );

  const [label, setLabel] = useState(def?.label ?? "");
  const [type, setType] = useState(def?.type ?? "text");
  const [required, setRequired] = useState(def?.required ?? false);
  const [placeholder, setPlaceholder] = useState(def?.placeholder ?? "");
  const [help, setHelp] = useState(def?.help ?? "");
  const [options, setOptions] = useState<string[]>(
    def ? tryParse(def.options) : [""],
  );
  const [matchType, setMatchType] = useState(def?.matchType ?? "ALL");
  const [conditions, setConditions] = useState<Condition[]>(def ? tryParseConds(def.visibility) : []);

  const fields = VISIBILITY_FIELDS[entityType];
  const cleanOptions = options.map((o) => o.trim()).filter(Boolean);

  const submit = async (fd: FormData) => {
    await action(fd);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant={editing ? "outline" : "default"} size={editing ? "icon-sm" : "sm"} aria-label={editing ? t("cfEditor.editField") : undefined} />}
      >
        {editing ? <Pencil className="size-4" /> : <><Plus className="size-4" /> {t("cfEditor.newField")}</>}
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><SlidersHorizontal className="size-4 text-primary" /> {editing ? t("cfEditor.titleEdit") : t("cfEditor.titleNew")}</DialogTitle>
          <DialogDescription>{t("cfEditor.description")}</DialogDescription>
        </DialogHeader>

        <form action={submit} className="grid gap-5">
          {def ? <input type="hidden" name="id" value={def.id} /> : null}
          <input type="hidden" name="entityType" value={entityType} />
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="required" value={required ? "true" : "false"} />
          <input type="hidden" name="matchType" value={matchType} />
          <input type="hidden" name="options" value={JSON.stringify(cleanOptions)} />
          <input type="hidden" name="visibility" value={JSON.stringify(conditions.filter((c) => c.field))} />

          {state?.error ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{tm(state.error)}</p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>{t("cfEditor.label")}</Label>
              <Input name="label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("cfEditor.labelPlaceholder")} required />
              {!editing && label ? (
                <p className="text-xs text-muted-foreground">{t("cfEditor.key")} <span className="font-mono">{slugPreview(label) || "field"}</span></p>
              ) : null}
              {editing ? <p className="text-xs text-muted-foreground">{t("cfEditor.key")} <span className="font-mono">{def.key}</span></p> : null}
            </div>
            <div className="grid gap-1.5">
              <Label>{t("cfEditor.type")}</Label>
              <Combobox options={typeOpts(t)} value={type} onChange={(v) => setType(v)} />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("cfEditor.placeholder")}</Label>
              <Input name="placeholder" value={placeholder} onChange={(e) => setPlaceholder(e.target.value)} placeholder={t("cfEditor.optional")} />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>{t("cfEditor.helpText")}</Label>
              <Input name="help" value={help} onChange={(e) => setHelp(e.target.value)} placeholder={t("cfEditor.helpPlaceholder")} />
            </div>
          </div>

          {/* Select options */}
          {type === "select" ? (
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label>{t("cfEditor.choices")}</Label>
                <Button type="button" variant="outline" size="sm" onClick={() => setOptions((o) => [...o, ""])}>
                  <Plus className="size-4" /> {t("cfEditor.addChoice")}
                </Button>
              </div>
              {options.length === 0 ? (
                <p className="rounded-lg border border-dashed p-3 text-center text-xs text-muted-foreground">{t("cfEditor.addAtLeastOne")}</p>
              ) : (
                options.map((o, i) => (
                  <div key={i} className="grid grid-cols-[1fr_auto] items-center gap-2">
                    <Input value={o} onChange={(e) => setOptions((arr) => arr.map((x, idx) => (idx === i ? e.target.value : x)))} placeholder={t("cfEditor.choicePlaceholder")} className="h-8" />
                    <Button type="button" variant="ghost" size="icon-sm" aria-label={t("cfEditor.removeChoice")} onClick={() => setOptions((arr) => arr.filter((_, idx) => idx !== i))}>
                      <Trash2 className="size-4 text-muted-foreground" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          ) : null}

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label>{t("cfEditor.required")}</Label>
              <p className="text-xs text-muted-foreground">{t("cfEditor.requiredHint")}</p>
            </div>
            <Switch checked={required} onCheckedChange={(c) => setRequired(!!c)} disabled={type === "checkbox"} aria-label={t("cfEditor.required")} />
          </div>

          {/* Visibility conditions */}
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <div>
                <Label>{t("cfEditor.showWhen")}</Label>
                <p className="text-xs text-muted-foreground">{t("cfEditor.noConditions")}</p>
              </div>
              <div className="flex items-center gap-2">
                <Combobox options={MATCH_TYPES.map((m) => ({ value: m.value, label: t.dyn(`match.${m.value}`, undefined, m.label) }))} value={matchType} onChange={setMatchType} size="sm" className="w-auto" />
                <Button type="button" variant="outline" size="sm" onClick={() => setConditions((c) => [...c, { field: fields[0]?.value ?? "status", op: "eq", value: "" }])}>
                  <Plus className="size-4" /> {t("cfEditor.add")}
                </Button>
              </div>
            </div>
            {conditions.map((c, i) => {
              const vk = ["empty", "not_empty"].includes(c.op) ? "none" : conditionValueOptions(entityType, c.field, te);
              return (
                <div key={i} className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2">
                  <Combobox options={fields.map((f) => ({ value: f.value, label: t.dyn(`cfField.${f.value}`, undefined, f.label) }))} value={c.field} size="sm"
                    onChange={(v) => setConditions((arr) => arr.map((x, idx) => (idx === i ? { ...x, field: v, value: "" } : x)))} />
                  <Combobox options={OPERATORS.map((op) => ({ value: op.value, label: t.dyn(`op.${op.value}`, undefined, op.label) }))} value={c.op} size="sm"
                    onChange={(v) => setConditions((arr) => arr.map((x, idx) => (idx === i ? { ...x, op: v } : x)))} />
                  <ValuePicker kind={vk} value={c.value ?? ""} onChange={(v) => setConditions((arr) => arr.map((x, idx) => (idx === i ? { ...x, value: v } : x)))} />
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={t("cfEditor.removeCondition")} onClick={() => setConditions((arr) => arr.filter((_, idx) => idx !== i))}>
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                </div>
              );
            })}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {editing ? t("cfEditor.saveField") : t("cfEditor.createField")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function tryParse(s: string): string[] {
  try {
    const a = JSON.parse(s);
    return Array.isArray(a) && a.length ? a.map(String) : [""];
  } catch {
    return [""];
  }
}
function tryParseConds(s: string): Condition[] {
  try {
    const a = JSON.parse(s);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}
