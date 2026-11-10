import type { Metadata } from "next";
import { formatDistanceToNowStrict } from "date-fns";
import { ArrowUpCircle, ExternalLink, PackageCheck, Server } from "lucide-react";
import { requireRole } from "@/lib/session";
import { APP_VERSION } from "@/lib/constants";
import { getBoolSetting, getSetting } from "@/lib/settings";
import { renderMarkdown } from "@/lib/markdown";
import { readUpdaterHeartbeat, listWindowsForAdmin } from "@/lib/maintenance";
import { heartbeatFresh, parseWindowLog, WINDOW_ERRORS, type UpdaterHeartbeat } from "@/lib/maintenance-rules";
import { DEFAULT_UPDATE_REPOSITORY, readUpdateState } from "@/lib/updates";
import { saveUpdateSettings } from "@/lib/actions/settings";
import { PageBody, PageHeader } from "@/components/page-header";
import { SettingsForm } from "@/components/settings/settings-form";
import { CheckUpdatesButton } from "@/components/maintenance/check-updates-button";
import { ScheduleWindowDialog } from "@/components/maintenance/schedule-window-dialog";
import { WindowsTable } from "@/components/maintenance/windows-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AvailableRelease } from "@/lib/update-rules";
import { getFormatter, getT } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translate";
import type { Formatter } from "@/lib/i18n/format";

type I18n = { t: Translator<"settings">; f: Formatter };
const ago = (d: Date, f: Formatter) => formatDistanceToNowStrict(d, { addSuffix: true, locale: f.dateFnsLocale });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("settings");
  return { title: t("updates.metaTitle") };
}
export const dynamic = "force-dynamic";

const UPDATE_GUIDE_URL = "https://github.com/jonax1337/Servio-ITSM/blob/main/docs/updates.md";

