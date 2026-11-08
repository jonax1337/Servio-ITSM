import type { Metadata } from "next";
import { FolderTree } from "lucide-react";
import { db } from "@/lib/db";
import { PageHeader, PageBody } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { CreateCategoryDialog } from "@/components/categories/create-category-dialog";
import { CategoryRowActions } from "@/components/categories/category-row-actions";
import type { CategoryData } from "@/components/categories/category-form";
import { CatalogIcon } from "@/components/catalog/catalog-icon";
import { cn } from "@/lib/utils";
import { getT } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("categories");
  return { title: t("title") };
}
export const dynamic = "force-dynamic";

type Team = { id: string; name: string };

type Node = {
  data: CategoryData;
  team: string | null;
  archived: boolean;
  ticketCount: number;
  deletable: boolean;
  children: Node[];
};

function Tree({
  t,
  nodes,
  parents,
  teams,
  depth = 0,
}: {
  t: Translator<"categories">;
  nodes: Node[];
  parents: { id: string; name: string }[];
  teams: Team[];
  depth?: number;
}) {
  return (
    <ul className={depth > 0 ? "ml-3 border-l pl-3" : "grid gap-0.5"}>
      {nodes.map((n) => (
        <li key={n.data.id} className="py-0.5">
          <div className={cn("group flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/40", n.archived && "opacity-60")}>
            <span
              className="grid size-6 shrink-0 place-items-center rounded-md border bg-muted"
              style={{ color: n.data.color }}
            >
              <CatalogIcon name={n.data.icon} className="size-3.5" />
            </span>
            <span className="font-medium">{n.data.name}</span>
            {n.data.description ? (
              <span className="truncate text-xs text-muted-foreground">{n.data.description}</span>
            ) : null}
            {n.team ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{n.team}</span>
            ) : null}
            {n.archived ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{t("archived")}</span>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              {n.ticketCount > 0 ? (
                <span className="text-xs text-muted-foreground">{t("ticketCount", { count: n.ticketCount })}</span>
              ) : null}
              <div className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <CategoryRowActions
                  category={n.data}
                  parents={parents}
                  teams={teams}
                  archived={n.archived}
                  deletable={n.deletable}
                />
              </div>
            </div>
          </div>
          {n.children.length > 0 ? <Tree t={t} nodes={n.children} parents={parents} teams={teams} depth={depth + 1} /> : null}
        </li>
      ))}
    </ul>
  );
}

export default async function CategoriesPage() {
  const t = await getT("categories");
  const [categories, teams] = await Promise.all([
    db.category.findMany({
      orderBy: { name: "asc" },
      include: {
        group: { select: { name: true } },
        _count: {
          select: {
            children: true, tickets: true, problems: true, changes: true, services: true, articles: true, catalogItems: true,
          },
        },
      },
    }),
    db.group.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  // Only non-archived categories are offered as parents for new/edited ones.
  const parents = categories.filter((c) => !c.archived).map((c) => ({ id: c.id, name: c.name }));

  const nodes: Node[] = categories.map((c) => {
    const refs = c._count.tickets + c._count.problems + c._count.changes + c._count.services + c._count.articles + c._count.catalogItems;
    return {
      data: { id: c.id, name: c.name, description: c.description, color: c.color, icon: c.icon, parentId: c.parentId, groupId: c.groupId },
      team: c.group?.name ?? null,
      archived: c.archived,
      ticketCount: c._count.tickets,
      deletable: refs === 0 && c._count.children === 0,
      children: [],
    };
  });
  const byId = new Map(nodes.map((n) => [n.data.id, n]));
  const roots: Node[] = [];
  for (const n of nodes) {
    if (n.data.parentId && byId.get(n.data.parentId)) byId.get(n.data.parentId)!.children.push(n);
    else roots.push(n);
  }

  return (
    <>
      <PageHeader
        icon={FolderTree}
        title={t("title")}
        description={t("description")}
      >
        <CreateCategoryDialog parents={parents} teams={teams} />
      </PageHeader>

      <PageBody>
        {roots.length === 0 ? (
          <EmptyState
            icon={FolderTree}
            title={t("emptyTitle")}
            description={t("emptyDescription")}
          >
            <CreateCategoryDialog parents={parents} teams={teams} size="sm" />
          </EmptyState>
        ) : (
          <Card>
            <CardContent>
              <Tree t={t} nodes={roots} parents={parents} teams={teams} />
            </CardContent>
          </Card>
        )}
      </PageBody>
    </>
  );
}
