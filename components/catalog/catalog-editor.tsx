"use client";

import { useActionState, useState } from "react";
import { useFormSubmit } from "@/hooks/use-form-submit";
import { Plus, Pencil, Trash2, Loader2, Save, ShoppingBag } from "lucide-react";
import {
  createCatalogItem, updateCatalogItem, type CatalogAdminState,
} from "@/lib/actions/catalog-admin";
import {
  CATALOG_TICKET_TYPES, FIELD_TYPES, conditionAnswers, isConditionSource, type ServiceField, type FieldType,
} from "@/lib/service-forms";
import { LEVEL_META } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboOption } from "@/components/combobox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { IconPicker } from "@/components/icon-picker";
import { useEnumT, useServerMessage, useT } from "@/lib/i18n/client";

type Opt = { value: string; label: string }[];
export type CatalogItemData = {
  id: string; name: string; description: string | null; shortDescription: string | null;
  icon: string | null; categoryId: string | null; serviceId: string | null; groupId: string | null; estimatedDays: number | null;
  isPublished: boolean; requiresApproval: boolean; approverId: string | null;
  fields: ServiceField[];
  ticketType: string; titleTemplate: string | null;
  /** Restricted to the members of `visibleToGroupIds` (empty while restricted = every listed group was deleted: visible to nobody). */
  restrictToGroups: boolean; visibleToGroupIds: string[];
};

/** Field types whose answers pick from the options the admin types in. */
const WITH_OPTIONS: FieldType[] = ["select", "multiselect"];

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60) || "field";
}

/** `base`, or `base_2`, `base_3` … when another question already has the key. */
function uniqueKey(base: string, taken: Set<string>) {
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
  return key;
}

/**
 * "Show only if": pick an earlier choice / multiple choice / checkbox / urgency
 * question and the answers that show this one. Controlled by the editor's field list.
 */
