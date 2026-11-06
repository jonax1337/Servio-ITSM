"use client";

import { useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { checkForUpdatesNow } from "@/lib/actions/maintenance";
import { Button } from "@/components/ui/button";

/** Ask GitHub for new releases right now (the schedule checks every six hours). */
export function CheckUpdatesButton() {
  const [pending, startTransition] = useTransition();

  const check = () =>
    startTransition(async () => {
      const res = await checkForUpdatesNow();
      if (res.ok) toast.success("Checked for updates");
      else toast.error(res.error ?? "The update check failed.");
    });

  return (
    <Button variant="outline" size="sm" onClick={check} disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Check now
    </Button>
  );
}
