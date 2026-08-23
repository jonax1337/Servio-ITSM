import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  ArrowLeft, Ticket as TicketIcon, GitPullRequestArrow, Search, ShieldCheck, X,
} from "lucide-react";
import { db } from "@/lib/db";
import { getFormOptions } from "@/lib/data/options";
import { getEntityApprovals } from "@/lib/data/approvals";
import { allowedTransitions } from "@/lib/workflow";
import { getSessionUser, isAgent, hasRole, type Role } from "@/lib/session";
import { LinkButton } from "@/components/link-button";
import { StatusBadge } from "@/components/status-badge";
import { ProblemProperties } from "@/components/problems/problem-properties";
import { EntityCustomFields } from "@/components/custom-fields/entity-custom-fields";
import { isFieldVisible, parseValues, entityFieldValues, type CustomFieldDef } from "@/lib/custom-fields";
import { EntityApprovals } from "@/components/approvals/entity-approvals";
import { CommentThread } from "@/components/comments/comment-thread";
import { EditEntityDialog } from "@/components/edit-entity-dialog";
import { EditableTextCard } from "@/components/editable-text-card";
import { LinkPicker } from "@/components/link-picker";
import { addProblemComment, updateProblemDetails, updateProblemText } from "@/lib/actions/problems";
import { setTicketProblem } from "@/lib/actions/tickets";
import { sanitizeCommentHtml } from "@/lib/markdown";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PROBLEM_STATUS_META, PRIORITY_META, TICKET_STATUS_META,
  problemRef, ticketRef, changeRef,
} from "@/lib/constants";
import { format, formatDistanceToNow } from "date-fns";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const p = await db.problem.findUnique({ where: { id: Number(id) }, select: { title: true } });
  return { title: p ? p.title : "Problem" };
}