function ConditionEditor({
  field, earlier, onChange,
}: {
  field: ServiceField;
  earlier: ServiceField[];
  onChange: (condition: ServiceField["condition"]) => void;
}) {
  const t = useT("catalog");
  const te = useEnumT();
  const sources = earlier.filter((f) => isConditionSource(f) && f.label.trim());
  if (sources.length === 0) return null;
  const condition = field.condition ?? null;
  const source = condition ? sources.find((f) => f.key === condition.field) : undefined;
  const sourceOpts: ComboOption[] = [
    { value: "always", label: t("conditionAlways") },
    ...sources.map((f) => ({ value: f.key, label: t("conditionWhen", { question: f.label }) })),
  ];
  const answerLabel = (src: ServiceField, v: string) =>
    src.type === "checkbox" ? t(v === "true" ? "conditionTicked" : "conditionNotTicked")
      : src.type === "urgency" ? te(LEVEL_META, v)
        : v;
  const values = condition?.values ?? [];
  const toggle = (v: string, on: boolean) => {
    if (!condition) return;
    onChange({ field: condition.field, values: on ? [...values.filter((x) => x !== v), v] : values.filter((x) => x !== v) });
  };

  return (
    <div className="grid gap-2 rounded-md border border-dashed p-2 sm:col-span-4">
      <Combobox
        options={sourceOpts}
        value={source ? source.key : "always"}
        onChange={(v) => onChange(!v || v === "always" ? null : { field: v, values: [] })}
        searchPlaceholder={t("searchQuestions")}
      />
      {source ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-1">
          <span className="text-xs text-muted-foreground">{t("conditionAnswers")}</span>
          {conditionAnswers(source).map((v) => (
            <label key={v} className="flex items-center gap-1.5 text-xs">
              <Checkbox checked={values.includes(v)} onCheckedChange={(on) => toggle(v, !!on)} /> {answerLabel(source, v)}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function CatalogEditor({
  item, categories, services, groups, agents,
}: {
  item?: CatalogItemData;
  categories: Opt;
  services: Opt;
  groups: Opt;
  agents: Opt;
}) {
  const editing = !!item;
  const t = useT("catalog");
  const tc = useT("common");
  const tm = useServerMessage();
  const FIELD_TYPE_OPTIONS: ComboOption[] = FIELD_TYPES.map((ft) => ({ value: ft, label: t(`fieldType.${ft}`) }));
  const [open, setOpen] = useState(false);
  // Close only on success — a validation error must stay visible with the input intact.
  const [state, action, pending] = useActionState<CatalogAdminState, FormData>(
    async (prev, fd) => {
      const result = await (editing ? updateCatalogItem : createCatalogItem)(prev, fd);
      if (!result?.error) setOpen(false);
      return result;
    },
    undefined,
  );
  const submit = useFormSubmit(action);

  const [icon, setIcon] = useState(item?.icon ?? "ShoppingBag");
  const [categoryId, setCategoryId] = useState(item?.categoryId ?? "none");
  const [serviceId, setServiceId] = useState(item?.serviceId ?? "none");
  const [groupId, setGroupId] = useState(item?.groupId ?? "none");
  const [approverId, setApproverId] = useState(item?.approverId ?? "none");
  const [isPublished, setIsPublished] = useState(item?.isPublished ?? true);
  const [requiresApproval, setRequiresApproval] = useState(item?.requiresApproval ?? false);
  const [fields, setFields] = useState<ServiceField[]>(item?.fields ?? []);
  const [ticketType, setTicketType] = useState(item?.ticketType ?? "REQUEST");
  const [restrictToGroups, setRestrictToGroups] = useState(item?.restrictToGroups ?? false);
  const [visibleGroupIds, setVisibleGroupIds] = useState<string[]>(item?.visibleToGroupIds ?? []);
  const toggleVisibleGroup = (id: string, on: boolean) =>
    setVisibleGroupIds((ids) => (on ? [...ids.filter((x) => x !== id), id] : ids.filter((x) => x !== id)));
  const ticketTypeOpts: ComboOption[] = CATALOG_TICKET_TYPES.map((tt) => ({ value: tt, label: t(`ticketType.${tt}`) }));

  const catOpts: ComboOption[] = [{ value: "none", label: t("noCategory") }, ...categories];
  const serviceOpts: ComboOption[] = [{ value: "none", label: t("noService") }, ...services];
  const groupOpts: ComboOption[] = [{ value: "none", label: t("routeByService") }, ...groups];
  const approverOpts: ComboOption[] = [{ value: "none", label: t("noApprover") }, ...agents.map((a) => ({ ...a, avatar: a.label.slice(0, 2).toUpperCase() }))];
  const normalized = (() => {
    const taken = new Set(fields.map((f) => f.key).filter(Boolean));
    return fields.filter((f) => f.label.trim()).map((f) => {
      if (f.key) return f;
      const key = uniqueKey(slug(f.label), taken);
      taken.add(key);
      return { ...f, key };
    });
  })();

  const update = (i: number, patch: Partial<ServiceField>) => setFields((f) => f.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  /** A new label renames the key; conditions that pointed at the old key follow it. */
  const relabel = (i: number, label: string) =>
    setFields((list) => {
      const oldKey = list[i].key;
      const key = uniqueKey(slug(label), new Set(list.filter((_, idx) => idx !== i).map((x) => x.key).filter(Boolean)));
      return list.map((x, idx) =>
        idx === i ? { ...x, label, key }
          : oldKey && x.condition?.field === oldKey ? { ...x, condition: { ...x.condition, field: key } } : x,
      );
    });
  /** A question that stops offering answers (type or options changed) drops the condition answers that relied on them. */
  const retype = (i: number, patch: Partial<ServiceField>) =>
    setFields((list) => {
      const next = list.map((x, idx) => (idx === i ? { ...x, ...patch } : x));
      const source = next[i];
      const offered = isConditionSource(source) ? conditionAnswers(source) : [];
      return next.map((x) => {
        if (!x.condition || x.condition.field !== source.key) return x;
        const values = x.condition.values.filter((v) => offered.includes(v));
        return offered.length ? { ...x, condition: { ...x.condition, values } } : { ...x, condition: null };
      });
    });
  const remove = (i: number) =>
    setFields((list) => {
      const key = list[i].key;
      return list.filter((_, idx) => idx !== i).map((x) => (x.condition?.field === key ? { ...x, condition: null } : x));
    });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={editing ? "outline" : "default"} size={editing ? "icon-sm" : "default"} aria-label={editing ? t("editItem") : undefined} />}>
        {editing ? <Pencil className="size-4" /> : <><Plus className="size-4" /> {t("newCatalogItem")}</>}
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ShoppingBag className="size-4 text-primary" /> {editing ? t("editCatalogItem") : t("newCatalogItem")}</DialogTitle>
          <DialogDescription>{t("editorDescription")}</DialogDescription>
        </DialogHeader>

        <form method="post" onSubmit={submit} className="grid gap-5">
          {item ? <input type="hidden" name="id" value={item.id} /> : null}
          <input type="hidden" name="icon" value={icon} />
          <input type="hidden" name="categoryId" value={categoryId} />
          <input type="hidden" name="serviceId" value={serviceId} />
          <input type="hidden" name="groupId" value={groupId} />
          <input type="hidden" name="approverId" value={approverId} />
          <input type="hidden" name="isPublished" value={String(isPublished)} />
          <input type="hidden" name="requiresApproval" value={String(requiresApproval)} />
          <input type="hidden" name="formSchema" value={JSON.stringify(normalized)} />
          <input type="hidden" name="ticketType" value={ticketType} />
          <input type="hidden" name="restrictToGroups" value={String(restrictToGroups)} />
          {restrictToGroups ? visibleGroupIds.map((id) => <input key={id} type="hidden" name="visibleToGroupIds" value={id} />) : null}

          {state?.error ? <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{tm(state.error)}</p> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>{tc("name")}</Label>
              <Input name="name" defaultValue={item?.name} placeholder={t("namePlaceholder")} required />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>{t("shortDescription")} <span className="text-muted-foreground">{t("shownOnCard")}</span></Label>
              <Input name="shortDescription" defaultValue={item?.shortDescription ?? ""} placeholder={t("shortDescriptionPlaceholder")} />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>{t("fullDescription")}</Label>
              <Textarea name="description" defaultValue={item?.description ?? ""} className="min-h-20" />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>{t("icon")}</Label>
              <IconPicker value={icon} onChange={setIcon} />
            </div>
            <div className="grid gap-1.5">
              <Label>{tc("category")}</Label>
              <Combobox options={catOpts} value={categoryId} onChange={setCategoryId} searchPlaceholder={t("searchCategories")} />
            </div>
            <div className="grid gap-1.5">
              <Label>{tc("service")} <span className="text-muted-foreground">{t("preRoutes")}</span></Label>
              <Combobox options={serviceOpts} value={serviceId} onChange={setServiceId} searchPlaceholder={t("searchServices")} />
            </div>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>{t("routingTeam")}</Label>
              <Combobox options={groupOpts} value={groupId} onChange={setGroupId} searchPlaceholder={t("searchGroups")} />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("ticketTypeLabel")}</Label>
              <Combobox options={ticketTypeOpts} value={ticketType} onChange={(v) => setTicketType(v || "REQUEST")} searchPlaceholder={t("searchTypes")} />
            </div>
            <div className="grid gap-1.5">
              <Label>{t("titleTemplate")}</Label>
              <Input name="titleTemplate" defaultValue={item?.titleTemplate ?? ""} placeholder={t("titleTemplatePlaceholder", { item: "{{item}}" })} />
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              {t("titleTemplateHint", { item: "{{item}}", requester: "{{requester}}", keys: normalized.length ? normalized.map((f) => `{{${f.key}}}`).join(", ") : "—" })}
            </p>
            <div className="grid gap-1.5 sm:col-span-2">
              <Label>{t("estimatedDelivery")}</Label>
              <Input name="estimatedDays" type="number" defaultValue={item?.estimatedDays ?? ""} placeholder={t("estimatedPlaceholder")} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-2 rounded-lg border p-3 text-sm">
              <Checkbox checked={isPublished} onCheckedChange={(v) => setIsPublished(!!v)} /> {t("publishedInCatalog")}
            </label>
            <label className="flex items-center gap-2 rounded-lg border p-3 text-sm">
              <Checkbox checked={requiresApproval} onCheckedChange={(v) => setRequiresApproval(!!v)} /> {t("requiresApproval")}
            </label>
          </div>
          {requiresApproval ? (
            <div className="grid gap-1.5">
              <Label>{t("approver")}</Label>
              <Combobox options={approverOpts} value={approverId} onChange={setApproverId} searchPlaceholder={t("searchPeople")} />
            </div>
          ) : null}

          <div className="grid gap-2 rounded-lg border p-3">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={restrictToGroups} onCheckedChange={(v) => setRestrictToGroups(!!v)} /> {t("restrictToGroups")}
            </label>
            <p className="text-xs text-muted-foreground">{restrictToGroups ? t("restrictToGroupsHint") : t("visibleToEveryone")}</p>
            {restrictToGroups ? (
              <>
                {item?.restrictToGroups && item.visibleToGroupIds.length === 0 ? (
                  <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-300">{t("restrictedNoGroups")}</p>
                ) : null}
                {groups.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t("noGroupsToChoose")}</p>
                ) : (
                  <div className="grid max-h-40 gap-1.5 overflow-y-auto sm:grid-cols-2">
                    {groups.map((g) => (
                      <label key={g.value} className="flex items-center gap-2 text-sm">
                        <Checkbox checked={visibleGroupIds.includes(g.value)} onCheckedChange={(on) => toggleVisibleGroup(g.value, !!on)} /> {g.label}
                      </label>
                    ))}
                  </div>
                )}
              </>
            ) : null}
          </div>

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>{t("requestForm")}</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => setFields((f) => [...f, { key: "", label: "", type: "text", required: false }])}>
                <Plus className="size-4" /> {t("addField")}
              </Button>
            </div>
            {fields.length === 0 ? (
              <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">{t("noFields")}</p>
            ) : (
              fields.map((f, i) => (
                <div key={i} className="grid gap-2 rounded-lg border bg-card p-3 sm:grid-cols-[1fr_10rem_auto_auto] sm:items-center">
                  <Input value={f.label} placeholder={t("questionLabel")} onChange={(e) => relabel(i, e.target.value)} />
                  <Combobox options={FIELD_TYPE_OPTIONS} value={f.type} onChange={(v) => retype(i, { type: (v as FieldType) || "text" })} searchPlaceholder={t("searchTypes")} />
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Checkbox checked={!!f.required} onCheckedChange={(v) => update(i, { required: !!v })} /> {t("requiredShort")}
                  </label>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={t("removeField")} onClick={() => remove(i)}>
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                  {WITH_OPTIONS.includes(f.type) ? (
                    <Input className="sm:col-span-4" placeholder={t("optionsPlaceholder")} value={(f.options ?? []).join(", ")}
                      onChange={(e) => retype(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
                  ) : null}
                  <ConditionEditor field={f} earlier={fields.slice(0, i)} onChange={(condition) => update(i, { condition })} />
                </div>
              ))
            )}
            {fields.length > 0 ? <p className="text-xs text-muted-foreground">{t("specialFieldsHint")}</p> : null}
            {fields.length > 1 ? <p className="text-xs text-muted-foreground">{t("conditionHint")}</p> : null}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {editing ? t("saveItem") : t("createItem")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
