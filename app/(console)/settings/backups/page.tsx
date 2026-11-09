import type { Metadata } from "next";
import { CalendarClock, DatabaseBackup, ExternalLink, HardDrive, ShieldCheck, TriangleAlert } from "lucide-react";
import { requireRole } from "@/lib/session";
import { BACKUP_RUN_STATUS_META } from "@/lib/constants";
import { backupOverview, backupsOnDisk } from "@/lib/backup";
import { BACKUP_SETTING } from "@/lib/backup-rules";
import { formatBytes } from "@/lib/attachments-ui";
import { saveBackupSettings } from "@/lib/actions/settings";
import { PageBody, PageHeader } from "@/components/page-header";
import { SettingsForm } from "@/components/settings/settings-form";
import { StatusBadge } from "@/components/status-badge";
import { LocalTime, timeAgo } from "@/components/local-time";
import { localDateTime } from "@/components/backups/local-date-time";
import { BackupNowButton } from "@/components/backups/backup-now-button";
import { BackupAutoRefresh } from "@/components/backups/backup-auto-refresh";
import { BackupRunsTable } from "@/components/backups/backup-runs-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("settings");
  return { title: t("backups.metaTitle") };
}
export const dynamic = "force-dynamic";

const BACKUP_GUIDE_URL = "https://github.com/jonax1337/Servio-ITSM/blob/main/docs/backup.md";

export default async function BackupsPage() {
  await requireRole("ADMIN");
  const now = new Date();
  const [t, { config, latest, lastSuccess, runs, nextRunAt }] = await Promise.all([getT("settings"), backupOverview(now)]);
  const disk = await backupsOnDisk(config.backupDir);
  const running = runs.some((run) => run.status === "RUNNING");
  const lastSize = lastSuccess ? (lastSuccess.databaseBytes ?? 0) + (lastSuccess.uploadsBytes ?? 0) : null;

  return (
    <>
      <PageHeader icon={DatabaseBackup} title={t("backups.title")} description={t("backups.description")}>
        <BackupNowButton running={running} disabled={!config.supported} />
      </PageHeader>

      <PageBody className="grid max-w-5xl gap-8">
        {running ? <BackupAutoRefresh /> : null}

        {!config.supported ? (
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
            <p>{t("backups.unsupported")}</p>
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex-row items-center gap-2">
              <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />
              <CardTitle>{t("backups.lastBackup")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-1.5 text-sm">
              {latest ? (
                <>
                  <div>
                    <StatusBadge map={BACKUP_RUN_STATUS_META} value={latest.status} />
                  </div>
                  <p className="text-muted-foreground">
                    {t("backups.startedAt")} <LocalTime date={latest.startedAt} render={timeAgo} />
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">{t("backups.never")}</p>
              )}
              {lastSuccess?.finishedAt ? (
                <p className="text-muted-foreground">
                  {t("backups.lastVerified")} <LocalTime date={lastSuccess.finishedAt} render={timeAgo} />
                  {lastSize !== null ? ` · ${formatBytes(lastSize)}` : ""}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center gap-2">
              <CalendarClock className="size-4 text-muted-foreground" aria-hidden />
              <CardTitle>{t("backups.schedule")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-1.5 text-sm">
              {!config.enabled || !config.supported ? (
                <p className="font-medium">{t("backups.scheduleOff")}</p>
              ) : !config.cron ? (
                <p className="font-medium text-destructive">{t("backups.scheduleInvalid", { schedule: config.schedule })}</p>
              ) : (
                <>
                  <p className="font-medium">
                    <span className="font-mono">{config.schedule}</span> <span className="text-muted-foreground">({config.timezone})</span>
                  </p>
                  {nextRunAt ? (
                    <p className="text-muted-foreground">
                      {t("backups.nextRun")} <LocalTime date={nextRunAt} render={localDateTime} />
                    </p>
                  ) : null}
                </>
              )}
              <p className="text-muted-foreground">{t("backups.retentionSummary", { count: config.keepCount, days: config.keepDays })}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center gap-2">
              <HardDrive className="size-4 text-muted-foreground" aria-hidden />
              <CardTitle>{t("backups.storage")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-1.5 text-sm">
              <p className="break-all font-mono text-xs">{config.backupDir}</p>
              <p className="text-muted-foreground">{t("backups.onDisk", { count: disk.count, size: formatBytes(disk.bytes) })}</p>
              <p className="text-muted-foreground">{config.uploadDir ? t("backups.uploadsIncluded") : t("backups.uploadsExcluded")}</p>
            </CardContent>
          </Card>
        </div>

        <section aria-labelledby="backup-runs" className="grid gap-3">
          <h2 id="backup-runs" className="font-display text-base font-semibold">
            {t("backups.runs")}
          </h2>
          <BackupRunsTable runs={runs} />
        </section>

        <section aria-labelledby="backup-settings" className="grid gap-3">
          <h2 id="backup-settings" className="font-display text-base font-semibold">
            {t("backups.settings")}
          </h2>
          <SettingsForm
            action={saveBackupSettings}
            fields={[
              {
                type: "switch",
                name: BACKUP_SETTING.enabled,
                label: t("backups.enabled"),
                defaultChecked: config.enabled,
                hint: t("backups.enabledHint"),
              },
              {
                type: "text",
                name: BACKUP_SETTING.schedule,
                label: t("backups.scheduleField"),
                defaultValue: config.schedule,
                placeholder: "02:30",
                hint: t("backups.scheduleHint"),
              },
              {
                type: "text",
                name: BACKUP_SETTING.timezone,
                label: t("backups.timezone"),
                defaultValue: config.timezone,
                placeholder: "UTC",
                hint: t("backups.timezoneHint"),
              },
              {
                type: "number",
                name: BACKUP_SETTING.keepCount,
                label: t("backups.keepCount"),
                defaultValue: String(config.keepCount),
                placeholder: "7",
              },
              {
                type: "number",
                name: BACKUP_SETTING.keepDays,
                label: t("backups.keepDays"),
                defaultValue: String(config.keepDays),
                placeholder: "14",
                hint: t("backups.retentionHint"),
              },
              {
                type: "switch",
                name: BACKUP_SETTING.includeUploads,
                label: t("backups.includeUploads"),
                defaultChecked: config.includeUploads,
                hint: t("backups.includeUploadsHint"),
              },
            ]}
          />
        </section>

        <section aria-labelledby="backup-restore" className="grid gap-3">
          <h2 id="backup-restore" className="font-display text-base font-semibold">
            {t("backups.restore")}
          </h2>
          <div className="grid gap-2 rounded-xl border bg-card p-5 text-sm">
            <p>{t("backups.restoreText")}</p>
            <pre className="overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs">node scripts/restore-backup.mjs --list{"\n"}node scripts/restore-backup.mjs latest --dry-run</pre>
            <p className="text-muted-foreground">{t("backups.noDownload")}</p>
            <a
              href={BACKUP_GUIDE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              {t("backups.restoreGuide")} <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </div>
        </section>
      </PageBody>
    </>
  );
}
