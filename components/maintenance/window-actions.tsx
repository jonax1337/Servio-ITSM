"use client";

import { Ban, OctagonX, Play, Square } from "lucide-react";
import { abortMaintenance, cancelMaintenance, endMaintenanceNow, startMaintenanceNow } from "@/lib/actions/maintenance";
import { ConfirmButton } from "@/components/confirm-dialog";
import { WindowLogDialog } from "@/components/maintenance/window-log-dialog";
import { isAbortable, type UpdaterLogEntry } from "@/lib/maintenance-rules";
import { useT } from "@/lib/i18n/client";

export type ManagedWindow = {
  id: string;
  title: string;
  kind: string;
  status: string;
  result: string | null;
  log: UpdaterLogEntry[];
};

/** Row actions of a maintenance window: start early, cancel, end now (general windows), abort (stuck updates) and the updater log. */
export function WindowActions({ window }: { window: ManagedWindow }) {
  const { id, title, kind, status } = window;
  const t = useT("maintenance");
  return (
    <div className="flex items-center justify-end gap-1.5">
      {window.log.length > 0 || window.result ? <WindowLogDialog title={title} result={window.result} log={window.log} /> : null}
      {status === "SCHEDULED" ? (
        <>
          <ConfirmButton
            action={startMaintenanceNow}
            fields={{ id }}
            successMessage={t("maintenanceStarted")}
            title={t("startNow")}
            description={kind === "UPDATE" ? t("startNowUpdateDescription", { title }) : t("startNowDescription", { title })}
            confirmLabel={t("startNow")}
            confirmVariant="default"
            triggerVariant="outline"
            triggerSize="sm"
            triggerClassName="gap-1"
          >
            <Play className="size-3.5" /> {t("startNow")}
          </ConfirmButton>
          <ConfirmButton
            action={cancelMaintenance}
            fields={{ id }}
            successMessage={t("cancelled")}
            title={t("cancelMaintenance")}
            description={t("cancelDescription", { title })}
            confirmLabel={t("cancelWindow")}
            triggerVariant="outline"
            triggerSize="icon-sm"
            triggerLabel={t("cancelTitle", { title })}
            triggerClassName="text-muted-foreground hover:border-destructive/40 hover:text-destructive"
          >
            <Ban className="size-4" />
          </ConfirmButton>
        </>
      ) : null}
      {status === "IN_PROGRESS" && kind === "GENERAL" ? (
        <ConfirmButton
          action={endMaintenanceNow}
          fields={{ id }}
          successMessage={t("ended")}
          title={t("endMaintenance")}
          description={t("endDescription", { title })}
          confirmLabel={t("endNow")}
          confirmVariant="default"
          triggerVariant="outline"
          triggerSize="sm"
          triggerClassName="gap-1"
        >
          <Square className="size-3.5" /> {t("endNow")}
        </ConfirmButton>
      ) : null}
      {isAbortable(window) ? (
        <ConfirmButton
          action={abortMaintenance}
          fields={{ id }}
          successMessage={t("aborted")}
          title={t("abortUpdate")}
          description={t("abortDescription", { title })}
          confirmLabel={t("abortUpdate")}
          triggerVariant="outline"
          triggerSize="sm"
          triggerClassName="gap-1 text-muted-foreground hover:border-destructive/40 hover:text-destructive"
        >
          <OctagonX className="size-3.5" /> {t("abort")}
        </ConfirmButton>
      ) : null}
    </div>
  );
}
