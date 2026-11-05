import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  ArrowLeft,
  Mail,
  Phone,
  Building2,
  Briefcase,
  Users as UsersIcon,
  Ticket as TicketIcon,
  Server,
} from "lucide-react";
import { db } from "@/lib/db";
import { requireUser, hasRole } from "@/lib/session";
import { LinkButton } from "@/components/link-button";
import { StatusBadge, VipBadge } from "@/components/status-badge";
import { UserProperties } from "@/components/people/user-properties";
import { PersonDialog } from "@/components/people/person-dialog";
import { UserAvatar } from "@/components/user-avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ROLE_META,
  GROUP_TYPE_META,
  OPEN_TICKET_STATUSES,
  TICKET_STATUS_META,
  ASSET_TYPE_META,
  ASSET_STATUS_META,
  ticketRef,
} from "@/lib/constants";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const u = await db.user.findUnique({
    where: { id },
    select: { name: true, email: true },
  });
  return { title: u ? u.name ?? u.email : "Person" };
}

export default async function PersonDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await requireUser();

  const [user, openTickets, ownedAssets] = await Promise.all([
    db.user.findUnique({
      where: { id },
      include: {
        memberships: { include: { group: true } },
        syncSource: { select: { name: true } },
      },
    }),
    // Tickets this person has open as the REQUESTER — "what they have open".
    db.ticket.findMany({
      where: { requesterId: id, status: { in: [...OPEN_TICKET_STATUSES] } },
      select: { id: true, title: true, prefix: true, status: true },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
    // Configuration items assigned to this person.
    db.asset.findMany({
      where: { ownerId: id },
      select: { id: true, name: true, type: true, status: true, assetTag: true },
      orderBy: { name: "asc" },
      take: 20,
    }),
  ]);
  if (!user) notFound();

  const displayName = user.name ?? user.email;

  return (
    <div className="grid gap-0 lg:h-[calc(100svh-3.5rem)] lg:grid-cols-[1fr_320px] lg:overflow-hidden">
      {/* Main column — scrolls independently from the properties rail */}
      <div className="min-w-0 border-b lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-3 border-b px-4 py-3 sm:px-6">
          <LinkButton href="/people" variant="ghost" size="icon-sm" aria-label="Back to people">
            <ArrowLeft className="size-4" />
          </LinkButton>
          <span className="text-sm text-muted-foreground">People</span>
          <div className="ml-auto flex items-center gap-2">
            {hasRole(me.role, "ADMIN") ? (
              <PersonDialog
                person={{
                  id: user.id, name: user.name, email: user.email,
                  phone: user.phone, jobTitle: user.jobTitle, department: user.department,
                }}
                syncSourceName={user.syncSource?.name ?? null}
              />
            ) : null}
            <StatusBadge map={ROLE_META} value={user.role} />
            <span className="inline-flex items-center gap-2 rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground">
              <span
                className={
                  user.isActive
                    ? "size-1.5 rounded-full bg-emerald-500"
                    : "size-1.5 rounded-full bg-muted-foreground/40"
                }
              />
              {user.isActive ? "Active" : "Inactive"}
            </span>
          </div>
        </div>

        <div className="p-4 sm:p-6">
          {/* Profile header */}
          <div className="flex items-start gap-4">
            <UserAvatar
              name={user.name}
              email={user.email}
              image={user.image}
              size="lg"
              className="size-16 text-lg"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="font-display text-2xl font-semibold tracking-tight">
                  {displayName}
                </h1>
                {user.isVip ? <VipBadge /> : null}
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {user.jobTitle ?? "—"}
                {user.department ? ` · ${user.department}` : ""}
              </p>
            </div>
          </div>

          {/* Contact rows */}
          <div className="mt-6 grid gap-3 rounded-xl border bg-card p-4 text-sm sm:grid-cols-2">
            <ContactRow icon={Mail} label="Email" value={user.email} />
            <ContactRow icon={Phone} label="Phone" value={user.phone ?? "—"} />
            <ContactRow
              icon={Briefcase}
              label="Job title"
              value={user.jobTitle ?? "—"}
            />
            <ContactRow
              icon={Building2}
              label="Department"
              value={user.department ?? "—"}
            />
          </div>

          {/* Open tickets this person has raised */}
          <div className="mt-8">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
              <TicketIcon className="size-4 text-muted-foreground" />
              Open tickets · {openTickets.length}
            </h2>
            {openTickets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No open tickets.</p>
            ) : (
              <div className="overflow-hidden rounded-xl border bg-card">
                {openTickets.map((t) => (
                  <Link
                    key={t.id}
                    href={`/tickets/${t.id}`}
                    className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0 hover:bg-accent"
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      {ticketRef(t.id, t.prefix)}
                    </span>
                    <span className="line-clamp-1 flex-1 text-sm font-medium">{t.title}</span>
                    <StatusBadge map={TICKET_STATUS_META} value={t.status} />
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Assets assigned to this person */}
          <div className="mt-8">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
              <Server className="size-4 text-muted-foreground" />
              Assigned assets · {ownedAssets.length}
            </h2>
            {ownedAssets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No assets assigned to this person.</p>
            ) : (
              <div className="overflow-hidden rounded-xl border bg-card">
                {ownedAssets.map((a) => (
                  <Link
                    key={a.id}
                    href={`/assets/${a.id}`}
                    className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0 hover:bg-accent"
                  >
                    <StatusBadge map={ASSET_TYPE_META} value={a.type} dot />
                    <span className="line-clamp-1 flex-1 text-sm font-medium">
                      {a.name}
                      {a.assetTag ? <span className="ml-1.5 font-mono text-xs text-muted-foreground">{a.assetTag}</span> : null}
                    </span>
                    <StatusBadge map={ASSET_STATUS_META} value={a.status} />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sidebar */}
      <aside className="p-4 sm:p-6 lg:min-h-0 lg:overflow-y-auto">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Access</CardTitle>
          </CardHeader>
          <CardContent>
            <UserProperties
              user={{
                id: user.id,
                role: user.role,
                isActive: user.isActive,
                isVip: user.isVip,
              }}
            />
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <UsersIcon className="size-4 text-muted-foreground" />
              Groups · {user.memberships.length}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {user.memberships.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Not a member of any group.
              </p>
            ) : (
              user.memberships.map((m) => (
                <Link
                  key={m.id}
                  href={`/groups/${m.group.id}`}
                  className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 hover:border-primary/40"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="size-2 rounded-full"
                      style={{ backgroundColor: m.group.color }}
                    />
                    <span className="font-medium">{m.group.name}</span>
                  </span>
                  <StatusBadge map={GROUP_TYPE_META} value={m.group.type} dot={false} />
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-sm">Details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2.5 text-sm">
            <Meta
              label="Last login"
              value={
                user.lastLoginAt ? format(user.lastLoginAt, "PP p") : "Never"
              }
            />
            <Meta label="Created" value={format(user.createdAt, "PP")} />
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function ContactRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border bg-card text-muted-foreground">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="truncate font-medium">{value}</div>
      </div>
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
