import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { getFormOptions } from "@/lib/data/options";
import { allowedTransitions } from "@/lib/workflow";
import { requireUser, isAgent, hasRole, type Role } from "@/lib/session";
import { LinkButton } from "@/components/link-button";
import { StatusBadge } from "@/components/status-badge";
import { ChangeProperties } from "@/components/changes/change-properties";
import { EntityCustomFields } from "@/components/custom-fields/entity-custom-fields";
import { EntityTabs, resolveTab } from "@/components/entity-tabs";
import { isFieldVisible, parseValues, entityFieldValues, type CustomFieldDef } from "@/lib/custom-fields";
import { isChangeLocked, isTemplatedStandard, submitBlockerDetails } from "@/lib/change-rules";
import { SubmitForApproval } from "@/components/changes/submit-for-approval";
import { CancelChangeButton } from "@/components/changes/cancel-change";
import { ChangeDetailsDialog } from "@/components/changes/change-editors";
import { ChangeConflicts } from "@/components/changes/change-conflicts";
import { ReleaseChip } from "@/components/changes/release-chip";
import { ChangeTabPanel } from "@/components/changes/tabs/change-tab-panel";
import { buildChangeTabs, changeLinkCount, DEFAULT_CHANGE_TAB } from "@/components/changes/tabs/change-tabs";
import { TabSkeleton } from "@/components/changes/tabs/tab-skeleton";
import { WindowSummary } from "@/components/changes/tabs/window-summary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CHANGE_STATUS_META, CHANGE_TYPE_META, RISK_META, changeRef } from "@/lib/constants";
import type { SearchParams } from "@/lib/query";
import { formatDistanceToNow } from "date-fns";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const c = await db.change.findUnique({ where: { id: Number(id) }, select: { title: true } });
  return { title: c ? c.title : "Change" };
}

export default async function ChangeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const changeId = Number(id);
  if (!Number.isFinite(changeId)) notFound();

  // Header, tab bar and rail only: each tab loads its own data (see components/changes/tabs).
  const [change, options, customFieldDefs, me] = await Promise.all([
    db.change.findUnique({
      where: { id: changeId },
      include: {
        assignee: true,
        approvals: { select: { status: true } },
        _count: { select: { comments: true, tickets: true, assets: true } },
      },
    }),
    getFormOptions(),
    db.customFieldDef.findMany({ where: { entityType: "CHANGE", active: true }, orderBy: { order: "asc" } }),
    requireUser(),
  ]);
  if (!change) notFound();

  const cfValues = parseValues(change.customFields);
  const visibleCustomFields = (customFieldDefs as CustomFieldDef[]).filter((def) =>
    isFieldVisible(def, entityFieldValues(change)),
  );

  const allowedStatuses = me ? [...await allowedTransitions("CHANGE", change.status, me.role as Role)] : undefined;
  // Manager+ curate the approval board (not the owner — SoD, matches the server).
  const canManage = !!me && hasRole(me.role as Role, "MANAGER");
  const isAgentUser = !!me && isAgent(me.role as Role);
  // A closed or cancelled change is a finished record: descriptive fields lock, links and comments stay open.
  const locked = isChangeLocked(change.status);
  const canEdit = isAgentUser && !locked;
  const preAuthorized = isTemplatedStandard(change);
  const missingForSubmit = submitBlockerDetails(change, preAuthorized);

  const approvals = {
    seated: change.approvals.length,
    pending: change.approvals.filter((a) => a.status === "PENDING").length,
  };
  const tabs = buildChangeTabs({
    status: change.status,
    submitBlockers: missingForSubmit.map((m) => m.label),
    counts: {
      pendingApprovals: approvals.pending,
      affectedCis: change._count.assets,
      links: changeLinkCount({ hasProblem: change.problemId !== null, tickets: change._count.tickets, assets: change._count.assets }),
      comments: change._count.comments,
    },
  });
  const active = resolveTab(sp, tabs, DEFAULT_CHANGE_TAB);

  return (
    <div className="grid gap-0 lg:h-[calc(100svh-3.5rem)] grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_320px] lg:overflow-hidden">
      {/* Main column — scrolls independently from the properties rail */}
      <div className="min-w-0 border-b lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-6">
          <LinkButton href="/changes" variant="ghost" size="icon-sm" aria-label="Back to changes">
            <ArrowLeft className="size-4" />
          </LinkButton>
          <span className="font-mono text-sm text-muted-foreground">
            {changeRef(change.id)}
          </span>
          <StatusBadge map={CHANGE_TYPE_META} value={change.type} dot />
          <ReleaseChip changeId={change.id} />
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {isAgentUser && change.status === "DRAFT" ? (
              <SubmitForApproval
                changeId={change.id}
                isStandard={preAuthorized}
                approverCount={change.approvals.length}
                missing={missingForSubmit}
              />
            ) : null}
            {isAgentUser && change.status !== "CANCELLED" && allowedStatuses?.includes("CANCELLED") ? <CancelChangeButton changeId={change.id} /> : null}
            {canEdit ? (
              <ChangeDetailsDialog
                id={change.id}
                title={change.title}
                description={change.description}
                descriptionHtml={change.descriptionHtml}
              />
            ) : null}
            <StatusBadge map={RISK_META} value={change.risk} dot />
            <StatusBadge map={CHANGE_STATUS_META} value={change.status} />
          </div>
        </div>

        <ChangeConflicts changeId={change.id} variant="banner" />

        <div className="p-4 sm:p-6">
          <h1 className="font-display text-2xl font-semibold tracking-tight wrap-anywhere">
            {change.title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Raised {formatDistanceToNow(change.createdAt, { addSuffix: true })}
            {change.assignee ? <> · owned by {change.assignee.name ?? change.assignee.email}</> : null}
          </p>

          <EntityTabs
            className="mt-4"
            tabs={tabs}
            active={active}
            defaultTab={DEFAULT_CHANGE_TAB}
            basePath={`/changes/${change.id}`}
            searchParams={sp}
            label="Change sections"
          />

          <div className="mt-4">
            <Suspense key={active} fallback={<TabSkeleton />}>
              <ChangeTabPanel
                tab={active}
                change={change}
                approvals={approvals}
                userId={me?.id ?? ""}
                isAgent={isAgentUser}
                canEdit={canEdit}
                canManage={canManage}
                isAdmin={me?.role === "ADMIN"}
              />
            </Suspense>
          </div>
        </div>
      </div>

      {/* Sidebar */}
      <aside className="p-4 sm:p-6 lg:min-h-0 lg:overflow-y-auto">
        <Card>
          <CardHeader><CardTitle className="text-sm">Properties</CardTitle></CardHeader>
          <CardContent>
            <ChangeProperties change={change} options={options} allowedStatuses={allowedStatuses} locked={locked} />
          </CardContent>
        </Card>

        <EntityCustomFields
          className="mt-4"
          entityType="CHANGE"
          entityId={change.id}
          defs={visibleCustomFields}
          values={cfValues}
          editable={isAgentUser}
        />

        <WindowSummary className="mt-4" change={change} />
      </aside>
    </div>
  );
}
