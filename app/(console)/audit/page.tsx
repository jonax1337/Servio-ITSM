import type { Metadata } from "next";
import { ScrollText } from "lucide-react";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { getParam, getPage, type SearchParams } from "@/lib/query";
import {
  queryAuditLog,
  AUDIT_PAGE_SIZE,
  type AuditLogFilters,
} from "@/lib/actions/audit-log";
import { PageHeader, PageBody } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { UserAvatar } from "@/components/user-avatar";
import { AUTOMATION_EMAIL } from "@/lib/system-user";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PaginationBar } from "@/components/pagination-bar";
import { AuditToolbar } from "./audit-toolbar";
import { format } from "date-fns";

export const metadata: Metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

/** Actor-picker lookback window (see the bounded distinct below). */
const ACTOR_WINDOW_MS = 90 * 86400000;

/** Isolated so the render body stays free of direct impure calls. */
function actorWindowStart(): Date {
  return new Date(Date.now() - ACTOR_WINDOW_MS);
}

/** Tailwind tint per action verb so the log scans quickly. */
const ACTION_CLASS: Record<string, string> = {
  CREATE: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-300",
  UPDATE: "bg-sky-500/10 text-sky-600 border-sky-500/20 dark:text-sky-300",
  DELETE: "bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-300",
  LOGIN: "bg-violet-500/10 text-violet-600 border-violet-500/20 dark:text-violet-300",
  SYNC: "bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-300",
  AUTOMATION: "bg-indigo-500/10 text-indigo-600 border-indigo-500/20 dark:text-indigo-300",
};

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireRole("ADMIN");

  const sp = await searchParams;
  const page = getPage(sp);
  const filters: AuditLogFilters = {
    userId: getParam(sp, "userId"),
    entity: getParam(sp, "entity"),
    action: getParam(sp, "action"),
    from: getParam(sp, "from"),
    to: getParam(sp, "to"),
    q: getParam(sp, "q"),
  };

  const [{ rows, total, entities, actions }, actorUsers] = await Promise.all([
    queryAuditLog(filters, page),
    // Only users who have actually produced audit events, so the actor picker
    // stays short. `AuditLog.userId` is a plain FK, so this is a two-step lookup.
    // Bounded: distinct actors from the last 90 days (uses the @@index([createdAt])),
    // most-recent activity first, capped at 200 — a whole-table DISTINCT would
    // scan every audit row on each render.
    db.auditLog
      .findMany({
        where: {
          userId: { not: null },
          createdAt: { gte: actorWindowStart() },
        },
        distinct: ["userId"],
        orderBy: { createdAt: "desc" },
        take: 200,
        select: { userId: true },
      })
      .then((ids) =>
        db.user.findMany({
          where: {
            id: { in: ids.map((r) => r.userId!).filter(Boolean) },
            email: { not: AUTOMATION_EMAIL },
          },
          select: { id: true, name: true, email: true },
          orderBy: { name: "asc" },
        }),
      ),
  ]);

  const actorOptions = actorUsers.map((u) => ({ value: u.id, label: u.name ?? u.email }));
  const entityOptions = entities.map((e) => ({ value: e, label: e }));
  const actionOptions = actions.map((a) => ({ value: a, label: a }));

  return (
    <>
      <PageHeader
        icon={ScrollText}
        title="Audit log"
        description="Every create, update, delete and sign-in across Servio. Filter and export for compliance."
      />

      <PageBody className="grid gap-4">
        <AuditToolbar actors={actorOptions} entities={entityOptions} actions={actionOptions} />

        {rows.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No audit events"
            description="Try adjusting your filters or widening the date range."
          />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>When</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead className="hidden md:table-cell">Summary</TableHead>
                  <TableHead className="hidden xl:table-cell">IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                      {format(r.createdAt, "yyyy-MM-dd HH:mm:ss")}
                    </TableCell>
                    <TableCell>
                      {r.actorName || r.actorEmail ? (
                        <span className="flex items-center gap-2">
                          <UserAvatar name={r.actorName} email={r.actorEmail} size="xs" />
                          <span className="line-clamp-1 text-sm">
                            {r.actorName ?? r.actorEmail}
                          </span>
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">System</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className={
                          "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium " +
                          (ACTION_CLASS[r.action] ??
                            "bg-muted text-muted-foreground border-transparent")
                        }
                      >
                        {r.action}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm">
                      <span className="font-medium">{r.entity}</span>
                      <span className="ml-1 text-xs text-muted-foreground">#{r.entityId}</span>
                    </TableCell>
                    <TableCell className="hidden md:table-cell max-w-md text-sm text-muted-foreground">
                      <span className="line-clamp-1">{r.summary ?? "—"}</span>
                    </TableCell>
                    <TableCell className="hidden xl:table-cell text-xs text-muted-foreground font-mono">
                      {r.ip ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <PaginationBar
          pathname="/audit"
          searchParams={sp}
          page={page}
          pageSize={AUDIT_PAGE_SIZE}
          total={total}
        />
      </PageBody>
    </>
  );
}
