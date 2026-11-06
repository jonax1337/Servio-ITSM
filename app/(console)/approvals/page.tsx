import Link from "next/link";
import type { Metadata } from "next";
import { CheckSquare, GitPullRequestArrow, ShieldCheck, Info } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { PageHeader, PageBody } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { VipBadge, StatusBadge } from "@/components/status-badge";
import { UserAvatar } from "@/components/user-avatar";
import { ApprovalDecision } from "@/components/approvals/approval-decision";
import { ApprovalActions } from "@/components/changes/approval-actions";
import { EntityApprovalDecision } from "@/components/approvals/entity-approval-decision";
import { parseFormSchema, answersToText } from "@/lib/service-forms";
import { EntityTabs, resolveTab } from "@/components/entity-tabs";
import { approvalTabs, changeSelfApprovalError, DEFAULT_APPROVAL_TAB, tabShowsSection } from "@/lib/approval-rules";
import type { SearchParams } from "@/lib/query";
import { ticketRef, changeRef, CHANGE_TYPE_META, RISK_META, APPROVAL_ENTITY_META, type ApprovalEntityType } from "@/lib/constants";
import { formatDistanceToNow } from "date-fns";

export const metadata: Metadata = { title: "Approvals" };
export const dynamic = "force-dynamic";

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const scope = me.role === "ADMIN" ? {} : { approverId: me.id };
  const [pending, pendingChanges, pendingAdHoc] = await Promise.all([
    db.ticketApproval.findMany({
      // Only requests still awaiting a decision — a cancelled request has nothing left to approve.
      where: { status: "PENDING", ...scope, ticket: { approvalState: "PENDING", status: { not: "CANCELLED" } } },
      orderBy: { createdAt: "asc" },
      include: { ticket: { include: { requester: true, catalogItem: true } }, approver: true },
    }),
    db.changeApproval.findMany({
      // Seats added while drafting only become decidable once the change is submitted.
      where: { status: "PENDING", ...scope, change: { status: "APPROVAL" } },
      orderBy: { createdAt: "asc" },
      include: { change: { include: { assignee: true } }, approver: true },
    }),
    db.approval.findMany({
      where: { status: "PENDING", ...scope },
      orderBy: { createdAt: "asc" },
      include: { requestedBy: true, approver: true },
    }),
  ]);

  const total = pending.length + pendingChanges.length + pendingAdHoc.length;
  const tabs = approvalTabs({ changes: pendingChanges.length, requests: pending.length, other: pendingAdHoc.length });
  const activeTab = resolveTab(sp, tabs, DEFAULT_APPROVAL_TAB);
  const nothingInTab = tabs.find((t) => t.key === activeTab)?.count === 0;

  return (
    <>
      <PageHeader
        icon={CheckSquare}
        title="Approvals"
        description="Requests waiting for your decision."
      >
        {total > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-sm font-medium tabular-nums">
            <span className="size-2 rounded-full bg-amber-500" />
            {total} pending
          </span>
        ) : null}
      </PageHeader>
      <PageBody className="grid gap-8">
        {total === 0 ? (
          <EmptyState
            icon={CheckSquare}
            title="Nothing to approve"
            description="You're all caught up — approval requests will appear here."
          />
        ) : (
          <>
            <EntityTabs
              tabs={tabs}
              active={activeTab}
              defaultTab={DEFAULT_APPROVAL_TAB}
              basePath="/approvals"
              searchParams={sp}
              label="Approval types"
              className="-mb-4"
            />
            {nothingInTab ? (
              <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                Nothing of this kind is waiting for your decision.
              </p>
            ) : null}
            {pending.length > 0 && tabShowsSection(activeTab, "requests") ? (
              <Section icon={CheckSquare} label="Service requests" count={pending.length}>
                {pending.map((a) => {
                  const t = a.ticket;
                  const fields = parseFormSchema(t.catalogItem?.formSchema);
                  let answers = "";
                  try {
                    answers = answersToText(fields, JSON.parse(t.formData ?? "{}"));
                  } catch {
                    answers = "";
                  }
                  const mine = t.requesterId === me.id;
                  return (
                    <ApprovalShell
                      key={a.id}
                      refLabel={ticketRef(t.id, t.prefix)}
                      href={`/tickets/${t.id}`}
                      title={t.catalogItem?.name ?? t.title}
                      requesterName={t.requester.name ?? t.requester.email}
                      requesterEmail={t.requester.email}
                      vip={t.requester.isVip}
                      when={a.createdAt}
                      detail={answers}
                      decision={
                        mine ? (
                          <SelfNote approverName={a.approver?.name ?? a.approver?.email} />
                        ) : (
                          <ApprovalDecision approvalId={a.id} />
                        )
                      }
                    />
                  );
                })}
              </Section>
            ) : null}

            {pendingChanges.length > 0 && tabShowsSection(activeTab, "changes") ? (
              <Section icon={GitPullRequestArrow} label="Change approvals" count={pendingChanges.length}>
                {pendingChanges.map((a) => {
                  const selfApproval = changeSelfApprovalError(a.change, me.id);
                  return (
                    <ApprovalShell
                      key={a.id}
                      refLabel={changeRef(a.change.id)}
                      href={`/changes/${a.change.id}`}
                      title={a.change.title}
                      requesterName={a.change.assignee ? (a.change.assignee.name ?? a.change.assignee.email) : "Unassigned"}
                      requesterEmail={a.change.assignee?.email ?? null}
                      when={a.createdAt}
                      badges={
                        <>
                          <StatusBadge map={CHANGE_TYPE_META} value={a.change.type} dot />
                          <StatusBadge map={RISK_META} value={a.change.risk} dot />
                        </>
                      }
                      decision={
                        selfApproval ? <SelfNote message={selfApproval} /> : <ApprovalActions approvalId={a.id} />
                      }
                    />
                  );
                })}
              </Section>
            ) : null}

            {pendingAdHoc.length > 0 && tabShowsSection(activeTab, "other") ? (
              <Section icon={ShieldCheck} label="Sign-off requests" count={pendingAdHoc.length}>
                {pendingAdHoc.map((a) => {
                  const meta = APPROVAL_ENTITY_META[a.entityType as ApprovalEntityType];
                  const mine = a.requestedById === me.id;
                  return (
                    <ApprovalShell
                      key={a.id}
                      refLabel={`${meta.label} #${a.entityId}`}
                      href={`${meta.path}/${a.entityId}`}
                      title={a.title || `${meta.label} approval`}
                      requesterName={a.requestedBy ? (a.requestedBy.name ?? a.requestedBy.email) : "Requested"}
                      requesterEmail={a.requestedBy?.email ?? null}
                      when={a.createdAt}
                      decision={
                        mine ? (
                          <SelfNote approverName={a.approver?.name ?? a.approver?.email} />
                        ) : (
                          <EntityApprovalDecision approvalId={a.id} />
                        )
                      }
                    />
                  );
                })}
              </Section>
            ) : null}
          </>
        )}
      </PageBody>
    </>
  );
}

