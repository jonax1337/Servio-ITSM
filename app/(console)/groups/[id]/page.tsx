import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, Users, Mail, Ticket as TicketIcon, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { getFormOptions } from "@/lib/data/options";
import { getSessionUser, hasRole, type Role } from "@/lib/session";
import { LinkButton } from "@/components/link-button";
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

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const g = await db.group.findUnique({ where: { id }, select: { name: true } });
  return { title: g ? g.name : "Group" };
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

  const openTickets = await db.ticket.count({
    where: { groupId: group.id, status: { in: [...OPEN_TICKET_STATUSES] } },
  });

  // Agents not already in the group — the pool for the "add member" picker.
  const memberIds = new Set(group.members.map((m) => m.userId));
  const candidates = options.agents.filter((a) => !memberIds.has(a.id));

  return (
    <>
      <div className="flex items-center gap-3 border-b px-4 py-3 sm:px-6">
        <LinkButton href="/groups" variant="ghost" size="icon-sm" aria-label="Back to groups">
          <ArrowLeft className="size-4" />
        </LinkButton>
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: group.color }}
        />
        <h1 className="font-display text-lg font-semibold tracking-tight">
          {group.name}
        </h1>
        <StatusBadge map={GROUP_TYPE_META} value={group.type} dot />
        {canManage ? (
          <div className="ml-auto flex items-center gap-2">
            <GroupEditDialog group={group} agents={options.agents} />
            <ConfirmButton
              action={deleteGroup}
              fields={{ id: group.id }}
              title="Delete group"
              description={`Permanently delete "${group.name}"? Members are removed; tickets, changes and other records are kept but unassigned from this group.`}
              confirmLabel="Delete group"
              triggerVariant="outline"
              triggerSize="icon-sm"
              triggerLabel="Delete group"
              triggerClassName="text-muted-foreground hover:border-destructive/40 hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </ConfirmButton>
          </div>
        ) : null}
      </div>

      <div className="p-4 sm:p-6">
        {group.description ? (
          <p className="mb-6 max-w-2xl text-sm text-muted-foreground">
            {group.description}
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label="Open tickets"
            value={openTickets}
            icon={TicketIcon}
            href={`/tickets?status=open`}
            tone="primary"
          />
          <StatCard label="Members" value={group.members.length} icon={Users} tone="muted" />
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_320px]">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Members · {group.members.length}</CardTitle>
            </CardHeader>
            <CardContent>
              {canManage ? (
                <GroupMembers groupId={group.id} members={group.members} candidates={candidates} />
              ) : group.members.length === 0 ? (
                <p className="text-sm text-muted-foreground">No members yet.</p>
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
                        {m.role === "LEAD" ? "Lead" : "Member"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid content-start gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Details</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Manager</span>
                  <span className="text-right font-medium">
                    {group.manager ? (group.manager.name ?? group.manager.email) : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Email</span>
                  {group.email ? (
                    <span className="inline-flex items-center gap-1.5 text-right font-medium">
                      <Mail className="size-3.5" /> {group.email}
                    </span>
                  ) : (
                    <span className="font-medium">—</span>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Auto-assignment</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2">
                <AutoAssignControl groupId={group.id} value={group.autoAssign} />
                <p className="text-xs text-muted-foreground">
                  New tickets routed to this team are assigned automatically. Round-robin cycles through members; least busy picks the agent with the fewest open tickets.
                </p>
              </CardContent>
            </Card>

          </div>
        </div>
      </div>
    </>
  );
}
