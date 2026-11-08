"use client";

import { useTransition } from "react";
import { setGroupAutoAssign } from "@/lib/actions/groups";
import { Combobox, type ComboOption } from "@/components/combobox";
import { AUTO_ASSIGN_STRATEGIES, AUTO_ASSIGN_META } from "@/lib/constants";
import { useEnumT } from "@/lib/i18n/client";

export function AutoAssignControl({ groupId, value }: { groupId: string; value: string }) {
  const [pending, start] = useTransition();
  const te = useEnumT();
  const opts: ComboOption[] = AUTO_ASSIGN_STRATEGIES.map((s) => ({
    value: s,
    label: te(AUTO_ASSIGN_META[s]),
    tone: AUTO_ASSIGN_META[s].tone,
  }));
  return (
    <Combobox
      options={opts}
      value={value}
      pending={pending}
      onChange={(v) => {
        const fd = new FormData();
        fd.set("id", groupId);
        fd.set("autoAssign", v);
        start(() => setGroupAutoAssign(fd));
      }}
    />
  );
}
