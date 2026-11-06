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

export const metadata: Metadata = { title: "Change templates" };
export const dynamic = "force-dynamic";

const ACTIVE_META: Meta = { label: "Active", tone: "success" };
const OFF_META: Meta = { label: "Switched off", tone: "neutral" };

export default async function ChangeTemplatesPage() {
  await requireRole("MANAGER");
  const templates = await db.changeTemplate.findMany({
    include: { service: true, group: true, _count: { select: { changes: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <>
      <PageHeader
        icon={FileStack}
        title="Change templates"
        description="Prefilled changes for work that repeats. Standard templates are pre-approved on creation."
      >
        <LinkButton href="/changes" variant="outline">
          <ArrowLeft className="size-4" /> Changes
        </LinkButton>
        <LinkButton href="/changes/templates/new">
          <Plus className="size-4" /> New template
        </LinkButton>
      </PageHeader>

      <PageBody>
        {templates.length === 0 ? (
          <EmptyState
            icon={FileStack}
            title="No templates yet"
            description="Create a standard template for low-risk, repeatable work such as certificate rotation."
          >
            <LinkButton href="/changes/templates/new" size="sm">
              <Plus className="size-4" /> New template
            </LinkButton>
          </EmptyState>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead className="hidden md:table-cell">Service</TableHead>
                  <TableHead className="hidden md:table-cell">Group</TableHead>
                  <TableHead className="text-right">Used</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((t) => (
                  <TableRow key={t.id} className="group">
                    <TableCell className="max-w-[360px]">
                      <Link href={`/changes/templates/${t.id}`} className="block">
                        <span className="line-clamp-1 font-medium group-hover:text-primary">{t.name}</span>
                        {t.summary ? <span className="line-clamp-1 text-xs text-muted-foreground">{t.summary}</span> : null}
                      </Link>
                    </TableCell>
                    <TableCell><StatusBadge map={CHANGE_TYPE_META} value={t.type} dot /></TableCell>
                    <TableCell><StatusBadge map={RISK_META} value={t.risk} dot /></TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{t.service?.name ?? "—"}</TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{t.group?.name ?? "—"}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums text-muted-foreground">{t._count.changes}</TableCell>
                    <TableCell><ToneBadge meta={t.isActive ? ACTIVE_META : OFF_META} dot /></TableCell>
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
