import { Wrench } from "lucide-react";
import { MAINTENANCE_KIND_META, MAINTENANCE_STATUS_META, type MaintenanceKind } from "@/lib/constants";
import type { UpdaterLogEntry } from "@/lib/maintenance-rules";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { WindowActions } from "@/components/maintenance/window-actions";
import { LocalPeriod } from "@/components/maintenance/local-period";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getT } from "@/lib/i18n/server";

export type WindowRow = {
  id: string;
  title: string;
  kind: string;
  status: string;
  startsAt: Date;
  endsAt: Date;
  fromVersion: string | null;
  targetVersion: string | null;
  result: string | null;
  log: UpdaterLogEntry[];
};

function versionLabel(window: WindowRow): string {
  if (window.kind !== "UPDATE") return "";
  return `${window.fromVersion ?? "?"} → ${window.targetVersion ?? "?"}`;
}

/** Upcoming, running and recently finished maintenance windows with their row actions. */
export async function WindowsTable({ windows }: { windows: WindowRow[] }) {
  const [t, tc] = await Promise.all([getT("maintenance"), getT("common")]);
  if (windows.length === 0) {
    return (
      <EmptyState
        icon={Wrench}
        title={t("noWindows")}
        description={t("noWindowsDescription")}
      />
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>{t("colWindow")}</TableHead>
            <TableHead>{t("colWhen")}</TableHead>
            <TableHead>{tc("status")}</TableHead>
            <TableHead className="text-right">{tc("actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {windows.map((window) => (
            <TableRow key={window.id}>
              <TableCell className="max-w-72">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{window.title}</span>
                  <StatusBadge map={MAINTENANCE_KIND_META} value={window.kind as MaintenanceKind} dot={false} />
                </div>
                {versionLabel(window) ? <p className="font-mono text-xs text-muted-foreground">{versionLabel(window)}</p> : null}
              </TableCell>
              <TableCell className="min-w-44 whitespace-normal text-xs text-muted-foreground">
                <LocalPeriod startsAt={window.startsAt.toISOString()} endsAt={window.endsAt.toISOString()} />
              </TableCell>
              <TableCell>
                <StatusBadge map={MAINTENANCE_STATUS_META} value={window.status} />
              </TableCell>
              <TableCell>
                <WindowActions window={window} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