function Section({
  icon: Icon, label, count, children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <span className="grid size-6 place-items-center rounded-md border bg-card text-muted-foreground">
          <Icon className="size-3.5" />
        </span>
        {label}
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground tabular-nums">
          {count}
        </span>
      </h2>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

function ApprovalShell({
  refLabel, href, title, requesterName, requesterEmail, vip, when, detail, badges, decision,
}: {
  refLabel: string;
  href: string;
  title: string;
  requesterName: string;
  requesterEmail: string | null;
  vip?: boolean;
  when: Date;
  detail?: string;
  badges?: React.ReactNode;
  decision: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 transition-colors hover:border-foreground/15">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={href} className="font-mono text-xs text-muted-foreground hover:text-foreground">
              {refLabel}
            </Link>
            <span className="font-medium">{title}</span>
            {badges}
          </div>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <UserAvatar name={requesterName} email={requesterEmail ?? undefined} size="sm" />
            <span className="truncate">{requesterName}</span>
            {vip ? <VipBadge label={false} /> : null}
            <span className="shrink-0">· {formatDistanceToNow(when, { addSuffix: true })}</span>
          </p>
          {detail ? (
            <pre className="mt-1 whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 text-xs text-foreground/90">
              {detail}
            </pre>
          ) : null}
        </div>
        <div className="flex shrink-0 lg:justify-end">{decision}</div>
      </div>
    </div>
  );
}

/** Shown in place of decision controls when the viewer can't act (separation of
 *  duties) — you can't approve your own request / your own change. */
function SelfNote({
  approverName, label = "You raised this request", message,
}: {
  approverName?: string | null;
  label?: string;
  /** Replaces the default wording with the rule's own explanation. */
  message?: string;
}) {
  return (
    <div className="flex max-w-xs items-start gap-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
      <Info className="mt-0.5 size-3.5 shrink-0" />
      {message ? (
        <span>{message}</span>
      ) : (
        <span>
          {label} — it needs another approver
          {approverName ? <>. Waiting on <span className="font-medium text-foreground">{approverName}</span>.</> : "."}
        </span>
      )}
    </div>
  );
}
