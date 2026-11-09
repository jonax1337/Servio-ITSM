import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { portalCatalogItemWhere } from "@/lib/catalog-visibility";
import { getCurrentUser } from "@/lib/session";
import { ticketRef } from "@/lib/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Portal-scoped search for end users. Unlike /api/search (agent console), this
 * only surfaces what a requester is allowed to see: published & public
 * knowledge articles, published catalog items, and the caller's own tickets.
 */
export async function GET(req: Request) {
  // DB truth, not the JWT: a deactivated user must lose portal access immediately.
  const me = await getCurrentUser();
  if (!me || !me.isActive) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 1) return NextResponse.json({ results: [] });

  const idNum = parseInt(q.replace(/\D/g, ""), 10);
  const byId = Number.isFinite(idNum) ? [{ id: idNum }] : [];

  const [articles, catalog, tickets] = await Promise.all([
    db.article.findMany({
      where: {
        status: "PUBLISHED",
        visibility: "PUBLIC",
        OR: [{ title: { contains: q } }, { excerpt: { contains: q } }],
      },
      take: 5,
      orderBy: { views: "desc" },
      select: { slug: true, title: true, category: { select: { name: true } } },
    }),
    db.catalogItem.findMany({
      where: {
        ...portalCatalogItemWhere(me.id),
        OR: [{ name: { contains: q } }, { shortDescription: { contains: q } }, { description: { contains: q } }],
      },
      take: 5,
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: { id: true, name: true, category: { select: { name: true } } },
    }),
    db.ticket.findMany({
      where: { requesterId: me.id, OR: [{ title: { contains: q } }, ...byId] },
      take: 5,
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true, prefix: true },
    }),
  ]);

  const results = [
    ...articles.map((a) => ({
      group: "Answers",
      href: `/portal/knowledge/${a.slug}`,
      title: a.title,
      sub: a.category?.name ?? "Knowledge base",
    })),
    ...catalog.map((c) => ({
      group: "Services",
      href: `/portal/request/${c.id}`,
      title: c.name,
      sub: c.category?.name ?? "Catalog",
    })),
    ...tickets.map((t) => ({
      group: "Your requests",
      href: `/portal/tickets/${t.id}`,
      title: t.title,
      sub: ticketRef(t.id, t.prefix),
    })),
  ];

  return NextResponse.json({ results });
}
