"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { DatabaseBackup, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { backupNow } from "@/lib/actions/backup";
import { Button } from "@/components/ui/button";
import { useServerMessage, useT } from "@/lib/i18n/client";

/** Starts a backup right away; the page then refreshes itself until it is finished. */
export function BackupNowButton({ running, disabled }: { running: boolean; disabled?: boolean }) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const t = useT("settings");
  const tm = useServerMessage();

  const start = () =>
    startTransition(async () => {
      const res = await backupNow();
      if (res.ok) toast.success(t("backups.started"));
      else toast.error(res.error ? tm(res.error) : t("backups.startFailed"));
      router.refresh();
    });

  const busy = pending || running;
  return (
    <Button size="sm" onClick={start} disabled={busy || disabled}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <DatabaseBackup className="size-4" />}
      {running ? t("backups.running") : t("backups.backupNow")}
    </Button>
  );
}
