import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser, isAgent, type Role } from "@/lib/session";
import { ticketRef, problemRef, changeRef } from "@/lib/constants";
import { ticketSearchWhere } from "@/lib/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // DB-truth guard: the JWT freezes role/isActive at login, so rehydrate from
  // the DB — a deactivated or demoted user must not keep org-wide search until
  // token expiry.
  const me = await getCurrentUser();
  if (!me || !me.isActive) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  // Console search: agents/managers/admins search org-wide; a USER-role session
  // (portal JWT) only ever sees their own tickets — never the whole CMDB, staff
  // directory or other people's requests.
  if (!isAgent(me.role as Role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 1) return NextResponse.json({ results: [] });

  const idNum = parseInt(q.replace(/\D/g, ""), 10);
  const byId = Number.isFinite(idNum) ? [{ id: idNum }] : [];

  // Tickets match across title/description/comments/requester/custom-fields
  // (see lib/search.ts), while the lighter entities stay title-only.
  const ticketWhere = ticketSearchWhere(q) ?? { OR: [{ title: { contains: q } }, ...byId] };

  const [tickets, problems, changes, assets, people, services] = await Promise.all([
    db.ticket.findMany({ where: ticketWhere, take: 6, orderBy: { updatedAt: "desc" }, select: { id: true, title: true, prefix: true } }),
    db.problem.findMany({ where: { OR: [{ title: { contains: q } }, ...byId] }, take: 4, select: { id: true, title: true } }),
    db.change.findMany({ where: { OR: [{ title: { contains: q } }, ...byId] }, take: 4, select: { id: true, title: true } }),
    db.asset.findMany({ where: { OR: [{ name: { contains: q } }, { assetTag: { contains: q } }, { serial: { contains: q } }] }, take: 5, select: { id: true, name: true, assetTag: true } }),
    db.user.findMany({ where: { OR: [{ name: { contains: q } }, { email: { contains: q } }] }, take: 5, select: { id: true, name: true, email: true } }),
    db.service.findMany({ where: { name: { contains: q } }, take: 4, select: { id: true, name: true } }),
  ]);

  const results = [
    ...tickets.map((t) => ({ group: "Tickets", kind: "ticket" as const, id: t.id, href: `/tickets/${t.id}`, title: t.title, sub: ticketRef(t.id, t.prefix) })),
    ...problems.map((p) => ({ group: "Problems", kind: "problem" as const, id: p.id, href: `/problems/${p.id}`, title: p.title, sub: problemRef(p.id) })),
    ...changes.map((c) => ({ group: "Changes", kind: "change" as const, id: c.id, href: `/changes/${c.id}`, title: c.title, sub: changeRef(c.id) })),
    ...assets.map((a) => ({ group: "Assets", kind: "asset" as const, id: a.id, href: `/assets/${a.id}`, title: a.name, sub: a.assetTag ?? "Asset" })),
    ...people.map((u) => ({ group: "People", kind: "user" as const, id: u.id, href: `/people/${u.id}`, title: u.name ?? u.email, sub: u.email })),
    ...services.map((s) => ({ group: "Services", kind: "service" as const, id: s.id, href: `/services/${s.id}`, title: s.name, sub: "Service" })),
  ];

  return NextResponse.json({ results });
}
