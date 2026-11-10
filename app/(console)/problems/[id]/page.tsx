import { canReadConsoleTitle } from "@/lib/metadata-access";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { RelatedArticlesCard } from "@/components/related-articles-card";
import { RecordAttachments } from "@/components/attachments/record-attachments";
import { getFormOptions } from "@/lib/data/options";
import { allowedTransitions } from "@/lib/workflow";
import { requireUser, isAgent, hasRole, type Role } from "@/lib/session";
import { DetailShell, DetailTitle, DetailTopBar, MetaRow, RailCard } from "@/components/detail-layout";
import { StatusBadge } from "@/components/status-badge";
import { ProblemProperties } from "@/components/problems/problem-properties";
import { RecordAffectedServices } from "@/components/services/affected-services";
import { ProblemAffectedCis } from "@/components/problems/problem-affected-cis";
import { EntityCustomFields } from "@/components/custom-fields/entity-custom-fields";
import { isFieldVisible, parseValues, entityFieldValues, type CustomFieldDef } from "@/lib/custom-fields";
import { ProblemDetailsDialog } from "@/components/problems/problem-editors";
import { EntityTabs, resolveTab } from "@/components/entity-tabs";
import { EntityHistory } from "@/components/history/entity-history";
import {
  DEFAULT_PROBLEM_TAB, buildProblemTabs,
} from "@/components/problems/tabs/problem-tabs";
import { ProblemOverviewTab } from "@/components/problems/tabs/problem-overview-tab";
import { ProblemIncidentsTab } from "@/components/problems/tabs/problem-incidents-tab";
import { ProblemChangesTab } from "@/components/problems/tabs/problem-changes-tab";
import { ProblemDiscussionTab } from "@/components/problems/tabs/problem-discussion-tab";
import { isProblemLocked } from "@/lib/problem-rules";
import type { SearchParams } from "@/lib/query";
import { PROBLEM_STATUS_META, PRIORITY_META, problemRef } from "@/lib/constants";
import { getFormatter, getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  if (!(await canReadConsoleTitle())) return {};
  const { id } = await params;
  const p = await db.problem.findUnique({ where: { id: Number(id) }, select: { title: true } });
  return { title: p ? p.title : (await getT("problems"))("entity") };
}

export default async function ProblemDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const problemId = Number(id);
  if (!Number.isFinite(problemId)) notFound();

  const me = await requireUser();
  const [t, tc, f] = await Promise.all([getT("problems"), getT("common"), getFormatter()]);
  const [problem, options, customFieldDefs] = await Promise.all([
    db.problem.findUnique({
      where: { id: problemId },
      include: {
        assignee: true,
        group: true,
        category: true,
        _count: { select: { tickets: true, changes: true, assets: true, comments: true } },
      },
    }),
    getFormOptions(),
    db.customFieldDef.findMany({ where: { entityType: "PROBLEM", active: true }, orderBy: { order: "asc" } }),
  ]);
  if (!problem) notFound();

  const cfValues = parseValues(problem.customFields);
  const visibleCustomFields = (customFieldDefs as CustomFieldDef[]).filter((def) =>
    isFieldVisible(def, entityFieldValues(problem)),
  );

  const isAgentUser = !!me && isAgent(me.role as Role);
  const canManage = !!me && hasRole(me.role as Role, "MANAGER");
  const allowedStatuses = me ? [...await allowedTransitions("PROBLEM", problem.status, me.role as Role)] : undefined;
  const locked = isProblemLocked(problem.status);
  const canEditText = isAgentUser && !locked;

  const tabs = buildProblemTabs({
    incidents: problem._count.tickets,
    changes: problem._count.changes,
    affectedCis: problem._count.assets,
    comments: problem._count.comments,
  }, isAgentUser).map((tab) => ({ ...tab, label: t(`tab.${tab.key}`) }));
  const active = resolveTab(sp, tabs, DEFAULT_PROBLEM_TAB);

  const rail = (
    <>
      <RailCard title={tc("properties")}>
        <ProblemProperties problem={problem} options={options} allowedStatuses={allowedStatuses} locked={locked} />
      </RailCard>

      <EntityCustomFields
        entityType="PROBLEM"
        entityId={problem.id}
        defs={visibleCustomFields}
        values={cfValues}
        editable={isAgentUser}
      />

      <RailCard title={t("timeline")}>
        <MetaRow label={tc("created")}>{f.date(problem.createdAt, "dateTime")}</MetaRow>
        <MetaRow label={tc("updated")}>{f.date(problem.updatedAt, "dateTime")}</MetaRow>
        {problem.resolvedAt ? <MetaRow label={t("resolved")}>{f.date(problem.resolvedAt, "dateTime")}</MetaRow> : null}
      </RailCard>
    </>
  );

  return (
    <DetailShell aside={rail}>
      <DetailTopBar
        backHref="/problems"
        backLabel={t("backToList")}
        lead={<span className="font-mono text-sm text-muted-foreground">{problemRef(problem.id)}</span>}
      >
        {canEditText ? (
          <ProblemDetailsDialog
            id={problem.id}
            title={problem.title}
            description={problem.description}
            descriptionHtml={problem.descriptionHtml}
          />
        ) : null}
        <StatusBadge map={PRIORITY_META} value={problem.priority} dot />
        <StatusBadge map={PROBLEM_STATUS_META} value={problem.status} />
      </DetailTopBar>

      <div className="p-4 sm:p-6">
        <DetailTitle
          title={problem.title}
          subtitle={
            <>
              {t("openedAgo", { when: f.relative(problem.createdAt) })}
              {problem.category ? <> · {problem.category.name}</> : null}
            </>
          }
        />

        <EntityTabs
          className="mt-4"
          tabs={tabs}
          active={active}
          defaultTab={DEFAULT_PROBLEM_TAB}
          basePath={`/problems/${problem.id}`}
          searchParams={sp}
          label={t("sections")}
        />

        <div className="mt-6">
          {active === "overview" ? (
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
              <ProblemOverviewTab
                problemId={problem.id}
                description={problem.description}
                descriptionHtml={problem.descriptionHtml}
                rootCause={problem.rootCause}
                workaround={problem.workaround}
                editable={canEditText}
              />
              <RecordAttachments target={{ problemId: problem.id }} role={me?.role ?? "USER"} />
              <RelatedArticlesCard entityType="PROBLEM" entityId={problem.id} />
            </div>
          ) : null}
          {active === "incidents" ? (
            <ProblemIncidentsTab problemId={problem.id} isAgentUser={isAgentUser} />
          ) : null}
          {active === "changes" ? (
            <ProblemChangesTab problemId={problem.id} isAgentUser={isAgentUser} />
          ) : null}
          {active === "impact" ? (
            // The CIs the problem affects, and the services hit through them and the CIs of the linked incidents and changes (read-only)
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
              <ProblemAffectedCis problemId={problem.id} editable={isAgentUser} />
              <RecordAffectedServices record={{ kind: "problem", id: problem.id }} />
            </div>
          ) : null}
          {active === "discussion" ? (
            <ProblemDiscussionTab
              problem={{ id: problem.id, title: problem.title }}
              currentUserId={me?.id ?? ""}
              isAdmin={me?.role === "ADMIN"}
              canManage={canManage}
              isAgentUser={isAgentUser}
              agents={options.agents}
            />
          ) : null}
          {active === "history" ? (
            <EntityHistory entity="Problem" entityId={String(problem.id)} />
          ) : null}
        </div>
      </div>
    </DetailShell>
  );
}
