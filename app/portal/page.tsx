import Link from "next/link";
import {
  ArrowRight, ArrowUpRight, BookOpen, LifeBuoy, Ticket as TicketIcon, Clock, Eye,
} from "lucide-react";
import { CatalogIcon } from "@/components/catalog/catalog-icon";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { LinkButton } from "@/components/link-button";
import { StatusBadge } from "@/components/status-badge";
import { PortalHero } from "@/components/portal/portal-hero";
import { AllCaughtUpArt } from "@/components/portal/illustrations";
import { TICKET_STATUS_META, PRIORITY_META, ticketRef } from "@/lib/constants";
import { getFormatter, getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function PortalHome() {
  const me = await getSessionUser();
  const [t, f] = await Promise.all([getT("portal"), getFormatter()]);
  const [myTickets, catalog, articles] = await Promise.all([
    db.ticket.findMany({
      where: { requesterId: me?.id, status: { notIn: ["CLOSED", "CANCELLED"] } },
      orderBy: { updatedAt: "desc" },
      take: 4,
    }),
    db.catalogItem.findMany({ where: { isPublished: true }, orderBy: [{ order: "asc" }, { name: "asc" }], take: 6 }),
    // Only published, public-facing articles ever surface in the portal.
    db.article.findMany({ where: { status: "PUBLISHED", visibility: "PUBLIC" }, orderBy: { views: "desc" }, take: 5 }),
  ]);

  return (
    <div className="grid min-w-0 grid-cols-1 gap-10">
      <PortalHero firstName={me?.name?.split(" ")[0] ?? t("there")} />

      <div className="grid min-w-0 grid-cols-1 gap-10 lg:grid-cols-3">
        {/* My open requests */}
        <section className="lg:col-span-2">
          <SectionHeader
            icon={TicketIcon}
            title={t("yourOpenRequests")}
            action={{ href: "/portal/tickets", label: t("viewAll") }}
          />
          {myTickets.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border bg-card px-6 py-10 text-center">
              <AllCaughtUpArt className="h-24 w-24" />
              <p className="text-sm font-medium">{t("allCaughtUp")}</p>
              <p className="max-w-xs text-sm text-muted-foreground">
                {t("nothingOpen")}
              </p>
              <LinkButton href="/portal/new" size="sm" variant="outline" className="mt-1">
                {t("newRequest")}
              </LinkButton>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border bg-card divide-y">
              {myTickets.map((tk) => (
                <Link
                  key={tk.id}
                  href={`/portal/tickets/${tk.id}`}
                  className="group flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/40"
                >
                  <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">
                    {ticketRef(tk.id, tk.prefix)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{tk.title}</span>
                  <StatusBadge map={PRIORITY_META} value={tk.priority} dot />
                  <StatusBadge map={TICKET_STATUS_META} value={tk.status} />
                  <span className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground sm:block">
                    {f.relative(tk.updatedAt)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Popular answers */}
        <section>
          <SectionHeader
            icon={BookOpen}
            title={t("popularAnswers")}
            action={{ href: "/portal/knowledge", label: t("allArticles") }}
          />
          {articles.length === 0 ? (
            <div className="rounded-2xl border border-dashed bg-card/40 px-4 py-10 text-center text-sm text-muted-foreground">
              {t("noArticlesPublished")}
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border bg-card divide-y">
              {articles.map((a) => (
                <Link
                  key={a.id}
                  href={`/portal/knowledge/${a.slug}`}
                  className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
                >
                  <span className="min-w-0 flex-1 truncate text-sm">{a.title}</span>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <Eye className="size-3.5" /> {a.views}
                  </span>
                  <ArrowUpRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Service catalog preview */}
      {catalog.length > 0 ? (
        <section>
          <SectionHeader
            icon={LifeBuoy}
            title={t("popularServices")}
            action={{ href: "/portal/catalog", label: t("browseCatalog") }}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {catalog.map((it) => (
              <Link
                key={it.id}
                href={`/portal/request/${it.id}`}
                className="group flex items-start gap-3 rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/20"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                  <CatalogIcon name={it.icon} className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1 text-sm font-medium">
                    {it.name}
                    <ArrowRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </span>
                  <span className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {it.shortDescription ?? it.description}
                  </span>
                  {it.estimatedDays != null ? (
                    <span className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Clock className="size-3" /> {t("aboutDays", { count: it.estimatedDays })}
                    </span>
                  ) : null}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight">
        <Icon className="size-4.5 text-muted-foreground" />
        {title}
      </h2>
      {action ? (
        <Link
          href={action.href}
          className="flex items-center gap-1 text-sm font-medium text-primary transition-opacity hover:opacity-80"
        >
          {action.label} <ArrowRight className="size-3.5" />
        </Link>
      ) : null}
    </div>
  );
}
