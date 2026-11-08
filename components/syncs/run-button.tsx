"use client";

import { useFormStatus } from "react-dom";
import { RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { runSync } from "@/lib/actions/syncs";
import { Button } from "@/components/ui/button";
import { useServerMessage, useT } from "@/lib/i18n/client";

function SubmitButton({
  size,
  label,
}: {
  size: "sm" | "default";
  label: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size={size} variant="outline" disabled={pending}>
      {pending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <RefreshCw className="size-4" />
      )}
      {label}
    </Button>
  );
}

export function RunButton({
  sourceId,
  size = "sm",
  label,
}: {
  sourceId: string;
  size?: "sm" | "default";
  label?: string;
}) {
  const t = useT("syncs");
  const tm = useServerMessage();
  return (
    <form
      action={async (fd) => {
        const res = await runSync(fd);
        if (res.ok) toast.success(tm(res.message));
        else toast.error(tm(res.message));
      }}
    >
      <input type="hidden" name="sourceId" value={sourceId} />
      <SubmitButton size={size} label={label ?? t("runNow")} />
    </form>
  );
}
