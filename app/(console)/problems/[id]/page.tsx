import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { RelatedArticlesCard } from "@/components/related-articles-card";
import { getFormOptions } from "@/lib/data/options";
import { allowedTransitions } from "@/lib/workflow";
import { requireUser, isAgent, hasRole, type Role } from "@/lib/session";
import { LinkButton } from "@/components/link-button";
import { StatusBadge } from "@/components/status-badge";
import { ProblemProperties } from "@/components/problems/problem-properties";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PROBLEM_STATUS_META, PRIORITY_META, problemRef } from "@/lib/constants";
import { getFormatter, getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
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
        _count: { select: { tickets: true, changes: true, comments: true } },
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
    comments: problem._count.comments,
  }).map((tab) => ({ ...tab, label: t(`tab.${tab.key}`) }));
  const active = resolveTab(sp, tabs, DEFAULT_PROBLEM_TAB);

  return (
    <div data-viewport-pane className="grid gap-0 lg:h-full grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_320px] lg:overflow-hidden">
      {/* Main column — scrolls independently from the properties rail */}
      <div className="min-w-0 border-b lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-6">
          <LinkButton href="/problems" variant="ghost" size="icon-sm" aria-label={t("backToList")}>
            <ArrowLeft className="size-4" />
          </LinkButton>
          <span className="font-mono text-sm text-muted-foreground">
            {problemRef(problem.id)}
          </span>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <StatusBadge map={PRIORITY_META} value={problem.priority} dot />
            <StatusBadge map={PROBLEM_STATUS_META} value={problem.status} />
            {canEditText ? (
              <ProblemDetailsDialog
                id={problem.id}
                title={problem.title}
                description={problem.description}
                descriptionHtml={problem.descriptionHtml}
              />
            ) : null}
          </div>
        </div>

        <div className="p-4 sm:p-6">
          <h1 className="font-display text-2xl font-semibold tracking-tight wrap-anywhere">
            {problem.title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("openedAgo", { when: f.relative(problem.createdAt) })}
            {problem.category ? <> · {problem.category.name}</> : null}
          </p>

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
              <ProblemOverviewTab
                problemId={problem.id}
                description={problem.description}
                descriptionHtml={problem.descriptionHtml}
                rootCause={problem.rootCause}
                workaround={problem.workaround}
                editable={canEditText}
              />
            ) : null}
            {active === "incidents" ? (
              <ProblemIncidentsTab problemId={problem.id} isAgentUser={isAgentUser} />
            ) : null}
            {active === "changes" ? (
              <ProblemChangesTab problemId={problem.id} isAgentUser={isAgentUser} />
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
      </div>

      {/* Sidebar */}
      <aside className="p-4 sm:p-6 lg:min-h-0 lg:overflow-y-auto">
        <Card>
          <CardHeader><CardTitle className="text-sm">{tc("properties")}</CardTitle></CardHeader>
          <CardContent>
            <ProblemProperties problem={problem} options={options} allowedStatuses={allowedStatuses} locked={locked} />
          </CardContent>
        </Card>

        <EntityCustomFields
          className="mt-4"
          entityType="PROBLEM"
          entityId={problem.id}
          defs={visibleCustomFields}
          values={cfValues}
          editable={isAgentUser}
        />

        <Card className="mt-4">
          <CardHeader><CardTitle className="text-sm">{t("assignment")}</CardTitle></CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{tc("assignee")}</span>
              <span className="font-medium">
                {problem.assignee ? (problem.assignee.name ?? problem.assignee.email) : tc("unassigned")}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{tc("group")}</span>
              <span className="font-medium">{problem.group ? problem.group.name : "—"}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader><CardTitle className="text-sm">{t("timeline")}</CardTitle></CardHeader>
          <CardContent className="grid gap-2.5 text-sm">
            <Meta label={tc("created")} value={f.date(problem.createdAt, "dateTime")} />
            <Meta label={tc("updated")} value={f.date(problem.updatedAt, "dateTime")} />
            {problem.resolvedAt ? <Meta label={t("resolved")} value={f.date(problem.resolvedAt, "dateTime")} /> : null}
          </CardContent>
        </Card>

        <RelatedArticlesCard className="mt-4" entityType="PROBLEM" entityId={problem.id} />
      </aside>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium tabular-nums">{value}</span>
    </div>
  );
}
