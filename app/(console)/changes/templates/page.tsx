import Link from "next/link";
import { ArrowLeft, FileStack, Plus } from "lucide-react";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { PageHeader, PageBody } from "@/components/page-header";
import { LinkButton } from "@/components/link-button";
import { StatusBadge, ToneBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CHANGE_TYPE_META, RISK_META, type Meta } from "@/lib/constants";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("changes");
  return { title: t("templates.title") };
}
export const dynamic = "force-dynamic";


export default async function ChangeTemplatesPage() {
  await requireRole("MANAGER");
  const [t, tc] = await Promise.all([getT("changes"), getT("common")]);
  const ACTIVE_META: Meta = { label: tc("active"), tone: "success" };
  const OFF_META: Meta = { label: t("templates.off"), tone: "neutral" };
  const templates = await db.changeTemplate.findMany({
    include: { service: true, group: true, _count: { select: { changes: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <>
      <PageHeader
        icon={FileStack}
        title={t("templates.title")}
        description={t("templates.description")}
      >
        <LinkButton href="/changes" variant="outline">
          <ArrowLeft className="size-4" /> {t("list.title")}
        </LinkButton>
        <LinkButton href="/changes/templates/new">
          <Plus className="size-4" /> {t("templates.new")}
        </LinkButton>
      </PageHeader>

      <PageBody>
        {templates.length === 0 ? (
          <EmptyState
            icon={FileStack}
            title={t("templates.emptyTitle")}
            description={t("templates.emptyDescription")}
          >
            <LinkButton href="/changes/templates/new" size="sm">
              <Plus className="size-4" /> {t("templates.new")}
            </LinkButton>
          </EmptyState>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{tc("name")}</TableHead>
                  <TableHead>{tc("type")}</TableHead>
                  <TableHead>{tc("risk")}</TableHead>
                  <TableHead className="hidden md:table-cell">{tc("service")}</TableHead>
                  <TableHead className="hidden md:table-cell">{tc("group")}</TableHead>
                  <TableHead className="text-right">{t("templates.used")}</TableHead>
                  <TableHead>{tc("status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((tpl) => (
                  <TableRow key={tpl.id} className="group">
                    <TableCell className="max-w-[360px]">
                      <Link href={`/changes/templates/${tpl.id}`} className="block">
                        <span className="line-clamp-1 font-medium group-hover:text-primary">{tpl.name}</span>
                        {tpl.summary ? <span className="line-clamp-1 text-xs text-muted-foreground">{tpl.summary}</span> : null}
                      </Link>
                    </TableCell>
                    <TableCell><StatusBadge map={CHANGE_TYPE_META} value={tpl.type} dot /></TableCell>
                    <TableCell><StatusBadge map={RISK_META} value={tpl.risk} dot /></TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{tpl.service?.name ?? "—"}</TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{tpl.group?.name ?? "—"}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground">{tpl._count.changes}</TableCell>
                    <TableCell><ToneBadge meta={tpl.isActive ? ACTIVE_META : OFF_META} dot /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </PageBody>
    </>
  );
}
