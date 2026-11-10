import { canReadConsoleTitle } from "@/lib/metadata-access";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getFormOptions } from "@/lib/data/options";
import { allowedTransitions } from "@/lib/workflow";
import { requireUser, isAgent, hasRole, type Role } from "@/lib/session";
import { DetailShell, DetailTitle, DetailTopBar, RailCard } from "@/components/detail-layout";
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
import { CHANGE_STATUS_META, CHANGE_TYPE_META, RISK_META, changeRef } from "@/lib/constants";
import type { SearchParams } from "@/lib/query";
import { getFormatter, getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  if (!(await canReadConsoleTitle())) return {};
  const { id } = await params;
  const c = await db.change.findUnique({ where: { id: Number(id) }, select: { title: true } });
  if (c) return { title: c.title };
  const t = await getT("changes");
  return { title: t("detail.fallbackTitle") };
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
  const [t, tc, f] = await Promise.all([getT("changes"), getT("common"), getFormatter()]);

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
    t,
    status: change.status,
    submitBlockers: missingForSubmit.map((m) => t(`submitField.${m.field}`)),
    counts: {
      pendingApprovals: approvals.pending,
      affectedCis: change._count.assets,
      links: changeLinkCount({ hasProblem: change.problemId !== null, tickets: change._count.tickets, assets: change._count.assets }),
      comments: change._count.comments,
    },
  });
  const active = resolveTab(sp, tabs, DEFAULT_CHANGE_TAB);

  const rail = (
    <>
      <RailCard title={tc("properties")}>
        <ChangeProperties change={change} options={options} allowedStatuses={allowedStatuses} locked={locked} />
      </RailCard>

      <EntityCustomFields
        entityType="CHANGE"
        entityId={change.id}
        defs={visibleCustomFields}
        values={cfValues}
        editable={isAgentUser}
      />

      <WindowSummary change={change} />
    </>
  );

  return (
    <DetailShell aside={rail}>
      <DetailTopBar
        backHref="/changes"
        backLabel={t("detail.back")}
        lead={
          <>
            <span className="font-mono text-sm text-muted-foreground">{changeRef(change.id)}</span>
            <StatusBadge map={CHANGE_TYPE_META} value={change.type} dot />
            <ReleaseChip changeId={change.id} />
          </>
        }
      >
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
      </DetailTopBar>

      <ChangeConflicts changeId={change.id} variant="banner" />

      <div className="p-4 sm:p-6">
        <DetailTitle
          title={change.title}
          subtitle={
            <>
              {t("detail.raised", { time: f.relative(change.createdAt) })}
              {change.assignee ? <> · {t("detail.ownedBy", { name: change.assignee.name ?? change.assignee.email })}</> : null}
            </>
          }
        />

        <EntityTabs
          className="mt-4"
          tabs={tabs}
          active={active}
          defaultTab={DEFAULT_CHANGE_TAB}
          basePath={`/changes/${change.id}`}
          searchParams={sp}
          label={t("detail.sections")}
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
              role={me?.role ?? "USER"}
            />
          </Suspense>
        </div>
      </div>
    </DetailShell>
  );
}
