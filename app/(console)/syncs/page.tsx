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
import { formatDistanceToNow } from "date-fns";

export const metadata: Metadata = { title: "Syncs" };
export const dynamic = "force-dynamic";

const DIRECTION_LABEL: Record<string, string> = {
  IMPORT: "Import",
  EXPORT: "Export",
  BIDIRECTIONAL: "Bidirectional",
};
const SCOPE_LABEL: Record<string, string> = {
  USERS: "Users",
  ASSETS: "Assets",
  TICKETS: "Tickets",
  ALL: "All records",
};

export default async function SyncsPage() {
  const me = await requireRole("MANAGER");
  const canCreate = hasRole(me.role, "ADMIN");
  const sources = await db.syncSource.findMany({
    orderBy: [{ name: "asc" }],
  });

  return (
    <>
      <PageHeader
        icon={RefreshCw}
        title="Syncs"
        description="Integrations that import and export users, assets and tickets between systems."
      >
        {canCreate ? (
          <LinkButton href="/syncs/new">
            <Plus className="size-4" />
            New source
          </LinkButton>
        ) : null}
      </PageHeader>

      <PageBody>
        {sources.length === 0 ? (
          <EmptyState
            icon={RefreshCw}
            title="No sync sources configured"
            description="Sync sources connect Servio to directories, MDM and other ITSM tools."
          >
            {canCreate ? (
              <LinkButton href="/syncs/new">
                <Plus className="size-4" />
                New source
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
                      {DIRECTION_LABEL[s.direction] ?? s.direction} ·{" "}
                      {SCOPE_LABEL[s.scope] ?? s.scope}
                    </p>
                  </div>
                  <ToggleActive sourceId={s.id} isActive={s.isActive} />
                </div>

                <div className="grid gap-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Schedule</span>
                    <span className="font-mono text-[11px]">
                      {s.schedule ?? "—"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Clock className="size-3" /> Last run
                    </span>
                    <span className="flex items-center gap-2">
                      {s.lastRunAt ? (
                        <span className="text-muted-foreground">
                          {formatDistanceToNow(s.lastRunAt, { addSuffix: true })}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Never</span>
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
                    {s.isActive ? "Active" : "Paused"}
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
