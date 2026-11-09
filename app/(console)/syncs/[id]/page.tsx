import { canReadConsoleTitle } from "@/lib/metadata-access";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, RefreshCw, Clock, Settings2, Pencil } from "lucide-react";
import { db } from "@/lib/db";
import { hasRole, requireRole } from "@/lib/session";
import { LinkButton } from "@/components/link-button";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { RunButton } from "@/components/syncs/run-button";
import { ToggleActive } from "@/components/syncs/toggle-active";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SYNC_TYPE_META, SYNC_RUN_STATUS_META } from "@/lib/constants";
import { getFormatter, getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";


export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  if (!(await canReadConsoleTitle("MANAGER"))) return {};
  const { id } = await params;
  const s = await db.syncSource.findUnique({
    where: { id },
    select: { name: true },
  });
  return { title: s ? s.name : (await getT("syncs"))("detailMetaFallback") };
}

function parseConfig(raw: string): { entries: [string, string][]; error: boolean } {
  try {
    const obj = JSON.parse(raw) as unknown;
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      const entries: [string, string][] = [];
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        // Never render stored secrets.
        if (/password|secret|token/i.test(k)) {
          entries.push([k, v ? "••••••••" : "—"]);
          continue;
        }
        // Flatten the attribute map into readable rows.
        if (k === "attr" && v && typeof v === "object" && !Array.isArray(v)) {
          for (const [ak, av] of Object.entries(v as Record<string, unknown>)) {
            if (av) entries.push([`map.${ak}`, String(av)]);
          }
          continue;
        }
        entries.push([k, typeof v === "object" ? JSON.stringify(v) : String(v)]);
      }
      return { entries, error: false };
    }
    return { entries: [], error: false };
  } catch {
    return { entries: [], error: true };
  }
}

function duration(startedAt: Date, finishedAt: Date | null): string {
  if (!finishedAt) return "—";
  const secs = Math.max(
    0,
    Math.round((finishedAt.getTime() - startedAt.getTime()) / 1000),
  );
  return `${secs}s`;
}

export default async function SyncDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireRole("MANAGER");
  const { id } = await params;
  const [t, f] = await Promise.all([getT("syncs"), getFormatter()]);

  const source = await db.syncSource.findUnique({
    where: { id },
    include: { runs: { orderBy: { startedAt: "desc" }, take: 50 } },
  });
  if (!source) notFound();

  const config = parseConfig(source.config);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-6">
        <LinkButton href="/syncs" variant="ghost" size="icon-sm" aria-label={t("backToSyncs")}>
          <ArrowLeft className="size-4" />
        </LinkButton>
        <StatusBadge map={SYNC_TYPE_META} value={source.type} dot={false} />
        <div className="min-w-0">
          <h1 className="font-display text-lg font-semibold tracking-tight">
            {source.name}
          </h1>
          <p className="text-xs text-muted-foreground">
            {t.dyn(`direction.${source.direction}`, undefined, source.direction)} ·{" "}
            {t.dyn(`scope.${source.scope}`, undefined, source.scope)}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {source.lastStatus ? (
            <StatusBadge
              map={SYNC_RUN_STATUS_META}
              value={source.lastStatus}
            />
          ) : null}
          <ToggleActive sourceId={source.id} isActive={source.isActive} />
          {hasRole(me.role, "ADMIN") ? (
            <LinkButton href={`/syncs/${source.id}/edit`} variant="outline" size="sm">
              <Pencil className="size-4" />
              {t("edit")}
            </LinkButton>
          ) : null}
          <RunButton sourceId={source.id} />
        </div>
      </div>

      <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[320px_1fr]">
        {/* Configuration */}
        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Settings2 className="size-4 text-muted-foreground" />
                {t("configuration")}
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2.5 text-sm">
              {config.error ? (
                <p className="text-sm text-muted-foreground">
                  {t("configInvalid")}
                </p>
              ) : config.entries.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("configEmpty")}
                </p>
              ) : (
                config.entries.map(([k, v]) => (
                  <div
                    key={k}
                    className="flex items-start justify-between gap-3"
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      {k}
                    </span>
                    <span className="max-w-[180px] truncate text-right font-medium">
                      {v}
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t("scheduleStatus")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{t("schedule")}</span>
                <span className="font-mono text-xs">
                  {source.schedule ?? "—"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{t("active")}</span>
                <span className="font-medium">
                  {source.isActive ? t("yes") : t("paused")}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{t("lastRun")}</span>
                <span className="font-medium">
                  {source.lastRunAt
                    ? f.relative(source.lastRunAt)
                    : t("never")}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Runs history */}
        <div className="grid gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Clock className="size-4 text-muted-foreground" />
            {t("runHistory", { count: source.runs.length })}
          </h2>
          {source.runs.length === 0 ? (
            <EmptyState
              icon={RefreshCw}
              title={t("noRunsTitle")}
              description={t("noRunsDescription")}
            >
              <RunButton sourceId={source.id} />
            </EmptyState>
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t("colStatus")}</TableHead>
                    <TableHead className="hidden sm:table-cell">
                      {t("colTrigger")}
                    </TableHead>
                    <TableHead className="text-right">{t("colCreated")}</TableHead>
                    <TableHead className="text-right">{t("colUpdated")}</TableHead>
                    <TableHead className="text-right">{t("colFailed")}</TableHead>
                    <TableHead className="hidden md:table-cell text-right">
                      {t("colStarted")}
                    </TableHead>
                    <TableHead className="text-right">{t("colDuration")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {source.runs.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <StatusBadge
                          map={SYNC_RUN_STATUS_META}
                          value={r.status}
                        />
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                        {t.dyn(`trigger.${r.trigger}`, undefined, r.trigger)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.created}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.updated}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {r.failed > 0 ? (
                          <span className="text-red-600 dark:text-red-400">
                            {r.failed}
                          </span>
                        ) : (
                          r.failed
                        )}
                      </TableCell>
                      <TableCell
                        className="hidden md:table-cell text-right text-xs text-muted-foreground"
                        title={f.date(r.startedAt, "dateTime")}
                      >
                        {f.relative(r.startedAt)}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                        {duration(r.startedAt, r.finishedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
