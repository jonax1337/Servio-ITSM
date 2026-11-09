"use client";

import { useTransition } from "react";
import { updateServiceField } from "@/lib/actions/services";
import { Combobox, type ComboOption } from "@/components/combobox";
import {
  SERVICE_STATUSES,
  CRITICALITIES,
  SERVICE_STATUS_META,
  CRITICALITY_META,
} from "@/lib/constants";
import type { FormOptions } from "@/lib/data/options";
import { useEnumT, useT } from "@/lib/i18n/client";

type Field = "status" | "criticality" | "categoryId" | "ownerId" | "slaId" | "groupId";

function initials(s: string) {
  return s.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

function Prop({
  label, serviceId, field, value, options, searchable, placeholder, disabled,
}: {
  label: string;
  serviceId: string;
  field: Field;
  value: string | null;
  options: ComboOption[];
  searchable?: boolean;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  const t = useT("services");
  const fieldName = t.locale === "en" ? label.toLowerCase() : label;
  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Combobox
        options={options}
        value={value ?? "none"}
        pending={pending}
        disabled={disabled}
        placeholder={placeholder}
        searchPlaceholder={searchable ? t("searchField", { field: fieldName }) : t("filterPlaceholder")}
        onChange={(v) => {
          const fd = new FormData();
          fd.set("id", serviceId);
          fd.set("field", field);
          fd.set("value", v);
          start(() => updateServiceField(fd));
        }}
      />
    </div>
  );
}

export function ServiceProperties({
  service,
  options,
  canManage,
  canSetStatus = true,
}: {
  service: {
    id: string;
    status: string;
    criticality: string;
    categoryId: string | null;
    ownerId: string | null;
    slaId: string | null;
    groupId: string | null;
  };
  options: FormOptions;
  /** Managers edit every property; agents only the status (incident handling). */
  canManage: boolean;
  canSetStatus?: boolean;
}) {
  const t = useT("services");
  const tc = useT("common");
  const te = useEnumT();
  const statusOpts: ComboOption[] = SERVICE_STATUSES.map((s) => ({
    value: s, label: te(SERVICE_STATUS_META[s]), tone: SERVICE_STATUS_META[s].tone, icon: SERVICE_STATUS_META[s].icon,
  }));
  const critOpts: ComboOption[] = CRITICALITIES.map((c) => ({
    value: c, label: te(CRITICALITY_META[c]), tone: CRITICALITY_META[c].tone, icon: CRITICALITY_META[c].icon,
  }));
  const none = (label: string): ComboOption => ({ value: "none", label });
  const ownerOpts: ComboOption[] = [
    none(t("noOwner")),
    ...options.agents.map((a) => ({ value: a.id, label: a.name ?? a.email, avatar: initials(a.name ?? a.email), hint: a.email })),
  ];
  const catOpts: ComboOption[] = [none(t("noCategory")), ...options.categories.map((c) => ({ value: c.id, label: c.name }))];
  const teamOpts: ComboOption[] = [none(t("noGroup")), ...options.groups.map((g) => ({ value: g.id, label: g.name }))];
  const slaOpts: ComboOption[] = [none(t("noSlaOption")), ...options.slas.map((s) => ({ value: s.id, label: s.name }))];

  return (
    <div className="grid gap-3">
      <Prop label={tc("status")} serviceId={service.id} field="status" value={service.status} options={statusOpts} disabled={!canSetStatus} />
      <Prop label={t("criticality")} serviceId={service.id} field="criticality" value={service.criticality} options={critOpts} disabled={!canManage} />
      <Prop label={tc("owner")} serviceId={service.id} field="ownerId" value={service.ownerId} options={ownerOpts} searchable placeholder={t("noOwner")} disabled={!canManage} />
      <Prop label={tc("category")} serviceId={service.id} field="categoryId" value={service.categoryId} options={catOpts} searchable placeholder={t("noCategory")} disabled={!canManage} />
      <Prop label={tc("group")} serviceId={service.id} field="groupId" value={service.groupId} options={teamOpts} searchable placeholder={t("noGroup")} disabled={!canManage} />
      <Prop label={t("sla")} serviceId={service.id} field="slaId" value={service.slaId} options={slaOpts} searchable placeholder={t("noSlaOption")} disabled={!canManage} />
    </div>
  );
}
