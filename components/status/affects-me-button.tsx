"use client";

import { useTransition } from "react";
import { Hand, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { joinStatusIncident } from "@/lib/actions/portal-status";

/** "This affects me too": tells the service desk on the incident's ticket instead of filing a duplicate. */
export function AffectsMeButton({ incidentId }: { incidentId: string }) {
  const [pending, startTransition] = useTransition();

  const join = () => {
    const formData = new FormData();
    formData.set("incidentId", incidentId);
    startTransition(async () => {
      const result = await joinStatusIncident(formData);
      if (result.ok) toast.success("Thanks, we've noted that this affects you too. Follow progress on this page.");
      else toast.error(result.error ?? "Something went wrong.");
    });
  };

  return (
    <Button type="button" size="sm" variant="outline" onClick={join} disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Hand className="size-4" />}
      This affects me too
    </Button>
  );
}