function UpdaterStatusCard({ connected, heartbeat, i18n: { t, f } }: { connected: boolean; heartbeat: UpdaterHeartbeat | null; i18n: I18n }) {
  const lastSeen = heartbeat ? new Date(heartbeat.at) : null;
  const selfUpdate = heartbeat?.selfUpdate ?? null;
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2">
        <Server className="size-4 text-muted-foreground" aria-hidden />
        <CardTitle>{t("updates.updater")}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-1 text-sm">
        <p className="flex items-center gap-2 font-medium">
          <span className={`size-2 rounded-full ${connected ? "bg-emerald-500" : "bg-amber-500"}`} aria-hidden />
          {connected ? t("updates.connected") : lastSeen ? t("updates.notResponding") : t("updates.notDetected")}
        </p>
        {lastSeen ? (
          <p className="text-muted-foreground">{t("updates.lastHeartbeat", { when: ago(lastSeen, f) })}</p>
        ) : null}
        {heartbeat && heartbeat.updaterVersion !== "unknown" ? (
          <p className="font-mono text-xs text-muted-foreground">{t("updates.updaterVersion", { version: heartbeat.updaterVersion })}</p>
        ) : null}
        {selfUpdate ? (
          <div className="grid gap-0.5">
            <p className="text-muted-foreground">
              {t(`updates.selfUpdate.${selfUpdate.state}`, {
                from: selfUpdate.fromVersion,
                to: selfUpdate.targetVersion,
                when: ago(new Date(selfUpdate.at), f),
              })}
            </p>
            {/* The updater's own wording, as in the window log: why it did not complete. */}
            {selfUpdate.state === "SUCCEEDED" ? null : <p className="text-xs text-muted-foreground">{selfUpdate.message}</p>}
          </div>
        ) : null}
        {connected ? null : (
          <p className="text-muted-foreground">
            {t.rich("updates.updaterHint", {
              link: (c) => (
                <a href={UPDATE_GUIDE_URL} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                  {c}
                </a>
              ),
            })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ReleaseCard({ release, disabledReason, i18n: { t, f } }: { release: AvailableRelease; disabledReason: string | null; i18n: I18n }) {
  const notes = release.notes ? renderMarkdown(release.notes) : null;
  return (
    <article className="grid gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-0.5">
          <h3 className="font-display font-semibold">
            {release.name}
            {release.prerelease ? <span className="ml-2 text-xs font-normal text-muted-foreground">{t("updates.preRelease")}</span> : null}
          </h3>
          <p className="text-xs text-muted-foreground">
            {release.publishedAt ? t("updates.published", { date: f.date(release.publishedAt) }) : t("updates.publishedUnknown")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {release.url ? (
            <a
              href={release.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              GitHub <ExternalLink className="size-3.5" aria-hidden />
            </a>
          ) : null}
          <ScheduleWindowDialog target={{ kind: "UPDATE", version: release.version }} disabledReason={disabledReason} />
        </div>
      </div>
      {notes ? (
        <details className="group">
          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">{t("updates.releaseNotes")}</summary>
          <div
            className="prose prose-sm mt-3 max-w-none dark:prose-invert prose-headings:font-display"
            dangerouslySetInnerHTML={{ __html: notes }}
          />
        </details>
      ) : null}
    </article>
  );
}

function AvailableUpdates({
  state,
  disabledReason,
  i18n,
}: {
  state: Awaited<ReturnType<typeof readUpdateState>>;
  disabledReason: string | null;
  i18n: I18n;
}) {
  const { t, f } = i18n;
  const emptyMessage = !state.checkedAt
    ? t("updates.notChecked")
    : state.publishedCount === 0
      ? t("updates.noReleases")
      : t("updates.upToDate", { version: APP_VERSION });
  return (
    <section aria-labelledby="available-updates" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="available-updates" className="font-display text-base font-semibold">
            {t("updates.available")}
          </h2>
          {state.checkedAt ? (
            <p className="text-xs text-muted-foreground">
              {t("updates.lastChecked", { when: ago(new Date(state.checkedAt), f) })}
            </p>
          ) : null}
        </div>
        <CheckUpdatesButton />
      </div>
      {state.releases.length === 0 ? (
        <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        state.releases.map((release) => <ReleaseCard key={release.version} release={release} disabledReason={disabledReason} i18n={i18n} />)
      )}
    </section>
  );
}

export default async function UpdatesPage() {
  await requireRole("ADMIN");
  const [t, f] = await Promise.all([getT("settings"), getFormatter()]);
  const i18n: I18n = { t, f };
  const now = new Date();
  const heartbeat = readUpdaterHeartbeat();
  const connected = heartbeatFresh(heartbeat, now);
  const [state, windows, checkEnabled, repository, prereleases] = await Promise.all([
    readUpdateState(),
    listWindowsForAdmin(),
    getBoolSetting("UPDATE_CHECK_ENABLED", true),
    getSetting("UPDATE_REPOSITORY", DEFAULT_UPDATE_REPOSITORY),
    getBoolSetting("UPDATE_INCLUDE_PRERELEASES", false),
  ]);

  return (
    <>
      <PageHeader
        icon={ArrowUpCircle}
        title={t("updates.title")}
        description={t("updates.description")}
      >
        <ScheduleWindowDialog target={{ kind: "GENERAL" }} />
      </PageHeader>

      <PageBody className="grid max-w-4xl gap-8">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="flex-row items-center gap-2">
              <PackageCheck className="size-4 text-muted-foreground" aria-hidden />
              <CardTitle>{t("updates.installed")}</CardTitle>
            </CardHeader>
            <CardContent className="font-mono text-2xl font-semibold">{APP_VERSION}</CardContent>
          </Card>
          <UpdaterStatusCard connected={connected} heartbeat={heartbeat} i18n={i18n} />
        </div>

        <AvailableUpdates state={state} disabledReason={connected ? null : WINDOW_ERRORS.updaterOffline} i18n={i18n} />

        <section aria-labelledby="maintenance-windows" className="grid gap-3">
          <h2 id="maintenance-windows" className="font-display text-base font-semibold">
            {t("updates.windows")}
          </h2>
          <WindowsTable
            windows={windows.map((w) => ({ ...w, log: parseWindowLog(w.log) }))}
          />
        </section>

        <section aria-labelledby="update-settings" className="grid gap-3">
          <h2 id="update-settings" className="font-display text-base font-semibold">
            {t("updates.checks")}
          </h2>
          <SettingsForm
            action={saveUpdateSettings}
            fields={[
              {
                type: "switch",
                name: "UPDATE_CHECK_ENABLED",
                label: t("updates.checkEnabled"),
                defaultChecked: checkEnabled,
                hint: t("updates.checkEnabledHint"),
              },
              {
                type: "text",
                name: "UPDATE_REPOSITORY",
                label: t("updates.repository"),
                defaultValue: repository ?? DEFAULT_UPDATE_REPOSITORY,
                placeholder: DEFAULT_UPDATE_REPOSITORY,
                hint: t("updates.repositoryHint"),
              },
              {
                type: "switch",
                name: "UPDATE_INCLUDE_PRERELEASES",
                label: t("updates.prereleases"),
                defaultChecked: prereleases,
              },
            ]}
          />
        </section>
      </PageBody>
    </>
  );
}
