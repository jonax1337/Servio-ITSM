import Link from "next/link";
import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { AllCaughtUpArt } from "@/components/portal/illustrations";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { LinkButton } from "@/components/link-button";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import {
  TICKET_STATUS_META, PRIORITY_META, TICKET_TYPE_META, ticketRef,
} from "@/lib/constants";
import type { SearchParams } from "@/lib/query";
import { getParam } from "@/lib/query";
import { getFormatter, getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("portal");
  return { title: t("myTickets") };
}
export const dynamic = "force-dynamic";

const CLOSED = ["CLOSED", "CANCELLED"];

export default async function PortalTickets({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireUser();
  const [t, f] = await Promise.all([getT("portal"), getFormatter()]);
  const filter = getParam(await searchParams, "filter") === "all" ? "all" : "open";

  // A portal user sees a ticket if they are the requester OR a participant
  // (e.g. a manager CC'd on the request).
  const visible = { OR: [{ requesterId: me.id }, { participants: { some: { userId: me.id } } }] };

  const [tickets, openCount, totalCount] = await Promise.all([
    db.ticket.findMany({
      where: { ...visible, ...(filter === "open" ? { status: { notIn: CLOSED } } : {}) },
      orderBy: { updatedAt: "desc" },
    }),
    db.ticket.count({ where: { ...visible, status: { notIn: CLOSED } } }),
    db.ticket.count({ where: { ...visible } }),
  ]);

  const tabs = [
    { key: "open", label: t("tabOpen"), count: openCount, href: "/portal/tickets" },
    { key: "all", label: t("tabAll"), count: totalCount, href: "/portal/tickets?filter=all" },
  ];

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">{t("myTickets")}</h1>
          <p className="mt-1 text-muted-foreground">
            {t("myTicketsDescription")}
          </p>
        </div>
        <LinkButton href="/portal/new"><Plus className="size-4" /> {t("newRequest")}</LinkButton>
      </div>

      <div className="flex items-center gap-1 border-b">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={filter === tab.key ? "page" : undefined}
            className={cn(
              "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              filter === tab.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            <span className="rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
              {tab.count}
            </span>
          </Link>
        ))}
      </div>

      {tickets.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border bg-card px-6 py-14 text-center">
          <AllCaughtUpArt className="h-28 w-28" />
          <p className="font-medium">{filter === "open" ? t("allCaughtUp") : t("noTicketsYet")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {filter === "open" ? t("nothingWaiting") : t("submitToSee")}
          </p>
          <LinkButton href="/portal/new" size="sm" variant="outline" className="mt-1">{t("newRequest")}</LinkButton>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card divide-y">
          {tickets.map((tk) => (
            <Link
              key={tk.id}
              href={`/portal/tickets/${tk.id}`}
              className="flex flex-wrap items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/40"
            >
              <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">
                {ticketRef(tk.id, tk.prefix)}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{tk.title}</span>
              <StatusBadge map={TICKET_TYPE_META} value={tk.type} dot />
              <StatusBadge map={PRIORITY_META} value={tk.priority} dot />
              <StatusBadge map={TICKET_STATUS_META} value={tk.status} />
              <span className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground sm:block">
                {f.relative(tk.updatedAt)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
