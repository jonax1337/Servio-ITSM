"use client";

import { Ban, OctagonX, Play, Square } from "lucide-react";
import { abortMaintenance, cancelMaintenance, endMaintenanceNow, startMaintenanceNow } from "@/lib/actions/maintenance";
import { ConfirmButton } from "@/components/confirm-dialog";
import { WindowLogDialog } from "@/components/maintenance/window-log-dialog";
import { isAbortable, type UpdaterLogEntry } from "@/lib/maintenance-rules";

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
  return (
    <div className="flex items-center justify-end gap-1.5">
      {window.log.length > 0 || window.result ? <WindowLogDialog title={title} result={window.result} log={window.log} /> : null}
      {status === "SCHEDULED" ? (
        <>
          <ConfirmButton
            action={startMaintenanceNow}
            fields={{ id }}
            successMessage="Maintenance started"
            title="Start now"
            description={`Start "${title}" immediately? Users lose access right away${kind === "UPDATE" ? " and the update begins" : ""}.`}
            confirmLabel="Start now"
            confirmVariant="default"
            triggerVariant="outline"
            triggerSize="sm"
            triggerClassName="gap-1"
          >
            <Play className="size-3.5" /> Start now
          </ConfirmButton>
          <ConfirmButton
            action={cancelMaintenance}
            fields={{ id }}
            successMessage="Maintenance cancelled"
            title="Cancel maintenance"
            description={`Cancel "${title}"? Users are no longer warned about it.`}
            confirmLabel="Cancel window"
            triggerVariant="outline"
            triggerSize="icon-sm"
            triggerLabel={`Cancel ${title}`}
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
          successMessage="Maintenance ended"
          title="End maintenance"
          description={`End "${title}" now? Users get access back.`}
          confirmLabel="End now"
          confirmVariant="default"
          triggerVariant="outline"
          triggerSize="sm"
          triggerClassName="gap-1"
        >
          <Square className="size-3.5" /> End now
        </ConfirmButton>
      ) : null}
      {isAbortable(window) ? (
        <ConfirmButton
          action={abortMaintenance}
          fields={{ id }}
          successMessage="Update aborted"
          title="Abort update"
          description={`Mark "${title}" as failed and give users access back. This does not stop the updater: it may still be running and the container may be mid-switch. Check the updater's log first, and only abort when it is stuck or gone.`}
          confirmLabel="Abort update"
          triggerVariant="outline"
          triggerSize="sm"
          triggerClassName="gap-1 text-muted-foreground hover:border-destructive/40 hover:text-destructive"
        >
          <OctagonX className="size-3.5" /> Abort
        </ConfirmButton>
      ) : null}
    </div>
  );
}
