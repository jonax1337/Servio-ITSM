import type { Metadata } from "next";
import { format, formatDistanceToNowStrict } from "date-fns";
import { ArrowUpCircle, ExternalLink, PackageCheck, Server } from "lucide-react";
import { requireRole } from "@/lib/session";
import { APP_VERSION } from "@/lib/constants";
import { getBoolSetting, getSetting } from "@/lib/settings";
import { renderMarkdown } from "@/lib/markdown";
import { readUpdaterHeartbeat, listWindowsForAdmin } from "@/lib/maintenance";
import { heartbeatFresh, parseWindowLog, WINDOW_ERRORS } from "@/lib/maintenance-rules";
import { DEFAULT_UPDATE_REPOSITORY, readUpdateState } from "@/lib/updates";
import { saveUpdateSettings } from "@/lib/actions/settings";
import { PageBody, PageHeader } from "@/components/page-header";
import { SettingsForm } from "@/components/settings/settings-form";
import { CheckUpdatesButton } from "@/components/maintenance/check-updates-button";
import { ScheduleWindowDialog } from "@/components/maintenance/schedule-window-dialog";
import { WindowsTable } from "@/components/maintenance/windows-table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AvailableRelease } from "@/lib/update-rules";

export const metadata: Metadata = { title: "Updates & maintenance" };
export const dynamic = "force-dynamic";

const UPDATE_GUIDE_URL = "https://github.com/jonax1337/Servio-ITSM/blob/main/docs/updates.md";

function UpdaterStatusCard({ connected, lastSeen }: { connected: boolean; lastSeen: Date | null }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-2">
        <Server className="size-4 text-muted-foreground" aria-hidden />
        <CardTitle>Updater</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-1 text-sm">
        <p className="flex items-center gap-2 font-medium">
          <span className={`size-2 rounded-full ${connected ? "bg-emerald-500" : "bg-amber-500"}`} aria-hidden />
          {connected ? "Connected" : lastSeen ? "Not responding" : "Not detected"}
        </p>
        {lastSeen ? (
          <p className="text-muted-foreground">Last heartbeat {formatDistanceToNowStrict(lastSeen, { addSuffix: true })}.</p>
        ) : null}
        {connected ? null : (
          <p className="text-muted-foreground">
            Updates run through a separate updater service. See the{" "}
            <a href={UPDATE_GUIDE_URL} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              update guide
            </a>{" "}
            to set it up. Planned maintenance without an update works without it.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ReleaseCard({ release, disabledReason }: { release: AvailableRelease; disabledReason: string | null }) {
  const notes = release.notes ? renderMarkdown(release.notes) : null;
  return (
    <article className="grid gap-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-0.5">
          <h3 className="font-display font-semibold">
            {release.name}
            {release.prerelease ? <span className="ml-2 text-xs font-normal text-muted-foreground">pre-release</span> : null}
          </h3>
          <p className="text-xs text-muted-foreground">
            {release.publishedAt ? `Published ${format(new Date(release.publishedAt), "PP")}` : "Publication date unknown"}
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
          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">Release notes</summary>
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
}: {
  state: Awaited<ReturnType<typeof readUpdateState>>;
  disabledReason: string | null;
}) {
  const emptyMessage = !state.checkedAt
    ? "Not checked yet. Use Check now to look for new releases."
    : state.publishedCount === 0
      ? "No releases published yet."
      : `You're up to date (version ${APP_VERSION}).`;
  return (
    <section aria-labelledby="available-updates" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="available-updates" className="font-display text-base font-semibold">
            Available updates
          </h2>
          {state.checkedAt ? (
            <p className="text-xs text-muted-foreground">
              Last checked {formatDistanceToNowStrict(new Date(state.checkedAt), { addSuffix: true })}.
            </p>
          ) : null}
        </div>
        <CheckUpdatesButton />
      </div>
      {state.releases.length === 0 ? (
        <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        state.releases.map((release) => <ReleaseCard key={release.version} release={release} disabledReason={disabledReason} />)
      )}
    </section>
  );
}

export default async function UpdatesPage() {
  await requireRole("ADMIN");
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
        title="Updates & maintenance"
        description="Update Servio and plan maintenance windows. Users are warned ahead of time."
      >
        <ScheduleWindowDialog target={{ kind: "GENERAL" }} />
      </PageHeader>

      <PageBody className="grid max-w-4xl gap-8">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="flex-row items-center gap-2">
              <PackageCheck className="size-4 text-muted-foreground" aria-hidden />
              <CardTitle>Installed version</CardTitle>
            </CardHeader>
            <CardContent className="font-mono text-2xl font-semibold">{APP_VERSION}</CardContent>
          </Card>
          <UpdaterStatusCard connected={connected} lastSeen={heartbeat ? new Date(heartbeat.at) : null} />
        </div>

        <AvailableUpdates state={state} disabledReason={connected ? null : WINDOW_ERRORS.updaterOffline} />

        <section aria-labelledby="maintenance-windows" className="grid gap-3">
          <h2 id="maintenance-windows" className="font-display text-base font-semibold">
            Maintenance windows
          </h2>
          <WindowsTable
            windows={windows.map((w) => ({ ...w, log: parseWindowLog(w.log) }))}
          />
        </section>

        <section aria-labelledby="update-settings" className="grid gap-3">
          <h2 id="update-settings" className="font-display text-base font-semibold">
            Update checks
          </h2>
          <SettingsForm
            action={saveUpdateSettings}
            fields={[
              {
                type: "switch",
                name: "UPDATE_CHECK_ENABLED",
                label: "Check for new releases",
                defaultChecked: checkEnabled,
                hint: "Checks GitHub every six hours and notifies the admins once per new version.",
              },
              {
                type: "text",
                name: "UPDATE_REPOSITORY",
                label: "GitHub repository",
                defaultValue: repository ?? DEFAULT_UPDATE_REPOSITORY,
                placeholder: DEFAULT_UPDATE_REPOSITORY,
                hint: "owner/name of the repository whose releases are offered.",
              },
              {
                type: "switch",
                name: "UPDATE_INCLUDE_PRERELEASES",
                label: "Include pre-releases",
                defaultChecked: prereleases,
              },
            ]}
          />
        </section>
      </PageBody>
    </>
  );
}
