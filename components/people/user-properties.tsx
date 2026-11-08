"use client";

import { useTransition } from "react";
import { CircleCheck, Ban, Crown, User } from "lucide-react";
import { updateUserField } from "@/lib/actions/people";
import { Combobox, type ComboOption } from "@/components/combobox";
import { ROLES, ROLE_META } from "@/lib/constants";
import { useEnumT, useT } from "@/lib/i18n/client";

type Field = "role" | "isActive" | "isVip";

function Prop({
  label,
  userId,
  field,
  value,
  options,
}: {
  label: string;
  userId: string;
  field: Field;
  value: string;
  options: ComboOption[];
}) {
  const [pending, start] = useTransition();
  const t = useT("people");
  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Combobox
        options={options}
        value={value}
        pending={pending}
        searchPlaceholder={t("filter")}
        onChange={(v) => {
          const fd = new FormData();
          fd.set("id", userId);
          fd.set("field", field);
          fd.set("value", v);
          start(() => updateUserField(fd));
        }}
      />
    </div>
  );
}

export function UserProperties({
  user,
}: {
  user: { id: string; role: string; isActive: boolean; isVip: boolean };
}) {
  const t = useT("people");
  const te = useEnumT();
  const roleOpts: ComboOption[] = ROLES.map((r) => ({
    value: r,
    label: te(ROLE_META[r]),
    tone: ROLE_META[r].tone,
    icon: ROLE_META[r].icon,
  }));
  const statusOpts: ComboOption[] = [
    { value: "true", label: t("active"), tone: "success", icon: CircleCheck },
    { value: "false", label: t("inactive"), tone: "neutral", icon: Ban },
  ];
  const vipOpts: ComboOption[] = [
    { value: "true", label: t("vipPriority"), tone: "warning", icon: Crown },
    { value: "false", label: t("standard"), tone: "neutral", icon: User },
  ];

  return (
    <div className="grid gap-3">
      <Prop label={t("role")} userId={user.id} field="role" value={user.role} options={roleOpts} />
      <Prop
        label={t("status")}
        userId={user.id}
        field="isActive"
        value={user.isActive ? "true" : "false"}
        options={statusOpts}
      />
      <Prop
        label={t("vip")}
        userId={user.id}
        field="isVip"
        value={user.isVip ? "true" : "false"}
        options={vipOpts}
      />
    </div>
  );
}
