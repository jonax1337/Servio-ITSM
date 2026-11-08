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
import {
  approvalTabs,
  changeSelfApprovalError,
  isChangeSelfApproval,
  requestSelfApprovalError,
  selfDecisionSettlesBoard,
  DEFAULT_APPROVAL_TAB,
  tabShowsSection,
} from "@/lib/approval-rules";
import { approverRolesForRisk } from "@/lib/cab";
import { getChangeSelfApprovalMode } from "@/lib/settings";
import type { SearchParams } from "@/lib/query";
import { ticketRef, changeRef, CHANGE_TYPE_META, RISK_META, APPROVAL_ENTITY_META, type ApprovalEntityType } from "@/lib/constants";
import { getEnumT, getFormatter, getServerMessageT, getT } from "@/lib/i18n/server";
import type { Formatter } from "@/lib/i18n/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("approvals");
  return { title: t("title") };
}
export const dynamic = "force-dynamic";

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const [t, tc, te, f, tm] = await Promise.all([getT("approvals"), getT("common"), getEnumT(), getFormatter(), getServerMessageT()]);
  const scope = me.role === "ADMIN" ? {} : { approverId: me.id };
  const [pending, pendingChanges, pendingAdHoc, selfApprovalMode] = await Promise.all([
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
    getChangeSelfApprovalMode(),
  ]);

  const total = pending.length + pendingChanges.length + pendingAdHoc.length;
  const tabs = approvalTabs({ changes: pendingChanges.length, requests: pending.length, other: pendingAdHoc.length }).map(
    (tab) => ({ ...tab, label: t.dyn(`tabs.${tab.key}`, undefined, tab.label) }),
  );
  const activeTab = resolveTab(sp, tabs, DEFAULT_APPROVAL_TAB);
  const nothingInTab = tabs.find((tab) => tab.key === activeTab)?.count === 0;

  return (
    <>
      <PageHeader
        icon={CheckSquare}
        title={t("title")}
        description={t("description")}
      >
        {total > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-sm font-medium tabular-nums">
            <span className="size-2 rounded-full bg-amber-500" />
            {t("pendingCount", { count: total })}
          </span>
        ) : null}
      </PageHeader>
      <PageBody className="grid gap-8">
        {total === 0 ? (
          <EmptyState
            icon={CheckSquare}
            title={t("emptyTitle")}
            description={t("emptyDescription")}
          />
        ) : (
          <>
            <EntityTabs
              tabs={tabs}
              active={activeTab}
              defaultTab={DEFAULT_APPROVAL_TAB}
              basePath="/approvals"
              searchParams={sp}
              label={t("tabsLabel")}
              className="-mb-4"
            />
            {nothingInTab ? (
              <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                {t("emptyTab")}
              </p>
            ) : null}
            {pending.length > 0 && tabShowsSection(activeTab, "requests") ? (
              <Section icon={CheckSquare} label={t("tabs.requests")} count={pending.length}>
                {pending.map((a) => {
                  const ticket = a.ticket;
                  const fields = parseFormSchema(ticket.catalogItem?.formSchema);
                  let answers = "";
                  try {
                    answers = answersToText(fields, JSON.parse(ticket.formData ?? "{}"));
                  } catch {
                    answers = "";
                  }
                  const selfApproval = requestSelfApprovalError(ticket.requesterId, me.id);
                  return (
                    <ApprovalShell
                      key={a.id}
                      refLabel={ticketRef(ticket.id, ticket.prefix)}
                      href={`/tickets/${ticket.id}`}
                      title={ticket.catalogItem?.name ?? ticket.title}
                      requesterName={ticket.requester.name ?? ticket.requester.email}
                      requesterEmail={ticket.requester.email}
                      vip={ticket.requester.isVip}
                      when={a.createdAt}
                      f={f}
                      detail={answers}
                      decision={
                        selfApproval ? <SelfNote message={tm(selfApproval)} /> : <ApprovalDecision approvalId={a.id} />
                      }
                    />
                  );
                })}
              </Section>
            ) : null}

            {pendingChanges.length > 0 && tabShowsSection(activeTab, "changes") ? (
              <Section icon={GitPullRequestArrow} label={t("sections.changes")} count={pendingChanges.length}>
                {pendingChanges.map((a) => {
                  const selfApproval = changeSelfApprovalError(a.change, me.id, {
                    mode: selfApprovalMode,
                    approverId: a.approverId,
                    role: me.role,
                    eligibleRoles: approverRolesForRisk(a.change.risk),
                  });
                  const ownSelfApproval = isChangeSelfApproval(a.change, me.id)
                    ? { settlesBoard: selfDecisionSettlesBoard(selfApprovalMode) }
                    : undefined;
                  return (
                    <ApprovalShell
                      key={a.id}
                      refLabel={changeRef(a.change.id)}
                      href={`/changes/${a.change.id}`}
                      title={a.change.title}
                      requesterName={a.change.assignee ? (a.change.assignee.name ?? a.change.assignee.email) : tc("unassigned")}
                      requesterEmail={a.change.assignee?.email ?? null}
                      when={a.createdAt}
                      f={f}
                      badges={
                        <>
                          <StatusBadge map={CHANGE_TYPE_META} value={a.change.type} dot />
                          <StatusBadge map={RISK_META} value={a.change.risk} dot />
                        </>
                      }
                      decision={
                        selfApproval ? (
                          <SelfNote message={tm(selfApproval)} />
                        ) : (
                          <ApprovalActions approvalId={a.id} selfApproval={ownSelfApproval} />
                        )
                      }
                    />
                  );
                })}
              </Section>
            ) : null}

            {pendingAdHoc.length > 0 && tabShowsSection(activeTab, "other") ? (
              <Section icon={ShieldCheck} label={t("sections.signOffs")} count={pendingAdHoc.length}>
                {pendingAdHoc.map((a) => {
                  const meta = APPROVAL_ENTITY_META[a.entityType as ApprovalEntityType];
                  const selfApproval = requestSelfApprovalError(a.requestedById, me.id);
                  const entityLabel = te(APPROVAL_ENTITY_META, a.entityType);
                  return (
                    <ApprovalShell
                      key={a.id}
                      refLabel={`${entityLabel} #${a.entityId}`}
                      href={`${meta.path}/${a.entityId}`}
                      title={a.title || t("entityApproval", { entity: entityLabel })}
                      requesterName={a.requestedBy ? (a.requestedBy.name ?? a.requestedBy.email) : t("requested")}
                      requesterEmail={a.requestedBy?.email ?? null}
                      when={a.createdAt}
                      f={f}
                      decision={
                        selfApproval ? <SelfNote message={tm(selfApproval)} /> : <EntityApprovalDecision approvalId={a.id} />
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
  refLabel, href, title, requesterName, requesterEmail, vip, when, f, detail, badges, decision,
}: {
  refLabel: string;
  href: string;
  title: string;
  requesterName: string;
  requesterEmail: string | null;
  vip?: boolean;
  when: Date;
  f: Formatter;
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
            <span className="shrink-0">· {f.relative(when)}</span>
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

/** Shown in place of decision controls when the viewer may not decide (four-eyes): says why. */
function SelfNote({ message }: { message: string }) {
  return (
    <div className="flex max-w-xs items-start gap-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
      <Info className="mt-0.5 size-3.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
