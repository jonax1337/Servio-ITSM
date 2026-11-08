"use client";

import { useTransition } from "react";
import { Hand, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { joinStatusIncident } from "@/lib/actions/portal-status";
import { useServerMessage, useT } from "@/lib/i18n/client";

/** "This affects me too": tells the service desk on the incident's ticket instead of filing a duplicate. */
export function AffectsMeButton({ incidentId }: { incidentId: string }) {
  const [pending, startTransition] = useTransition();
  const t = useT("status");
  const tc = useT("common");
  const tm = useServerMessage();

  const join = () => {
    const formData = new FormData();
    formData.set("incidentId", incidentId);
    startTransition(async () => {
      const result = await joinStatusIncident(formData);
      if (result.ok) toast.success(t("affectsMeThanks"));
      else toast.error(result.error ? tm(result.error) : tc("somethingWentWrong"));
    });
  };

  return (
    <Button type="button" size="sm" variant="outline" onClick={join} disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Hand className="size-4" />}
      {t("affectsMeToo")}
    </Button>
  );
}
