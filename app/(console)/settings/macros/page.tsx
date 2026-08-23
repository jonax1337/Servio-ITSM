import type { Metadata } from "next";
import { MessageSquareText } from "lucide-react";
import { db } from "@/lib/db";
import { requireRole, hasRole, type Role } from "@/lib/session";
import { getFormOptions } from "@/lib/data/options";
import { PageHeader, PageBody } from "@/components/page-header";
import { MacroManager, type MacroRow } from "@/components/settings/macro-manager";

export const metadata: Metadata = { title: "Macros" };
export const dynamic = "force-dynamic";

export default async function MacrosSettingsPage() {
  // Agents reach this page for their PERSONAL macros; sharing stays MANAGER+.
  const me = await requireRole("AGENT");
  const canShare = hasRole(me.role as Role, "MANAGER");

  const [macros, options] = await Promise.all([
    // Show shared macros + the current user's personal macros.
    db.macro.findMany({
      where: { OR: [{ isShared: true }, { ownerId: me.id }] },
      include: { owner: { select: { name: true, email: true } } },
      orderBy: [{ isShared: "desc" }, { updatedAt: "desc" }],
    }),
    getFormOptions(),
  ]);

  const rows: MacroRow[] = macros.map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    actions: m.actions,
    isShared: m.isShared,
    ownerId: m.ownerId,
    ownerName: m.owner?.name ?? m.owner?.email ?? null,
    canManage: m.isShared ? canShare : m.ownerId === me.id,
  }));

  return (
    <>
      <PageHeader
        icon={MessageSquareText}
        title="Macros"
        description="One-click bundles of actions — set status/priority, route, assign and post a canned reply — that agents can apply to a ticket. Shared macros are available to every agent; personal macros are only yours."
      />
      <PageBody>
        <MacroManager
          macros={rows}
          canShare={canShare}
          agents={options.agents.map((a) => ({ value: a.id, label: a.name ?? a.email, hint: a.email }))}
          groups={options.groups.map((g) => ({ value: g.id, label: g.name }))}
        />
      </PageBody>
    </>
  );
}