export default async function ProblemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const problemId = Number(id);
  if (!Number.isFinite(problemId)) notFound();

  const me = await getSessionUser();
  const [problem, options, audits, linkableTickets, approvals, customFieldDefs] = await Promise.all([
    db.problem.findUnique({
      where: { id: problemId },
      include: {
        assignee: true,
        group: true,
        category: true,
        tickets: { include: { assignee: true }, orderBy: { createdAt: "desc" } },
        changes: { orderBy: { createdAt: "desc" } },
        comments: { include: { author: true }, orderBy: { createdAt: "asc" } },
      },
    }),
    getFormOptions(),
    db.auditLog.findMany({
      where: { entity: "Problem", entityId: String(problemId) },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    }),
    db.ticket.findMany({
      where: { problemId: null, status: { notIn: ["CLOSED", "CANCELLED"] } },
      select: { id: true, title: true, prefix: true },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    getEntityApprovals("PROBLEM", problemId),
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
  const ticketOpts = linkableTickets.map((t) => ({ value: String(t.id), label: `${ticketRef(t.id, t.prefix)} · ${t.title}` }));

  const comments = problem.comments.map((c) => ({
    id: c.id, author: c.author.name ?? c.author.email, body: c.body, bodyHtml: c.bodyHtml, isInternal: c.isInternal, createdAt: c.createdAt, attachments: [],
  }));
  const activity = audits
    .filter((a) => a.summary && a.summary !== "Added a comment")
    .map((a) => ({ id: a.id, who: a.user?.name ?? "System", summary: a.summary!, createdAt: a.createdAt }));

  return (
    <div className="grid gap-0 lg:h-[calc(100svh-3.5rem)] lg:grid-cols-[1fr_320px] lg:overflow-hidden">
      {/* Main column — scrolls independently from the properties rail */}
      <div className="min-w-0 border-b lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-3 border-b px-4 py-3 sm:px-6">
          <LinkButton href="/problems" variant="ghost" size="icon-sm" aria-label="Back to problems">
            <ArrowLeft className="size-4" />
          </LinkButton>
          <span className="font-mono text-sm text-muted-foreground">
            {problemRef(problem.id)}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <StatusBadge map={PRIORITY_META} value={problem.priority} dot />
            <StatusBadge map={PROBLEM_STATUS_META} value={problem.status} />
            <EditEntityDialog
              action={updateProblemDetails}
              idField="id"
              id={problem.id}
              title={problem.title}
              description={problem.description}
              descriptionHtml={problem.descriptionHtml}
              entityLabel="problem"
            />
          </div>
        </div>

        <div className="p-4 sm:p-6">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {problem.title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Opened {formatDistanceToNow(problem.createdAt, { addSuffix: true })}
            {problem.category ? <> · {problem.category.name}</> : null}
          </p>

          <div className="mt-4 rounded-xl border bg-card p-4 text-sm leading-relaxed">
            {problem.descriptionHtml ? (
              <div className="prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: sanitizeCommentHtml(problem.descriptionHtml) }} />
            ) : problem.description ? (
              <div className="whitespace-pre-wrap">{problem.description}</div>
            ) : (
              <span className="text-muted-foreground">No description provided.</span>
            )}
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <EditableTextCard
              action={updateProblemText}
              idField="id"
              id={problem.id}
              field="rootCause"
              label="Root cause"
              icon={<Search className="size-4 text-muted-foreground" />}
              value={problem.rootCause}
              emptyText="Not yet identified."
              editable={isAgentUser}
            />
            <EditableTextCard
              action={updateProblemText}
              idField="id"
              id={problem.id}
              field="workaround"
              label="Workaround"
              icon={<ShieldCheck className="size-4 text-muted-foreground" />}
              value={problem.workaround}
              emptyText="No workaround documented."
              editable={isAgentUser}
            />
          </div>

          {/* Linked incidents */}
          <div className="mt-8">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <TicketIcon className="size-4 text-muted-foreground" />
                Linked incidents · {problem.tickets.length}
              </h2>
              {isAgentUser ? (
                <LinkPicker
                  action={setTicketProblem}
                  triggerLabel="Link incident"
                  title="Link an incident"
                  description="Attach an existing ticket to this problem."
                  hidden={{ problemId: problem.id }}
                  valueName="ticketId"
                  options={ticketOpts}
                  placeholder="Choose a ticket"
                  searchPlaceholder="Search tickets…"
                  emptyText="No unlinked tickets available."
                />
              ) : null}
            </div>
            {problem.tickets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No incidents linked to this problem yet.</p>
            ) : (
              <div className="overflow-hidden rounded-xl border bg-card">
                {problem.tickets.map((t) => (
                  <div
                    key={t.id}
                    className="group flex items-center gap-3 border-b px-4 py-3 last:border-b-0 hover:bg-accent"
                  >
                    <Link href={`/tickets/${t.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                      <span className="font-mono text-xs text-muted-foreground">
                        {ticketRef(t.id, t.prefix)}
                      </span>
                      <span className="line-clamp-1 flex-1 text-sm font-medium">{t.title}</span>
                      <StatusBadge map={TICKET_STATUS_META} value={t.status} />
                    </Link>
                    {isAgentUser ? (
                      <form action={setTicketProblem}>
                        <input type="hidden" name="ticketId" value={t.id} />
                        <input type="hidden" name="problemId" value="" />
                        <button
                          type="submit"
                          aria-label="Unlink incident"
                          title="Unlink incident"
                          className="grid size-6 place-items-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                        >
                          <X className="size-3.5" />
                        </button>
                      </form>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Linked changes */}
          {problem.changes.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {problem.changes.map((c) => (
                <Link
                  key={c.id}
                  href={`/changes/${c.id}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs hover:border-primary/40"
                >
                  <GitPullRequestArrow className="size-3.5 text-primary" /> {changeRef(c.id)} · {c.title}
                </Link>
              ))}
            </div>
          ) : null}

          {/* Approvals (ad-hoc sign-off) */}
          <EntityApprovals
            entityType="PROBLEM"
            entityId={String(problem.id)}
            entityTitle={problem.title}
            approvals={approvals}
            currentUserId={me?.id ?? ""}
            isAdmin={me?.role === "ADMIN"}
            canManage={canManage}
            canRequest={isAgentUser}
            agents={options.agents}
          />

          {/* Comments & Activity */}
          <div className="mt-8">
            <CommentThread
              idField="problemId"
              entityId={problem.id}
              comments={comments}
              activity={activity}
              addAction={addProblemComment}
            />
          </div>
        </div>
      </div>

      {/* Sidebar */}
      <aside className="p-4 sm:p-6 lg:min-h-0 lg:overflow-y-auto">
        <Card>
          <CardHeader><CardTitle className="text-sm">Properties</CardTitle></CardHeader>
          <CardContent>
            <ProblemProperties problem={problem} options={options} allowedStatuses={allowedStatuses} />
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
          <CardHeader><CardTitle className="text-sm">Assignment</CardTitle></CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Assignee</span>
              <span className="font-medium">
                {problem.assignee ? (problem.assignee.name ?? problem.assignee.email) : "Unassigned"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Group</span>
              <span className="font-medium">{problem.group ? problem.group.name : "—"}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader><CardTitle className="text-sm">Timeline</CardTitle></CardHeader>
          <CardContent className="grid gap-2.5 text-sm">
            <Meta label="Created" value={format(problem.createdAt, "PP p")} />
            <Meta label="Updated" value={format(problem.updatedAt, "PP p")} />
            {problem.resolvedAt ? <Meta label="Resolved" value={format(problem.resolvedAt, "PP p")} /> : null}
          </CardContent>
        </Card>
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
