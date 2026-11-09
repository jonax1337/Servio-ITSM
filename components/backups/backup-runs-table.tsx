import { History } from "lucide-react";
import { BACKUP_RUN_STATUS_META, BACKUP_TRIGGER_META } from "@/lib/constants";
import { formatBytes } from "@/lib/attachments-ui";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { LocalTime } from "@/components/local-time";
import { localDateTime } from "@/components/backups/local-date-time";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getFormatter, getT } from "@/lib/i18n/server";

export type BackupRunRow = {
  id: string;
  status: string;
  trigger: string;
  startedAt: Date;
  finishedAt: Date | null;
  name: string | null;
  databaseBytes: number | null;
  uploadsBytes: number | null;
  uploadsFiles: number | null;
  error: string | null;
  details: string;
  prunedAt: Date | null;
  triggeredBy: { name: string | null; email: string } | null;
};

function warningsOf(details: string): string[] {
  try {
    const parsed = JSON.parse(details) as { warnings?: unknown };
    return Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [];
  } catch {
    return [];
  }
}

/** The recent backup runs: when, how, result, sizes and what became of the files. */
export async function BackupRunsTable({ runs }: { runs: BackupRunRow[] }) {
  const [t, tc, f] = await Promise.all([getT("settings"), getT("common"), getFormatter()]);
  if (runs.length === 0) {
    return <EmptyState icon={History} title={t("backups.noRuns")} description={t("backups.noRunsDescription")} />;
  }
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>{t("backups.colStarted")}</TableHead>
            <TableHead>{tc("status")}</TableHead>
            <TableHead>{t("backups.colDuration")}</TableHead>
            <TableHead>{t("backups.colSize")}</TableHead>
            <TableHead>{t("backups.colBackup")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => {
            const warnings = warningsOf(run.details);
            const size = run.databaseBytes !== null || run.uploadsBytes !== null ? (run.databaseBytes ?? 0) + (run.uploadsBytes ?? 0) : null;
            return (
              <TableRow key={run.id}>
                <TableCell className="min-w-44 whitespace-normal">
                  <p className="text-sm tabular-nums">
                    <LocalTime date={run.startedAt} render={localDateTime} />
                  </p>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <StatusBadge map={BACKUP_TRIGGER_META} value={run.trigger} dot={false} />
                    {run.triggeredBy ? <span className="truncate">{run.triggeredBy.name ?? run.triggeredBy.email}</span> : null}
                  </div>
                </TableCell>
                <TableCell className="max-w-96 whitespace-normal">
                  <StatusBadge map={BACKUP_RUN_STATUS_META} value={run.status} />
                  {run.error ? (
                    <p className="mt-1 line-clamp-3 text-xs text-destructive" title={run.error}>
                      {run.error}
                    </p>
                  ) : null}
                  {warnings.length > 0 ? (
                    <p className="mt-1 line-clamp-2 text-xs text-amber-600 dark:text-amber-400" title={warnings.join("\n")}>
                      {warnings[0]}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell className="text-sm tabular-nums text-muted-foreground">
                  {run.finishedAt ? f.distance(run.startedAt, run.finishedAt) : "—"}
                </TableCell>
                <TableCell className="text-sm tabular-nums">
                  {size !== null ? formatBytes(size) : "—"}
                  {run.uploadsFiles !== null ? (
                    <p className="text-xs text-muted-foreground">{t("backups.files", { count: run.uploadsFiles })}</p>
                  ) : null}
                </TableCell>
                <TableCell className="max-w-72 whitespace-normal">
                  {run.name ? <p className="truncate font-mono text-xs">{run.name}</p> : <span className="text-muted-foreground">—</span>}
                  {run.prunedAt ? <p className="text-xs text-muted-foreground">{t("backups.pruned")}</p> : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
