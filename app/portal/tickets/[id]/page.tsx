import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, MessagesSquare, RotateCcw } from "lucide-react";
import { db } from "@/lib/db";
import { getSessionUser, requireUser } from "@/lib/session";
import { portalTicketTitle, portalTicketWhere } from "@/lib/portal-access";
import { LinkButton } from "@/components/link-button";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { PortalComment } from "@/components/portal/portal-comment";
import { UserAvatar } from "@/components/user-avatar";
import { AttachmentsCard } from "@/components/attachments/attachments-card";
import { sanitizeCommentHtml } from "@/lib/markdown";
import { iconForMime, formatBytes } from "@/lib/attachments-ui";
import { FormAnswers } from "@/components/tickets/form-answers";
import { effectiveApprovalStages } from "@/lib/service-forms";
import { getMaxUploadMb } from "@/lib/settings";
import { reRequestCatalogItem } from "@/lib/actions/catalog";
import { ApprovalProgress, type ProgressStage } from "../approval-progress";
import {
  APPROVAL_STATUSES, TICKET_STATUS_META, PRIORITY_META, TICKET_TYPE_META, ticketRef,
} from "@/lib/constants";
import { getEnumT, getFormatter, getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  // Same access rule as the page below: a foreign ticket's title must not leak into the tab.
  const me = await getSessionUser();
  const title = await portalTicketTitle(id, me?.id ?? null);
  return { title: title ?? (await getT("portal"))("ticket") };
}

