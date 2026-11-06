"use client";

import { useTransition } from "react";
import { Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { linkTicket } from "@/lib/actions/tickets";
import { Button } from "@/components/ui/button";

/** Links two tickets as RELATED, reporting the action's refusal as a toast. */
export function LinkRelatedButton({ ticketId, targetId }: { ticketId: number; targetId: number }) {
  const [pending, startTransition] = useTransition();

  const link = () => {
    const formData = new FormData();
    formData.set("id", String(ticketId));
    formData.set("targetId", String(targetId));
    formData.set("type", "RELATED");
    startTransition(async () => {
      const result = await linkTicket(formData);
      if (result.ok) toast.success("Linked as related.");
      else toast.error(result.error || "Could not link the tickets.");
    });
  };

  return (
    <Button type="button" variant="outline" size="sm" onClick={link} disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <Link2 />}
      Link as related
    </Button>
  );
}
