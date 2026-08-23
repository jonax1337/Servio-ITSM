import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  ArrowLeft, Server, AlertTriangle, GitPullRequestArrow,
  Flame, Link2, GitMerge, CheckCircle2, Users,
} from "lucide-react";
import { db } from "@/lib/db";
import { getFormOptions } from "@/lib/data/options";
import { getEntityApprovals } from "@/lib/data/approvals";
import { loadBusinessCalendar, slaSnapshot } from "@/lib/sla";
import { allowedTransitions } from "@/lib/workflow";
import { getSessionUser, isAgent, hasRole, type Role } from "@/lib/session";
import { LinkButton } from "@/components/link-button";
import { StatusBadge, VipBadge, ToneBadge } from "@/components/status-badge";
import { TicketProperties } from "@/components/tickets/ticket-properties";
import { TicketTasks } from "@/components/tickets/ticket-tasks";
import { EntityCustomFields } from "@/components/custom-fields/entity-custom-fields";
import { isFieldVisible, parseValues, entityFieldValues, type CustomFieldDef } from "@/lib/custom-fields";
import { CommentThread } from "@/components/comments/comment-thread";
import { EntityApprovals } from "@/components/approvals/entity-approvals";
import { aiConfigured, aiTeaserEnabled } from "@/lib/ai";
import { getBoolSetting, getMaxUploadMb } from "@/lib/settings";
import { EditEntityDialog } from "@/components/edit-entity-dialog";
import { addTicketComment, updateTicketDetails, unlinkTicket, unlinkAsset, unlinkRelation, setTicketProblem, setTicketChange, linkAsset } from "@/lib/actions/tickets";
import { TicketActions } from "@/components/tickets/ticket-actions";
import { MacroPicker } from "@/components/tickets/macro-picker";
import { LinkPicker } from "@/components/link-picker";
import { LinkedChip as Chip, UnlinkButton as UnlinkBtn } from "@/components/linked-records";
import { SlaBadge } from "@/components/tickets/sla-badge";
import { UserAvatar } from "@/components/user-avatar";
import { FormAnswers } from "@/components/tickets/form-answers";
import { WorkLog } from "@/components/tickets/work-log";
import { AttachmentsCard } from "@/components/attachments/attachments-card";
import { sanitizeCommentHtml } from "@/lib/markdown";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  TICKET_STATUS_META, PRIORITY_META, TICKET_TYPE_META, SOURCE_META,
  PENDING_REASON_META, RESOLUTION_CODE_META, metaFor,
  ticketRef, problemRef, changeRef,
  TONE_BANNER_CLASSES, TONE_TEXT_CLASSES,
} from "@/lib/constants";
import { format, formatDistanceToNow } from "date-fns";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const t = await db.ticket.findUnique({ where: { id: Number(id) }, select: { title: true } });
  return { title: t ? t.title : "Ticket" };
}

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ticketId = Number(id);
  if (!Number.isFinite(ticketId)) notFound();

  const me = await getSessionUser();
  const maxUploadMb = await getMaxUploadMb();
  const [ticket, options, audits, candidates, problemChoices, changeChoices, assetChoices, adHocApprovals, customFieldDefs] = await Promise.all([
    db.ticket.findUnique({
      where: { id: ticketId },
      include: {
        requester: true,
        requestedBy: true,
        assignee: true,
        service: true,
        sla: true,
        catalogItem: true,
        problem: true,
        change: true,
        mergedInto: true,
        comments: { include: { author: true, attachments: { orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "asc" } },
        assets: { include: { asset: true } },
        watchers: { include: { user: true } },
        participants: { include: { user: true }, orderBy: { createdAt: "asc" } },
        worklogs: { include: { user: true }, orderBy: { loggedAt: "desc" } },
        attachments: { orderBy: { createdAt: "desc" } },
        linksFrom: { include: { linked: true } },
        tasks: { orderBy: { createdAt: "asc" } },
      },
    }),
    getFormOptions(),
    db.auditLog.findMany({
      where: { entity: "Ticket", entityId: String(ticketId) },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    }),
    db.ticket.findMany({
      where: { id: { not: ticketId }, status: { notIn: ["CLOSED", "CANCELLED"] } },
      select: { id: true, title: true, prefix: true },
      orderBy: { updatedAt: "desc" },
      take: 60,
    }),
    db.problem.findMany({
      where: { status: { notIn: ["RESOLVED", "CLOSED"] } },
      select: { id: true, title: true },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    db.change.findMany({
      where: { status: { notIn: ["CLOSED", "REJECTED", "FAILED"] } },
      select: { id: true, title: true },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    db.asset.findMany({
      select: { id: true, name: true, assetTag: true },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    getEntityApprovals("TICKET", ticketId),
    db.customFieldDef.findMany({ where: { entityType: "TICKET", active: true }, orderBy: { order: "asc" } }),
  ]);
  if (!ticket) notFound();

  // SLA badge in BUSINESS time: when the ticket's SLA carries a business
  // calendar, compute the live state against working hours so the badge agrees
  // with the escalation sweep (lib/sla-escalation.ts). `loadBusinessCalendar`
  // returns null for no/always-open calendars, so `slaSnapshot` transparently
  // falls back to wall-clock in that case.
  const slaCalendar = await loadBusinessCalendar(ticket.sla?.businessCalendarId);
  const slaState = slaSnapshot(ticket, undefined, slaCalendar).state;

  // Macros the current agent may apply here: any shared macro + their own personal
  // ones. Non-agents get none (the picker is agent-only anyway).
  const macros = me && isAgent(me.role as Role)
    ? await db.macro.findMany({
        where: { OR: [{ isShared: true }, { ownerId: me.id }] },
        select: { id: true, name: true, description: true, isShared: true, actions: true },
        orderBy: [{ isShared: "desc" }, { name: "asc" }],
      })
    : [];

  // Custom fields: keep only defs whose visibility matches this ticket's built-in fields.
  const cfValues = parseValues(ticket.customFields);
  const visibleCustomFields = (customFieldDefs as CustomFieldDef[]).filter((def) =>
    isFieldVisible(def, entityFieldValues(ticket)),
  );

  const aiEnabled = await aiConfigured();
  const aiTeaser = !aiEnabled && (await aiTeaserEnabled()); // show buttons as a preview when disabled
  const aiVisible = aiEnabled || aiTeaser;
  // Admins can turn off the inline triage suggestions independently of the rest.
  const triageEnabled = aiEnabled && (await getBoolSetting("AI_TICKET_TRIAGE", true));
  const isWatching = !!me && ticket.watchers.some((w) => w.userId === me.id);
  const isAgentUser = !!me && isAgent(me.role as Role);
  const canManage = !!me && hasRole(me.role as Role, "MANAGER");
  const allowedStatuses = me ? [...await allowedTransitions("TICKET", ticket.status, me.role as Role)] : undefined;
  const candidateOpts = candidates.map((c) => ({
    value: String(c.id),
    label: `${ticketRef(c.id, c.prefix)} — ${c.title}`,
  }));
  const pickerMacros = macros.map((m) => {
    let actionCount = 0;
    try {
      const parsed = JSON.parse(m.actions) as unknown;
      if (Array.isArray(parsed)) actionCount = parsed.length;
    } catch { /* malformed macro → 0 actions */ }
    return { id: m.id, name: m.name, description: m.description, isShared: m.isShared, actionCount };
  });
  const linkedAssetIds = new Set(ticket.assets.map((a) => a.assetId));
  const problemOpts = problemChoices.map((p) => ({ value: String(p.id), label: `${problemRef(p.id)} · ${p.title}` }));
  const changeOpts = changeChoices.map((c) => ({ value: String(c.id), label: `${changeRef(c.id)} · ${c.title}` }));
  const assetOpts = assetChoices
    .filter((a) => !linkedAssetIds.has(a.id))
    .map((a) => ({ value: a.id, label: a.assetTag ? `${a.name} · ${a.assetTag}` : a.name }));

  // Recipients per sent message: join outbound emails by commentId so each reply
  // can show "An: … · Cc: …" (Freshservice-style auditability).
  const emailByComment = new Map(
    (
      await db.emailMessage.findMany({
        where: { ticketId, commentId: { not: null }, direction: "OUTBOUND" },
        select: { commentId: true, toEmail: true, cc: true },
      })
    ).map((m) => [m.commentId!, { to: m.toEmail, cc: m.cc ? (JSON.parse(m.cc) as string[]) : [] }]),
  );

  const comments = ticket.comments.map((c) => ({
    id: c.id, author: c.author.name ?? c.author.email, body: c.body, bodyHtml: c.bodyHtml, isInternal: c.isInternal, fromEmail: c.fromEmail, channel: c.channel, createdAt: c.createdAt, attachments: c.attachments,
    recipients: emailByComment.get(c.id) ?? null,
  }));
  const activity = audits
    .filter((a) => a.summary && a.summary !== "Added a comment")
    .map((a) => ({ id: a.id, who: a.user?.name ?? "System", summary: a.summary!, createdAt: a.createdAt }));

  // Candidates for the reply To/Cc/Bcc typeahead (value = email): requester +
  // participants + agents, de-duplicated by email.
  const replyCandidates = Array.from(
    new Map(
      [
        { value: ticket.requester.email, label: ticket.requester.name ?? ticket.requester.email },
        ...ticket.participants.map((p) => ({ value: p.user.email, label: p.user.name ?? p.user.email })),
        ...options.agents.map((a) => ({ value: a.email, label: a.name ?? a.email })),
      ].map((o) => [o.value.toLowerCase(), o]),
    ).values(),
  );

  return (
    <div className="grid gap-0 lg:h-[calc(100svh-3.5rem)] lg:grid-cols-[1fr_340px] lg:overflow-hidden">
      {/* Main column — scrolls independently from the properties rail */}
      <div className="min-w-0 border-b lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-6">
          <LinkButton href="/tickets" variant="ghost" size="icon-sm" aria-label="Back to tickets">
            <ArrowLeft className="size-4" />
          </LinkButton>
          <span className="font-mono text-sm text-muted-foreground">
            {ticketRef(ticket.id, ticket.prefix)}
          </span>
          <StatusBadge map={TICKET_TYPE_META} value={ticket.type} />
          <StatusBadge map={PRIORITY_META} value={ticket.priority} />
          <StatusBadge map={TICKET_STATUS_META} value={ticket.status} />
          <div className="ml-auto flex items-center gap-2">
            {isAgentUser ? <MacroPicker ticketId={ticket.id} macros={pickerMacros} /> : null}
            <EditEntityDialog
              action={updateTicketDetails}
              idField="id"
              id={ticket.id}
              title={ticket.title}
              description={ticket.description}
              descriptionHtml={ticket.descriptionHtml}
              entityLabel="ticket"
            />
            <TicketActions
              ticketId={ticket.id}
              isWatching={isWatching}
              isMajorIncident={ticket.isMajorIncident}
              candidates={candidateOpts}
              watchers={ticket.watchers.map((w) => w.user.name ?? w.user.email)}
              people={options.agents
                .filter((a) => a.id !== me?.id)
                .map((a) => ({ value: a.id, label: a.name ?? a.email }))}
            />
          </div>
        </div>

        {ticket.isMajorIncident ? (
          <div className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm font-medium text-destructive sm:px-6">
            <Flame className="size-4" /> Major Incident — all hands. Stakeholders are being notified.
          </div>
        ) : null}

        {ticket.pendingReason && (ticket.status === "PENDING" || ticket.status === "ON_HOLD") ? (
          <div className={`flex flex-wrap items-center gap-2 border-b ${TONE_BANNER_CLASSES.warning} px-4 py-2.5 text-sm sm:px-6`}>
            <ToneBadge meta={metaFor(PENDING_REASON_META, ticket.pendingReason)} />
            {ticket.pendingNote ? <span className="text-muted-foreground">{ticket.pendingNote}</span> : null}
          </div>
        ) : null}

        {ticket.resolutionNote && ["RESOLVED", "CLOSED", "CANCELLED"].includes(ticket.status) ? (
          <div className={`flex flex-wrap items-center gap-2 border-b ${TONE_BANNER_CLASSES.success} px-4 py-2.5 text-sm sm:px-6`}>
            {ticket.resolutionCode ? (
              <ToneBadge meta={metaFor(RESOLUTION_CODE_META, ticket.resolutionCode)} />
            ) : (
              <CheckCircle2 className={`size-4 ${TONE_TEXT_CLASSES.success}`} />
            )}
            <span className="text-muted-foreground">{ticket.resolutionNote}</span>
          </div>
        ) : null}

        {ticket.mergedInto ? (
          <div className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2.5 text-sm sm:px-6">
            <GitMerge className="size-4 text-muted-foreground" />
            This ticket was merged into{" "}
            <Link href={`/tickets/${ticket.mergedInto.id}`} className="font-medium text-primary hover:underline">
              {ticketRef(ticket.mergedInto.id, ticket.mergedInto.prefix)}
            </Link>
            .
          </div>
        ) : null}

        <div className="p-4 sm:p-6">
          <h1 className="font-display text-2xl font-semibold tracking-tight">
            {ticket.title}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
            <span>Opened by {ticket.requester.name ?? ticket.requester.email}</span>
            {ticket.requester.isVip ? <VipBadge className="align-middle" /> : null}
            <span>· {formatDistanceToNow(ticket.createdAt, { addSuffix: true })} · via</span>
            <StatusBadge map={SOURCE_META} value={ticket.source} />
          </p>

          <div className="mt-4 rounded-xl border bg-card p-4 text-sm leading-relaxed">
            {ticket.descriptionHtml ? (
              <div
                className="prose prose-sm dark:prose-invert max-w-none"
                dangerouslySetInnerHTML={{ __html: sanitizeCommentHtml(ticket.descriptionHtml) }}
              />
            ) : ticket.description ? (
              <div className="whitespace-pre-wrap">{ticket.description}</div>
            ) : (
              <span className="text-muted-foreground">No description provided.</span>
            )}
          </div>

          {ticket.formData ? (
            <FormAnswers className="mt-4" formSchema={ticket.formSchema ?? ticket.catalogItem?.formSchema} formData={ticket.formData} />
          ) : null}

          {ticket.attachments.length > 0 ? (
            <AttachmentsCard
              className="mt-4"
              attachments={ticket.attachments}
              target={{ ticketId: ticket.id }}
              canUpload={false}
              canDeleteAll={!!me && isAgent(me.role as Role)}
              currentUserId={me?.id}
              maxMb={maxUploadMb}
            />
          ) : null}

          {/* Linked records — problems, changes, tickets and assets, with add + unlink */}
          <div className="mt-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Link2 className="size-4 text-muted-foreground" /> Linked records
              </h2>
              {isAgentUser ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <LinkPicker
                    action={setTicketProblem}
                    triggerLabel="Problem"
                    title="Link to problem"
                    description="Connect this incident to a known problem."
                    hidden={{ ticketId: ticket.id }}
                    valueName="problemId"
                    options={problemOpts}
                    placeholder="Choose a problem"
                    searchPlaceholder="Search problems…"
                    emptyText="No open problems to link."
                  />
                  <LinkPicker
                    action={setTicketChange}
                    triggerLabel="Change"
                    title="Link to change"
                    description="Connect this ticket to a change request."
                    hidden={{ ticketId: ticket.id }}
                    valueName="changeId"
                    options={changeOpts}
                    placeholder="Choose a change"
                    searchPlaceholder="Search changes…"
                    emptyText="No open changes to link."
                  />
                  <LinkPicker
                    action={linkAsset}
                    triggerLabel="Asset"
                    title="Link an asset"
                    description="Attach an affected configuration item."
                    hidden={{ ticketId: ticket.id }}
                    valueName="assetId"
                    options={assetOpts}
                    placeholder="Choose an asset"
                    searchPlaceholder="Search assets…"
                    emptyText="No more assets to link."
                  />
                </div>
              ) : null}
            </div>
          {(ticket.problem || ticket.change || ticket.assets.length > 0 || ticket.linksFrom.length > 0) ? (
            <div className="flex flex-wrap gap-2">
              {ticket.problem ? (
                <Chip href={`/problems/${ticket.problem.id}`} icon={<AlertTriangle className={`size-3.5 ${TONE_TEXT_CLASSES.warning}`} />} label={`${problemRef(ticket.problem.id)} · ${ticket.problem.title}`}
                  unlink={<UnlinkBtn action={unlinkRelation} fields={{ ticketId: ticket.id, kind: "problem" }} />} />
              ) : null}
              {ticket.change ? (
                <Chip href={`/changes/${ticket.change.id}`} icon={<GitPullRequestArrow className="size-3.5 text-primary" />} label={changeRef(ticket.change.id)}
                  unlink={<UnlinkBtn action={unlinkRelation} fields={{ ticketId: ticket.id, kind: "change" }} />} />
              ) : null}
              {ticket.linksFrom.map((l) => (
                <Chip key={l.id} href={`/tickets/${l.linkedTicketId}`} icon={<Link2 className={`size-3.5 ${TONE_TEXT_CLASSES.info}`} />} label={`${ticketRef(l.linked.id, l.linked.prefix)} · ${l.linked.title}`}
                  unlink={<UnlinkBtn action={unlinkTicket} fields={{ linkId: l.id, ticketId: ticket.id }} />} />
              ))}
              {ticket.assets.map((a) => (
                <Chip key={a.assetId} href={`/assets/${a.assetId}`} icon={<Server className={`size-3.5 ${TONE_TEXT_CLASSES.indigo}`} />} label={a.asset.name}
                  unlink={<UnlinkBtn action={unlinkAsset} fields={{ ticketId: ticket.id, assetId: a.assetId }} />} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No linked records yet.</p>
          )}
          </div>

          {/* Approvals (ad-hoc sign-off) */}
          {isAgentUser ? (
            <EntityApprovals
              entityType="TICKET"
              entityId={String(ticket.id)}
              entityTitle={ticket.title}
              approvals={adHocApprovals}
              currentUserId={me?.id ?? ""}
              isAdmin={me?.role === "ADMIN"}
              canManage={canManage}
              canRequest={isAgentUser}
              agents={options.agents}
            />
          ) : null}

          {/* Comments & Activity */}
          <div className="mt-8">
            <CommentThread
              idField="ticketId"
              entityId={ticket.id}
              comments={comments}
              activity={activity}
              addAction={addTicketComment}
              mentionUsers={options.agents}
              attachTarget={{ ticketId: ticket.id }}
              aiTicketId={aiVisible ? ticket.id : undefined}
              aiTeaser={aiTeaser}
              emailReply={{
                requesterEmail: ticket.requester.email,
                participantEmails: ticket.participants.map((p) => p.user.email),
                candidateUsers: replyCandidates,
              }}
              enableForward
              maxMb={maxUploadMb}
            />
          </div>
        </div>
      </div>

      {/* Sidebar */}
      <aside className="p-4 sm:p-6 lg:min-h-0 lg:overflow-y-auto">
        {/* SLA first — the clock is the most time-sensitive thing to see */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Timeline & SLA</CardTitle></CardHeader>
          <CardContent className="grid gap-2.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">SLA status</span>
              <SlaBadge ticket={ticket} state={slaState} />
            </div>
            <Meta label="Created" value={format(ticket.createdAt, "PP p")} />
            {ticket.responseDueAt && !ticket.firstResponseAt ? <Meta label="Respond by" value={format(ticket.responseDueAt, "PP p")} /> : null}
            {ticket.dueAt ? <Meta label="Resolve by" value={format(ticket.dueAt, "PP p")} /> : null}
            {ticket.firstResponseAt ? <Meta label="First response" value={format(ticket.firstResponseAt, "PP p")} /> : null}
            {ticket.resolvedAt ? <Meta label="Resolved" value={format(ticket.resolvedAt, "PP p")} /> : null}
            {ticket.sla ? <Meta label="SLA" value={ticket.sla.name} /> : null}
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader><CardTitle className="text-sm">Properties</CardTitle></CardHeader>
          <CardContent>
            <TicketProperties ticket={ticket} options={options} aiEnabled={aiVisible} aiTeaser={aiTeaser} triageEnabled={triageEnabled} allowedStatuses={allowedStatuses} />
          </CardContent>
        </Card>

        <EntityCustomFields
          className="mt-4"
          entityType="TICKET"
          entityId={ticket.id}
          defs={visibleCustomFields}
          values={cfValues}
          editable={isAgentUser}
        />

        {/* Checklist — agents work through subtasks before resolving. */}
        {isAgentUser ? (
          <Card className="mt-4">
            <CardHeader><CardTitle className="text-sm">Tasks</CardTitle></CardHeader>
            <CardContent>
              <TicketTasks ticketId={ticket.id} tasks={ticket.tasks} />
            </CardContent>
          </Card>
        ) : null}

        {/* Requester — a clickable user card that opens their profile (their open
            tickets + assigned assets). Watchers are surfaced via the Watch button. */}
        <Card className="mt-4">
          <CardHeader><CardTitle className="text-sm">Requester</CardTitle></CardHeader>
          <CardContent>
            <Link
              href={`/people/${ticket.requesterId}`}
              className="group flex items-center gap-3 rounded-lg border p-2.5 transition-colors hover:border-primary/40"
            >
              <UserAvatar name={ticket.requester.name} email={ticket.requester.email} image={ticket.requester.image} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-medium group-hover:text-primary">
                    {ticket.requester.name ?? ticket.requester.email}
                  </span>
                  {ticket.requester.isVip ? <VipBadge label={false} /> : null}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{ticket.requester.email}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                View →
              </span>
            </Link>
            {ticket.requestedBy ? (
              <Link
                href={`/people/${ticket.requestedByUserId}`}
                className="mt-2 flex items-center gap-2 rounded-lg border border-dashed p-2 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                <UserAvatar name={ticket.requestedBy.name} email={ticket.requestedBy.email} image={ticket.requestedBy.image} size="sm" />
                <span className="min-w-0 flex-1 truncate">
                  Raised by {ticket.requestedBy.name ?? ticket.requestedBy.email} on their behalf
                </span>
              </Link>
            ) : null}
          </CardContent>
        </Card>

        {/* Participants: portal-visible collaborators (e.g. a CC'd manager). */}
        {ticket.participants.length > 0 ? (
          <Card className="mt-4">
            <CardHeader><CardTitle className="flex items-center gap-1.5 text-sm"><Users className="size-4 text-muted-foreground" /> Participants</CardTitle></CardHeader>
            <CardContent className="grid gap-1.5">
              <div className="text-xs text-muted-foreground">Can see &amp; reply in the portal</div>
              {ticket.participants.map((p) => (
                <Link
                  key={p.userId}
                  href={`/people/${p.userId}`}
                  className="group flex items-center gap-2.5 rounded-lg border p-2 transition-colors hover:border-primary/40"
                >
                  <UserAvatar name={p.user.name} email={p.user.email} image={p.user.image} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium group-hover:text-primary">{p.user.name ?? p.user.email}</span>
                    <span className="block truncate text-xs text-muted-foreground">{p.user.email}</span>
                  </span>
                </Link>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <WorkLog
          ticketId={ticket.id}
          logs={ticket.worklogs}
          meId={me?.id ?? ""}
          isAdmin={me?.role === "ADMIN"}
        />

      </aside>

      {/* Onyx lives in the global window (FAB / SableProvider) — it detects this
          ticket from the URL and opens the same assistant with ticket context. */}
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

