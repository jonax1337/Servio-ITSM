"use client";

import { useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { checkForUpdatesNow } from "@/lib/actions/maintenance";
import { Button } from "@/components/ui/button";
import { useServerMessage, useT } from "@/lib/i18n/client";

/** Ask GitHub for new releases right now (the schedule checks every six hours). */
export function CheckUpdatesButton() {
  const [pending, startTransition] = useTransition();
  const t = useT("maintenance");
  const tm = useServerMessage();

  const check = () =>
    startTransition(async () => {
      const res = await checkForUpdatesNow();
      if (res.ok) toast.success(t("checkedForUpdates"));
      else toast.error(res.error ? tm(res.error) : t("checkFailed"));
    });

  return (
    <Button variant="outline" size="sm" onClick={check} disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} {t("checkNow")}
    </Button>
  );
}
