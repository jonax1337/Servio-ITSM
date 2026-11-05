import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  ArrowLeft, Server, Ticket as TicketIcon,
  ClipboardList, RotateCcw, FileText, Flag,
} from "lucide-react";
import { db } from "@/lib/db";
import { RelatedArticlesCard } from "@/components/related-articles-card";
import { getFormOptions } from "@/lib/data/options";
import { getEntityApprovals } from "@/lib/data/approvals";
import { allowedTransitions } from "@/lib/workflow";
import { getSessionUser, isAgent, hasRole, type Role } from "@/lib/session";
import { LinkButton } from "@/components/link-button";
import { StatusBadge } from "@/components/status-badge";
import { ChangeProperties } from "@/components/changes/change-properties";
import { EntityCustomFields } from "@/components/custom-fields/entity-custom-fields";
import { isFieldVisible, parseValues, entityFieldValues, type CustomFieldDef } from "@/lib/custom-fields";
import {
  canSeatApprovers, isChangeLocked, isWindowEditable, requiresRescheduleReason, submitBlockers,
} from "@/lib/change-rules";
import { ChangeWindowEditor } from "@/components/changes/change-window-editor";
import { SubmitForApproval } from "@/components/changes/submit-for-approval";
import { CancelChangeButton } from "@/components/changes/cancel-change";
import { ChangeDetailsDialog, ChangeTextCard } from "@/components/changes/change-editors";
import { ChangeProblemChip, ChangeProblemPicker } from "@/components/changes/change-problem-link";
import { ApprovalPanel, type ApprovalRow } from "@/components/changes/approval-panel";
import { ApprovalProgress } from "@/components/changes/approval-progress";
import { AffectedCiPanel, type ChangeImpact } from "@/components/changes/affected-ci-panel";
import { approverRolesForRisk, evaluateCab } from "@/lib/cab";
import { computeImpact } from "@/lib/cmdb-graph";
import { LinkedChip, UnlinkButton } from "@/components/linked-records";
import { EntityApprovals } from "@/components/approvals/entity-approvals";
import { CommentThread } from "@/components/comments/comment-thread";
import { addChangeComment } from "@/lib/actions/changes";
import { setTicketChange } from "@/lib/actions/tickets";
import { LinkPicker } from "@/components/link-picker";
import { sanitizeCommentHtml } from "@/lib/markdown";
import { initials } from "@/lib/avatar";
import type { ComboOption } from "@/components/combobox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CHANGE_OUTCOME_META, CHANGE_STATUS_META, CHANGE_TYPE_META, RISK_META, PRIORITY_META,
  changeRef, problemRef, ticketRef,
} from "@/lib/constants";
import { format, formatDistanceToNow } from "date-fns";

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
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const changeId = Number(id);
  if (!Number.isFinite(changeId)) notFound();

  const [change, options, audits, linkableTickets, adHocApprovals, customFieldDefs, allAssets, openProblems] = await Promise.all([
    db.change.findUnique({
      where: { id: changeId },
      include: {
        assignee: true,
        problem: true,
        approvals: { include: { approver: true }, orderBy: { createdAt: "asc" } },
        assets: { include: { asset: true } },
        tickets: true,
        comments: { include: { author: true }, orderBy: { createdAt: "asc" } },
      },
    }),
    getFormOptions(),
    db.auditLog.findMany({
      where: { entity: "Change", entityId: String(changeId) },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    }),
    db.ticket.findMany({
      where: { changeId: null, status: { notIn: ["CLOSED", "CANCELLED"] } },
      select: { id: true, title: true, prefix: true },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    getEntityApprovals("CHANGE", changeId),
    db.customFieldDef.findMany({ where: { entityType: "CHANGE", active: true }, orderBy: { order: "asc" } }),
    db.asset.findMany({
      where: { status: { notIn: ["RETIRED", "DISPOSED"] } },
      select: { id: true, name: true, type: true },
      orderBy: { name: "asc" },
      take: 500,
    }),
    db.problem.findMany({
      where: { status: { not: "CLOSED" } },
      select: { id: true, title: true },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
  ]);
  if (!change) notFound();

  const cfValues = parseValues(change.customFields);
  const visibleCustomFields = (customFieldDefs as CustomFieldDef[]).filter((def) =>
    isFieldVisible(def, entityFieldValues(change)),
  );

  const problemOpts = openProblems
    .filter((p) => p.id !== change.problemId)
    .map((p) => ({ value: String(p.id), label: `${problemRef(p.id)} · ${p.title}` }));
  const ticketOpts = linkableTickets.map((t) => ({ value: String(t.id), label: `${ticketRef(t.id, t.prefix)} · ${t.title}` }));

  const me = await getSessionUser();
  const allowedStatuses = me ? [...await allowedTransitions("CHANGE", change.status, me.role as Role)] : undefined;
  // Manager+ curate the approval board (not the owner — SoD, matches the server).
  const canManage = !!me && hasRole(me.role as Role, "MANAGER");
  const isAgentUser = !!me && isAgent(me.role as Role);
  // A closed or cancelled change is a finished record: descriptive fields lock, links and comments stay open.
  const locked = isChangeLocked(change.status);
  const canEdit = isAgentUser && !locked;
  const missingForSubmit = submitBlockers(change);
  const approverIds = new Set(change.approvals.map((a) => a.approverId));
  // Offer only people addChangeApprover will actually seat (role per risk, SoD).
  const eligibleIds = new Set(
    (await db.user.findMany({
      where: { role: { in: approverRolesForRisk(change.risk) }, isActive: true },
      select: { id: true },
    })).map((u) => u.id),
  );
  const agentOptions: ComboOption[] = options.agents
    .filter((a) => eligibleIds.has(a.id) && !approverIds.has(a.id) && a.id !== change.assigneeId && a.id !== change.createdById)
    .map((a) => ({ value: a.id, label: a.name ?? a.email, avatar: initials(a.name ?? a.email), hint: a.email }));
  const approvalRows: ApprovalRow[] = change.approvals.map((a) => ({
    id: a.id,
    approver: { id: a.approver.id, name: a.approver.name, email: a.approver.email },
    status: a.status,
    comment: a.comment,
    decidedAt: a.decidedAt,
  }));

  // ── Affected CIs + automated CMDB impact ──────────────────────────────────
  const affectedIds = new Set(change.assets.map((a) => a.assetId));
  const assetOptions: ComboOption[] = allAssets
    .filter((a) => !affectedIds.has(a.id))
    .map((a) => ({ value: a.id, label: a.name, hint: a.type }));

  // Walk the CMDB dependency graph downstream from each affected CI, then union
  // the reachable nodes (excluding the affected roots themselves) — this is the
  // blast radius of the change. Coarse risk = a threshold on the fan-out size.
  const rootImpacts = await Promise.all(
    change.assets.map((a) => computeImpact(a.assetId, { direction: "downstream" })),
  );
  const impactMap = new Map<string, ChangeImpact["impacted"][number]>();
  for (const res of rootImpacts) {
    for (const node of res.impacted) {
      if (affectedIds.has(node.id)) continue; // a root can't impact itself
      if (!impactMap.has(node.id)) {
        impactMap.set(node.id, {
          id: node.id,
          name: node.name,
          assetType: node.assetType,
          status: node.status,
          relation: node.relation,
        });
      }
    }
  }
  const impactedCis = Array.from(impactMap.values());
  const impactRisk: ChangeImpact["risk"] =
    impactedCis.length >= 8 ? "HIGH" : impactedCis.length >= 3 ? "MEDIUM" : "LOW";
  const changeImpact: ChangeImpact = { impacted: impactedCis, risk: impactRisk };

  // ── CAB tally against the configured decision rule ────────────────────────
  const cabTally = evaluateCab(
    change.approvals.map((a) => a.status),
    change.approvalRule,
    change.approvalThreshold,
  );
  // Managers may re-tune the rule while the board is being seated (DRAFT/APPROVAL,
  // non-STANDARD). Matches the server-side gate in setCabRule.
  const canSeatRule = canManage && change.type !== "STANDARD" && canSeatApprovers(change.status);

  const comments = change.comments.map((c) => ({
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
          <LinkButton href="/changes" variant="ghost" size="icon-sm" aria-label="Back to changes">
            <ArrowLeft className="size-4" />
          </LinkButton>
          <span className="font-mono text-sm text-muted-foreground">
            {changeRef(change.id)}
          </span>
          <StatusBadge map={CHANGE_TYPE_META} value={change.type} dot />
          <div className="ml-auto flex items-center gap-2">
            {isAgentUser && change.status === "DRAFT" ? (
              <SubmitForApproval
                changeId={change.id}
                isStandard={change.type === "STANDARD"}
                approverCount={change.approvals.length}
                missing={missingForSubmit}
              />
            ) : null}
            {isAgentUser && change.status !== "CANCELLED" && allowedStatuses?.includes("CANCELLED") ?<CancelChangeButton changeId={change.id} /> : null}
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

        <div className="p-4 sm:p-6">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {change.title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Raised {formatDistanceToNow(change.createdAt, { addSuffix: true })}
            {change.assignee ? <> · owned by {change.assignee.name ?? change.assignee.email}</> : null}
          </p>

          <div className="mt-4 rounded-xl border bg-card p-4 text-sm leading-relaxed">
            {change.descriptionHtml ? (
              <div className="prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: sanitizeCommentHtml(change.descriptionHtml) }} />
            ) : change.description ? (
              <div className="whitespace-pre-wrap">{change.description}</div>
            ) : (
              <span className="text-muted-foreground">No description provided.</span>
            )}
          </div>

          {/* Plan cards */}
          <div className="mt-4 grid gap-4">
            <ChangeTextCard
              id={change.id}
              field="reason"
              label="Reason for change"
              icon={<FileText className="size-4 text-muted-foreground" />}
              value={change.reason}
              emptyText="Not documented yet."
              editable={canEdit}
            />
            <ChangeTextCard
              id={change.id}
              field="implementationPlan"
              label="Implementation plan"
              icon={<ClipboardList className="size-4 text-muted-foreground" />}
              value={change.implementationPlan}
              emptyText="Not documented yet."
              editable={canEdit}
            />
            <ChangeTextCard
              id={change.id}
              field="rollbackPlan"
              label="Rollback plan"
              icon={<RotateCcw className="size-4 text-muted-foreground" />}
              value={change.rollbackPlan}
              emptyText="Not documented yet."
              editable={canEdit}
            />
          </div>

          {/* Closure / cancellation record */}
          {change.outcome || change.closureNotes || change.cancelReason ? (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Flag className="size-4 text-muted-foreground" />
                  {change.status === "CANCELLED" ? "Cancellation" : "Closure"}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm leading-relaxed">
                {change.outcome ? (
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Outcome</span>
                    <StatusBadge map={CHANGE_OUTCOME_META} value={change.outcome} dot />
                  </div>
                ) : null}
                {change.closureNotes ? <p className="whitespace-pre-wrap">{change.closureNotes}</p> : null}
                {change.cancelReason ? <p className="whitespace-pre-wrap">{change.cancelReason}</p> : null}
              </CardContent>
            </Card>
          ) : null}

          {/* Linked records */}
          <div className="mt-6">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <TicketIcon className="size-4 text-muted-foreground" /> Linked records
              </h2>
              {isAgentUser ? (
                <div className="flex items-center gap-2">
                  <ChangeProblemPicker changeId={change.id} options={problemOpts} />
                  <LinkPicker
                    action={setTicketChange}
                    triggerLabel="Link incident"
                    title="Link an incident"
                    description="Attach an existing ticket to this change."
                    hidden={{ changeId: change.id }}
                    valueName="ticketId"
                    options={ticketOpts}
                    placeholder="Choose a ticket"
                    searchPlaceholder="Search tickets…"
                    emptyText="No unlinked tickets available."
                  />
                </div>
              ) : null}
            </div>
            {(change.problem || change.tickets.length > 0 || change.assets.length > 0) ? (
              <div className="flex flex-wrap gap-2">
                {change.problem ? (
                  <ChangeProblemChip
                    changeId={change.id}
                    problemId={change.problem.id}
                    label={`${problemRef(change.problem.id)} · ${change.problem.title}`}
                    editable={isAgentUser}
                  />
                ) : null}
                {change.tickets.map((t) => (
                  <LinkedChip
                    key={t.id}
                    href={`/tickets/${t.id}`}
                    icon={<TicketIcon className="size-3.5 text-primary" />}
                    label={`${ticketRef(t.id, t.prefix)} · ${t.title}`}
                    unlink={
                      isAgentUser ? (
                        <UnlinkButton action={setTicketChange} fields={{ ticketId: t.id, changeId: "" }} />
                      ) : undefined
                    }
                  />
                ))}
                {change.assets.map((a) => (
                  <Link key={a.assetId} href={`/assets/${a.assetId}`} className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs hover:border-primary/40">
                    <Server className="size-3.5 text-indigo-500" /> {a.asset.name}
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No linked records yet.</p>
            )}
          </div>

          {/* Approvals / CAB */}
          {change.type !== "STANDARD" && (change.approvals.length > 0 || canSeatRule) ? (
            <div className="mt-8">
              <ApprovalProgress
                changeId={change.id}
                tally={cabTally}
                threshold={change.approvalThreshold}
                canSeat={canSeatRule}
              />
            </div>
          ) : null}
          <ApprovalPanel
            changeId={change.id}
            changeType={change.type}
            changeStatus={change.status}
            approvals={approvalRows}
            currentUserId={me?.id ?? ""}
            canManage={canManage}
            agentOptions={agentOptions}
          />

          {/* Ad-hoc sign-offs (in addition to the CAB) */}
          <p className="mt-8 rounded-lg border border-dashed bg-card/50 px-3 py-2 text-xs text-muted-foreground">
            The sign-offs below are manual requests to individuals, separate from the CAB above.
            They do not decide whether this change is approved.
          </p>
          <EntityApprovals
            entityType="CHANGE"
            entityId={String(change.id)}
            entityTitle={change.title}
            heading="Ad-hoc sign-offs"
            approvals={adHocApprovals}
            currentUserId={me?.id ?? ""}
            isAdmin={me?.role === "ADMIN"}
            canManage={canManage}
            canRequest={isAgentUser}
            agents={options.agents}
          />

          {/* Affected CIs + automated impact assessment */}
          <AffectedCiPanel
            changeId={change.id}
            affected={change.assets.map((a) => ({
              assetId: a.assetId,
              name: a.asset.name,
              type: a.asset.type,
              status: a.asset.status,
            }))}
            impact={changeImpact}
            assetOptions={assetOptions}
            editable={isAgentUser}
          />

          {/* Comments & Activity */}
          <div className="mt-8">
            <CommentThread
              idField="changeId"
              entityId={change.id}
              comments={comments}
              activity={activity}
              addAction={addChangeComment}
            />
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

        <Card className="mt-4">
          <CardHeader><CardTitle className="text-sm">Planned window</CardTitle></CardHeader>
          <CardContent className="grid gap-2.5 text-sm">
            <Meta label="Priority" value={PRIORITY_META[change.priority]?.label ?? change.priority} />
            {canEdit && isWindowEditable(change.status) ? (
              <ChangeWindowEditor
                changeId={change.id}
                plannedStart={change.plannedStart}
                plannedEnd={change.plannedEnd}
                requiresReason={requiresRescheduleReason(change.status)}
              />
            ) : (
              <>
                <Meta label="Planned start" value={change.plannedStart ? format(change.plannedStart, "PP p") : "—"} />
                <Meta label="Planned end" value={change.plannedEnd ? format(change.plannedEnd, "PP p") : "—"} />
              </>
            )}
            {change.actualStart ? <Meta label="Actual start" value={format(change.actualStart, "PP p")} /> : null}
            {change.actualEnd ? <Meta label="Actual end" value={format(change.actualEnd, "PP p")} /> : null}
            <Meta label="Created" value={format(change.createdAt, "PP p")} />
          </CardContent>
        </Card>

        <RelatedArticlesCard className="mt-4" entityType="CHANGE" entityId={change.id} />
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
