import Link from "next/link";
import { RefreshCw, Clock, ArrowLeftRight, Plus } from "lucide-react";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { hasRole, requireRole } from "@/lib/session";
import { PageHeader, PageBody } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { LinkButton } from "@/components/link-button";
import { RunButton } from "@/components/syncs/run-button";
import { ToggleActive } from "@/components/syncs/toggle-active";
import { SYNC_TYPE_META, SYNC_RUN_STATUS_META } from "@/lib/constants";
import { getFormatter, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("syncs");
  return { title: t("metaTitle") };
}
export const dynamic = "force-dynamic";


export default async function SyncsPage() {
  const me = await requireRole("MANAGER");
  const canCreate = hasRole(me.role, "ADMIN");
  const [t, f] = await Promise.all([getT("syncs"), getFormatter()]);
  const sources = await db.syncSource.findMany({
    orderBy: [{ name: "asc" }],
  });

  return (
    <>
      <PageHeader
        icon={RefreshCw}
        title={t("title")}
        description={t("description")}
      >
        {canCreate ? (
          <LinkButton href="/syncs/new">
            <Plus className="size-4" />
            {t("newSource")}
          </LinkButton>
        ) : null}
      </PageHeader>

      <PageBody>
        {sources.length === 0 ? (
          <EmptyState
            icon={RefreshCw}
            title={t("emptyTitle")}
            description={t("emptyDescription")}
          >
            {canCreate ? (
              <LinkButton href="/syncs/new">
                <Plus className="size-4" />
                {t("newSource")}
              </LinkButton>
            ) : null}
          </EmptyState>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {sources.map((s) => (
              <div
                key={s.id}
                className="flex flex-col gap-4 rounded-xl border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <StatusBadge
                      map={SYNC_TYPE_META}
                      value={s.type}
                      dot={false}
                      className="mb-2"
                    />
                    <Link
                      href={`/syncs/${s.id}`}
                      className="block font-medium tracking-tight hover:text-primary"
                    >
                      {s.name}
                    </Link>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <ArrowLeftRight className="size-3" />
                      {t.dyn(`direction.${s.direction}`, undefined, s.direction)} ·{" "}
                      {t.dyn(`scope.${s.scope}`, undefined, s.scope)}
                    </p>
                  </div>
                  <ToggleActive sourceId={s.id} isActive={s.isActive} />
                </div>

                <div className="grid gap-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">{t("schedule")}</span>
                    <span className="font-mono text-[11px]">
                      {s.schedule ?? "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Clock className="size-3" /> {t("lastRun")}
                    </span>
                    <span className="flex items-center gap-2">
                      {s.lastRunAt ? (
                        <span className="text-muted-foreground">
                          {f.relative(s.lastRunAt)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{t("never")}</span>
                      )}
                      {s.lastStatus ? (
                        <StatusBadge
                          map={SYNC_RUN_STATUS_META}
                          value={s.lastStatus}
                        />
                      ) : null}
                    </span>
                  </div>
                </div>

                <div className="mt-auto flex items-center gap-2 border-t pt-3">
                  <RunButton sourceId={s.id} />
                  <span className="ml-auto text-xs text-muted-foreground">
                    {s.isActive ? t("active") : t("paused")}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}
