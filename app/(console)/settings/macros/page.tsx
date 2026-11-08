import type { Metadata } from "next";
import { MessageSquareText } from "lucide-react";
import { db } from "@/lib/db";
import { requireRole, hasRole, type Role } from "@/lib/session";
import { getFormOptions } from "@/lib/data/options";
import { PageHeader, PageBody } from "@/components/page-header";
import { MacroManager, type MacroRow } from "@/components/settings/macro-manager";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("settings");
  return { title: t("macros.metaTitle") };
}
export const dynamic = "force-dynamic";

export default async function MacrosSettingsPage() {
  // Agents reach this page for their PERSONAL macros; sharing stays MANAGER+.
  const me = await requireRole("AGENT");
  const canShare = hasRole(me.role as Role, "MANAGER");
  const t = await getT("settings");

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
        title={t("macros.title")}
        description={t("macros.description")}
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
