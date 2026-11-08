"use client";

import { useTransition } from "react";
import { Switch } from "@/components/ui/switch";
import { toggleRule } from "@/lib/actions/automations";
import { useT } from "@/lib/i18n/client";

export function ToggleRuleSwitch({ id, active }: { id: string; active: boolean }) {
  const [pending, start] = useTransition();
  const t = useT("automations");
  return (
    <Switch
      checked={active}
      disabled={pending}
      aria-label={t("toggleRule")}
      onCheckedChange={() => {
        const fd = new FormData();
        fd.set("id", id);
        start(() => toggleRule(fd));
      }}
    />
  );
}
