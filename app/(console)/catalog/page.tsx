import type { Metadata } from "next";
import { ShoppingBag, Trash2, ShieldCheck, Clock } from "lucide-react";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";
import { PageHeader, PageBody } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ToneBadge } from "@/components/status-badge";
import { ConfirmButton } from "@/components/confirm-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { CatalogEditor } from "@/components/catalog/catalog-editor";
import { CatalogIcon } from "@/components/catalog/catalog-icon";
import { PublishToggle } from "@/components/catalog/publish-toggle";
import { ApprovalStagesEditor } from "./approval-stages-editor";
import { deleteCatalogItem } from "@/lib/actions/catalog-admin";
import { parseFormSchema, parseApprovalStages } from "@/lib/service-forms";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("catalog");
  return { title: t("title") };
}
export const dynamic = "force-dynamic";

export default async function CatalogAdminPage() {
  await requireRole("MANAGER");
  const [t, tc] = await Promise.all([getT("catalog"), getT("common")]);
  const [items, categories, services, agents, groups] = await Promise.all([
    db.catalogItem.findMany({ orderBy: [{ order: "asc" }, { name: "asc" }], include: { category: true, _count: { select: { tickets: true } } } }),
    db.category.findMany({ where: { archived: false }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.service.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { role: { in: ["ADMIN", "MANAGER", "AGENT"] }, isActive: true }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
    db.group.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  const catOpts = categories.map((c) => ({ value: c.id, label: c.name }));
  const serviceOpts = services.map((s) => ({ value: s.id, label: s.name }));
  const agentOpts = agents.map((a) => ({ value: a.id, label: a.name ?? a.email }));
  const groupOpts = groups.map((g) => ({ value: g.id, label: g.name }));

  return (
    <>
      <PageHeader
        icon={ShoppingBag}
        title={t("title")}
        description={t("description")}
      >
        <CatalogEditor categories={catOpts} services={serviceOpts} agents={agentOpts} />
      </PageHeader>

      <PageBody className="grid gap-3">
        {items.length === 0 ? (
          <EmptyState icon={ShoppingBag} title={t("emptyTitle")} description={t("emptyDescription")}>
            <CatalogEditor categories={catOpts} services={serviceOpts} agents={agentOpts} />
          </EmptyState>
        ) : (
          items.map((it) => (
            <Card key={it.id}>
              <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="grid size-7 place-items-center rounded-md bg-primary/10 text-primary">
                      <CatalogIcon name={it.icon} className="size-4" />
                    </span>
                    <span className="font-medium">{it.name}</span>
                    {it.category ? <ToneBadge meta={{ label: it.category.name, tone: "indigo" }} icon={false} /> : null}
                    {it.requiresApproval ? <ToneBadge meta={{ label: t("approvalBadge"), tone: "warning" }} icon={false} /> : null}
                    {parseApprovalStages(it.approvalStages).length > 1 ? (
                      <ToneBadge meta={{ label: t("stagesBadge", { count: parseApprovalStages(it.approvalStages).length }), tone: "indigo" }} icon={false} />
                    ) : null}
                    {!it.isPublished ? <ToneBadge meta={{ label: t("unpublished"), tone: "neutral" }} icon={false} /> : null}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{it.shortDescription ?? it.description ?? "—"}</p>
                  <p className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{t("formFields", { count: parseFormSchema(it.formSchema).length })}</span>
                    {it.estimatedDays != null ? <span className="flex items-center gap-1"><Clock className="size-3" /> {t("estimatedDays", { count: it.estimatedDays })}</span> : null}
                    {it.requiresApproval ? <span className="flex items-center gap-1"><ShieldCheck className="size-3" /> {t("needsApproval")}</span> : null}
                    <span>{t("requests", { count: it._count.tickets })}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <PublishToggle id={it.id} published={it.isPublished} />
                  <ApprovalStagesEditor
                    itemId={it.id}
                    itemName={it.name}
                    stages={parseApprovalStages(it.approvalStages)}
                    agents={agentOpts}
                    groups={groupOpts}
                  />
                  <CatalogEditor
                    categories={catOpts}
                    services={serviceOpts}
                    agents={agentOpts}
                    item={{
                      id: it.id, name: it.name, description: it.description, shortDescription: it.shortDescription,
                      icon: it.icon, categoryId: it.categoryId, serviceId: it.serviceId, estimatedDays: it.estimatedDays,
                      isPublished: it.isPublished, requiresApproval: it.requiresApproval, approverId: it.approverId,
                      fields: parseFormSchema(it.formSchema),
                    }}
                  />
                  <ConfirmButton
                    action={deleteCatalogItem}
                    fields={{ id: it.id }}
                    title={t("deleteTitle")}
                    description={t("deleteDescription", { name: it.name })}
                    confirmLabel={t("deleteItem")}
                    triggerVariant="ghost"
                    triggerLabel={tc("delete")}
                  >
                    <Trash2 className="size-4 text-muted-foreground" />
                  </ConfirmButton>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </PageBody>
    </>
  );
}
