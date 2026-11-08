"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { toggleSyncActive } from "@/lib/actions/syncs";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/lib/i18n/client";

export function ToggleActive({
  sourceId,
  isActive,
}: {
  sourceId: string;
  isActive: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const t = useT("syncs");

  return (
    <Switch
      checked={isActive}
      disabled={pending}
      onCheckedChange={(checked) => {
        startTransition(async () => {
          const fd = new FormData();
          fd.set("sourceId", sourceId);
          fd.set("isActive", String(checked));
          await toggleSyncActive(fd);
          toast.success(checked ? t("activated") : t("pausedToast"));
        });
      }}
    />
  );
}
