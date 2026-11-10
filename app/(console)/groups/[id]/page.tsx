import { canReadConsoleTitle } from "@/lib/metadata-access";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Users, Mail, Ticket as TicketIcon, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { getFormOptions } from "@/lib/data/options";
import { getSessionUser, hasRole, type Role } from "@/lib/session";
import { DetailShell, DetailTitle, DetailTopBar, MetaRow, RailCard } from "@/components/detail-layout";
import { StatusBadge } from "@/components/status-badge";
import { UserAvatar } from "@/components/user-avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { AutoAssignControl } from "@/components/groups/auto-assign-control";
import { GroupEditDialog } from "@/components/groups/group-edit-dialog";
import { GroupMembers } from "@/components/groups/group-members";
import { ConfirmButton } from "@/components/confirm-dialog";
import { deleteGroup } from "@/lib/actions/groups";
import { GROUP_TYPE_META, OPEN_TICKET_STATUSES } from "@/lib/constants";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  if (!(await canReadConsoleTitle())) return {};
  const { id } = await params;
  const g = await db.group.findUnique({ where: { id }, select: { name: true } });
  return { title: g ? g.name : (await getT("groups"))("group") };
}

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [group, me, options] = await Promise.all([
    db.group.findUnique({
      where: { id },
      include: {
        manager: true,
        members: { include: { user: true }, orderBy: { role: "asc" } },
      },
    }),
    getSessionUser(),
    getFormOptions(),
  ]);
  if (!group) notFound();
  const canManage = !!me && hasRole(me.role as Role, "MANAGER");
  const t = await getT("groups");

  const openTickets = await db.ticket.count({
    where: { groupId: group.id, status: { in: [...OPEN_TICKET_STATUSES] } },
  });

  // Agents not already in the group — the pool for the "add member" picker.
  const memberIds = new Set(group.members.map((m) => m.userId));
  const candidates = options.agents.filter((a) => !memberIds.has(a.id));

  const rail = (
    <>
      <RailCard title={t("details")}>
        <MetaRow label={t("manager")}>{group.manager ? (group.manager.name ?? group.manager.email) : "—"}</MetaRow>
        <MetaRow label={t("email")}>
          {group.email ? (
            <span className="inline-flex items-center gap-1.5">
              <Mail className="size-3.5" /> {group.email}
            </span>
          ) : (
            "—"
          )}
        </MetaRow>
      </RailCard>

      <RailCard title={t("autoAssignment")}>
        <AutoAssignControl groupId={group.id} value={group.autoAssign} />
        <p className="text-xs text-muted-foreground">{t("autoAssignmentText")}</p>
      </RailCard>
    </>
  );

  return (
    <DetailShell aside={rail}>
      <DetailTopBar
        backHref="/groups"
        backLabel={t("backToGroups")}
        lead={<span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: group.color }} />}
      >
        {canManage ? (
          <>
            <GroupEditDialog group={group} agents={options.agents} />
            <ConfirmButton
              action={deleteGroup}
              fields={{ id: group.id }}
              title={t("deleteGroup")}
              description={t("deleteGroupText", { name: group.name })}
              confirmLabel={t("deleteGroup")}
              triggerVariant="outline"
              triggerSize="icon-sm"
              triggerLabel={t("deleteGroup")}
              triggerClassName="text-muted-foreground hover:border-destructive/40 hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </ConfirmButton>
          </>
        ) : null}
        <StatusBadge map={GROUP_TYPE_META} value={group.type} dot />
      </DetailTopBar>

      <div className="p-4 sm:p-6">
        <DetailTitle title={group.name} subtitle={group.description} />

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <StatCard
            label={t("openTickets")}
            value={openTickets}
            icon={TicketIcon}
            href={`/tickets?status=open`}
            tone="primary"
          />
          <StatCard label={t("members")} value={group.members.length} icon={Users} tone="muted" />
        </div>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-sm">{t("membersCount", { count: group.members.length })}</CardTitle>
          </CardHeader>
          <CardContent>
            {canManage ? (
              <GroupMembers groupId={group.id} members={group.members} candidates={candidates} />
            ) : group.members.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noMembers")}</p>
            ) : (
              <div className="grid gap-1">
                {group.members.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-accent/50"
                  >
                    <UserAvatar
                      name={m.user.name}
                      email={m.user.email}
                      className="shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-1 text-sm font-medium">
                        {m.user.name ?? m.user.email}
                      </div>
                      <div className="line-clamp-1 text-xs text-muted-foreground">
                        {m.user.email}
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                        m.role === "LEAD"
                          ? "border-primary/20 bg-primary/10 text-primary"
                          : "border-border bg-muted text-muted-foreground"
                      }`}
                    >
                      {m.role === "LEAD" ? t("lead") : t("member")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DetailShell>
  );
}
