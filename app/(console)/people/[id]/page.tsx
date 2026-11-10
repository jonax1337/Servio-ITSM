import { canReadConsoleTitle } from "@/lib/metadata-access";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireUser, hasRole } from "@/lib/session";
import { DetailShell, DetailTopBar, MetaRow, RailCard } from "@/components/detail-layout";
import { EntityTabs, resolveTab } from "@/components/entity-tabs";
import { StatusBadge, ToneBadge, VipBadge } from "@/components/status-badge";
import { UserProperties } from "@/components/people/user-properties";
import { PersonDialog } from "@/components/people/person-dialog";
import { buildPersonTabs, DEFAULT_PERSON_TAB } from "@/components/people/person-tabs";
import { UserAvatar } from "@/components/user-avatar";
import {
  ROLE_META,
  GROUP_TYPE_META,
  OPEN_TICKET_STATUSES,
  TICKET_STATUS_META,
  ASSET_TYPE_META,
  ASSET_STATUS_META,
  ticketRef,
} from "@/lib/constants";
import type { SearchParams } from "@/lib/query";
import { getFormatter, getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  if (!(await canReadConsoleTitle())) return {};
  const { id } = await params;
  const u = await db.user.findUnique({
    where: { id },
    select: { name: true, email: true },
  });
  return { title: u ? u.name ?? u.email : (await getT("people"))("person") };
}

export default async function PersonDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const me = await requireUser();
  const [t, f] = await Promise.all([getT("people"), getFormatter()]);

  const [user, openTickets, ownedAssets] = await Promise.all([
    db.user.findUnique({
      where: { id },
      include: {
        memberships: { include: { group: true } },
        syncSource: { select: { name: true } },
        secondaryEmails: { select: { email: true }, orderBy: { createdAt: "asc" } },
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
  const secondaryEmails = user.secondaryEmails.map((e) => e.email);

  const tabs = buildPersonTabs({
    openTickets: openTickets.length,
    assets: ownedAssets.length,
    groups: user.memberships.length,
  }).map((tab) => ({ ...tab, label: t(`tab.${tab.key}`) }));
  const active = resolveTab(sp, tabs, DEFAULT_PERSON_TAB);

  const rail = (
    <>
      <RailCard title={t("access")}>
        <UserProperties
          user={{
            id: user.id,
            role: user.role,
            isActive: user.isActive,
            isVip: user.isVip,
          }}
        />
      </RailCard>

      <RailCard title={t("contact")}>
        <MetaRow label={t("email")}>{user.email}</MetaRow>
        {secondaryEmails.length > 0 ? <MetaRow label={t("secondaryEmails")}>{secondaryEmails.join(", ")}</MetaRow> : null}
        <MetaRow label={t("phone")}>{user.phone ?? "—"}</MetaRow>
        <MetaRow label={t("jobTitle")}>{user.jobTitle ?? "—"}</MetaRow>
        <MetaRow label={t("department")}>{user.department ?? "—"}</MetaRow>
      </RailCard>

      <RailCard title={t("details")}>
        <MetaRow label={t("lastLogin")}>{user.lastLoginAt ? f.date(user.lastLoginAt, "dateTime") : t("never")}</MetaRow>
        <MetaRow label={t("created")}>{f.date(user.createdAt)}</MetaRow>
      </RailCard>
    </>
  );

  return (
    <DetailShell aside={rail}>
      <DetailTopBar
        backHref="/people"
        backLabel={t("backToPeople")}
        lead={<span className="text-sm text-muted-foreground">{t("title")}</span>}
      >
        {hasRole(me.role, "ADMIN") ? (
          <PersonDialog
            person={{
              id: user.id, name: user.name, email: user.email,
              phone: user.phone, jobTitle: user.jobTitle, department: user.department,
              secondaryEmails: secondaryEmails,
              isServiceAccount: user.isServiceAccount,
              canApproveChanges: user.canApproveChanges,
            }}
            syncSourceName={user.syncSource?.name ?? null}
          />
        ) : null}
        <StatusBadge map={ROLE_META} value={user.role} />
        <ToneBadge meta={user.isActive ? { label: t("active"), tone: "success" } : { label: t("inactive"), tone: "neutral" }} dot />
      </DetailTopBar>

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
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl font-semibold tracking-tight wrap-anywhere">
                {displayName}
              </h1>
              {user.isVip ? <VipBadge /> : null}
              {user.isServiceAccount ? <ToneBadge meta={{ label: t("serviceAccountBadge"), tone: "neutral" }} icon={false} /> : null}
              {user.isServiceAccount && user.canApproveChanges ? <ToneBadge meta={{ label: t("serviceAccountApprovesBadge"), tone: "warning" }} icon={false} /> : null}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {user.jobTitle ?? "—"}
              {user.department ? ` · ${user.department}` : ""}
            </p>
          </div>
        </div>

        <EntityTabs
          className="mt-6"
          tabs={tabs}
          active={active}
          defaultTab={DEFAULT_PERSON_TAB}
          basePath={`/people/${user.id}`}
          searchParams={sp}
          label={t("sections")}
        />

        <div className="mt-6">
          {active === "tickets" ? (
            openTickets.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noOpenTickets")}</p>
            ) : (
              <div className="overflow-hidden rounded-xl border bg-card">
                {openTickets.map((tk) => (
                  <Link
                    key={tk.id}
                    href={`/tickets/${tk.id}`}
                    className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0 hover:bg-accent"
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      {ticketRef(tk.id, tk.prefix)}
                    </span>
                    <span className="line-clamp-1 flex-1 text-sm font-medium">{tk.title}</span>
                    <StatusBadge map={TICKET_STATUS_META} value={tk.status} />
                  </Link>
                ))}
              </div>
            )
          ) : null}

          {active === "assets" ? (
            ownedAssets.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noAssets")}</p>
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
            )
          ) : null}

          {active === "groups" ? (
            user.memberships.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noGroups")}</p>
            ) : (
              <div className="overflow-hidden rounded-xl border bg-card">
                {user.memberships.map((m) => (
                  <Link
                    key={m.id}
                    href={`/groups/${m.group.id}`}
                    className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0 hover:bg-accent"
                  >
                    <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: m.group.color }} />
                    <span className="line-clamp-1 flex-1 text-sm font-medium">{m.group.name}</span>
                    <StatusBadge map={GROUP_TYPE_META} value={m.group.type} dot={false} />
                  </Link>
                ))}
              </div>
            )
          ) : null}
        </div>
      </div>
    </DetailShell>
  );
}