export default async function PortalTicketDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireUser();
  const maxUploadMb = await getMaxUploadMb();
  const [t, te, f] = await Promise.all([getT("portal"), getEnumT(), getFormatter()]);
  const { id } = await params;

  const ticket = await db.ticket.findFirst({
    // Requester OR participant (e.g. a CC'd manager) may view the ticket.
    where: portalTicketWhere(Number(id), me.id),
    include: {
      assignee: true,
      service: true,
      catalogItem: true,
      approvals: { orderBy: { stage: "asc" }, include: { approver: { select: { name: true, email: true } } } },
      // only public (non-internal) comments are visible to the requester
      comments: { where: { isInternal: false }, include: { author: true, attachments: { orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "asc" } },
      attachments: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!ticket) notFound();

  const isClosed = ticket.status === "CLOSED" || ticket.status === "CANCELLED";

  // Multi-stage approval progress (catalog requests only). We show the ordered
  // stages, which one is live, and any decisions so far. Re-request is offered
  // when a catalog request was declined so it isn't a dead end.
  const stages = ticket.catalogItem ? effectiveApprovalStages(ticket.catalogItem) : [];
  const isCatalogRequest = !!ticket.catalogItemId;
  const canReRequest = isCatalogRequest && ticket.status === "CANCELLED";
  const wasDeclined = ticket.approvalState === "REJECTED";

  return (
    <div className="mx-auto max-w-3xl">
      <LinkButton href="/portal/tickets" variant="ghost" size="sm" className="mb-4 -ml-2">
        <ArrowLeft className="size-4" /> {t("backToMyTickets")}
      </LinkButton>

      <div className="overflow-hidden rounded-2xl border bg-card">
        <div className="p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">{ticketRef(ticket.id, ticket.prefix)}</span>
            <StatusBadge map={TICKET_TYPE_META} value={ticket.type} dot />
            <div className="ml-auto flex items-center gap-2">
              <StatusBadge map={PRIORITY_META} value={ticket.priority} dot />
              <StatusBadge map={TICKET_STATUS_META} value={ticket.status} />
            </div>
          </div>
          <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight">{ticket.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("submitted", { time: f.relative(ticket.createdAt) })}
            {ticket.service ? ` · ${ticket.service.name}` : ""}
          </p>
        </div>

        {/* Handling status strip */}
        <div className="flex items-center gap-3 border-t bg-muted/30 px-6 py-3">
          {ticket.assignee ? (
            <>
              <UserAvatar name={ticket.assignee.name} email={ticket.assignee.email} size="sm" />
              <p className="text-sm text-muted-foreground">
                {t.rich("handledBy", {
                  name: ticket.assignee.name ?? t("theServiceDesk"),
                  b: (chunks) => <span className="font-medium text-foreground">{chunks}</span>,
                })}
              </p>
            </>
          ) : (
            <>
              <span className="size-2 rounded-full bg-amber-500" />
              <p className="text-sm text-muted-foreground">
                {t("awaitingAssignment")}
              </p>
            </>
          )}
        </div>
      </div>

      {stages.length > 0 && ticket.approvalState && APPROVAL_STATUSES.includes(ticket.approvalState as (typeof APPROVAL_STATUSES)[number]) ? (
        <ApprovalProgress
          className="mt-6"
          state={ticket.approvalState}
          stages={stages.map((s, i) => {
            const seated = ticket.approvals.find((a) => a.stage === i);
            return {
              index: i,
              kind: (s.groupId ? "group" : "user") as "group" | "user",
              status: (seated?.status ?? "PENDING") as ProgressStage["status"],
              approverName: seated?.approver?.name ?? seated?.approver?.email ?? null,
              decidedAt: seated?.decidedAt ?? null,
              comment: seated?.comment ?? null,
            };
          })}
        />
      ) : null}

      {canReRequest ? (
        <div className="mt-6 flex flex-col items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium">{wasDeclined ? t("requestDeclined") : t("requestCancelled")}</p>
            <p className="text-sm text-muted-foreground">{t("resubmitHint")}</p>
          </div>
          <form action={reRequestCatalogItem}>
            <input type="hidden" name="ticketId" value={ticket.id} />
            <Button type="submit" className="shrink-0"><RotateCcw className="size-4" /> {t("reRequest")}</Button>
          </form>
        </div>
      ) : null}

      {/* Description */}
      <div className="mt-6 rounded-2xl border bg-card p-6">
        <h2 className="mb-3 text-sm font-semibold text-muted-foreground">{t("description")}</h2>
        <div className="text-sm leading-relaxed">
          {ticket.descriptionHtml ? (
            <div
              className="prose prose-sm max-w-none dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: sanitizeCommentHtml(ticket.descriptionHtml) }}
            />
          ) : (
            <div className="whitespace-pre-wrap">{ticket.description || t("noDescription")}</div>
          )}
        </div>
      </div>

      {ticket.formData ? (
        <FormAnswers className="mt-6" formSchema={ticket.formSchema ?? ticket.catalogItem?.formSchema} formData={ticket.formData} />
      ) : null}

      {ticket.attachments.length > 0 || !isClosed ? (
        <AttachmentsCard
          className="mt-6"
          attachments={ticket.attachments}
          target={{ ticketId: ticket.id }}
          canUpload={!isClosed}
          currentUserId={me.id}
          maxMb={maxUploadMb}
        />
      ) : null}

      {/* Conversation */}
      <div className="mt-8">
        <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-semibold tracking-tight">
          <MessagesSquare className="size-4.5 text-muted-foreground" />
          {t("conversation")}
        </h2>

        {ticket.comments.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-card/40 px-4 py-10 text-center text-sm text-muted-foreground">
            {t("noReplies")}
          </div>
        ) : (
          <div className="grid gap-4">
            {ticket.comments.map((c) => {
              const mine = c.authorId === me.id;
              return (
                <div key={c.id} className="flex gap-3">
                  <UserAvatar name={c.author.name} email={c.author.email} className="mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {mine ? t("you") : c.author.name ?? c.author.email}
                      </span>
                      <span className="text-xs text-muted-foreground">{f.date(c.createdAt, "dateTime")}</span>
                    </div>
                    {c.bodyHtml ? (
                      <div
                        className="mt-1.5 rounded-2xl border bg-card p-3.5 text-sm prose prose-sm max-w-none dark:prose-invert [&_[data-mention-id]]:rounded [&_[data-mention-id]]:bg-primary/10 [&_[data-mention-id]]:px-1 [&_[data-mention-id]]:font-medium [&_[data-mention-id]]:text-primary"
                        dangerouslySetInnerHTML={{ __html: sanitizeCommentHtml(c.bodyHtml) }}
                      />
                    ) : (
                      <div className="mt-1.5 whitespace-pre-wrap rounded-2xl border bg-card p-3.5 text-sm">{c.body}</div>
                    )}
                    {c.attachments.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {c.attachments.map((a) => {
                          const Icon = iconForMime(a.mime);
                          return (
                            <a key={a.id} href={`/api/files/${a.id}`} download className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs hover:border-primary/40 hover:text-primary">
                              <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                              <span className="max-w-48 truncate font-medium">{a.filename}</span>
                              <span className="text-muted-foreground">{formatBytes(a.size)}</span>
                            </a>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!isClosed ? (
          <div className="mt-5">
            <PortalComment ticketId={ticket.id} maxMb={maxUploadMb} />
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border bg-muted/30 px-4 py-3 text-center text-sm text-muted-foreground">
            {t("ticketIsStatus", {
              status: TICKET_STATUS_META[ticket.status] ? te(TICKET_STATUS_META, ticket.status).toLowerCase() : t("closed"),
            })}{" "}
            <a href="/portal/new" className="font-medium text-primary hover:underline">{t("openNewRequest")}</a>.
          </div>
        )}
      </div>
    </div>
  );
}
