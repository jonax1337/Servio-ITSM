import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, FileStack, GitPullRequestArrow, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { getFormOptions } from "@/lib/data/options";
import { requireRole } from "@/lib/session";
import { deleteChangeTemplate } from "@/lib/actions/change-templates";
import { PageHeader, PageBody } from "@/components/page-header";
import { LinkButton } from "@/components/link-button";
import { ConfirmButton } from "@/components/confirm-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { TemplateForm } from "@/components/changes/templates/template-form";
import { getT } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const template = await db.changeTemplate.findUnique({ where: { id }, select: { name: true } });
  if (template) return { title: template.name };
  const t = await getT("changes");
  return { title: t("templates.fallbackTitle") };
}

export default async function ChangeTemplateDetailPage({ params }: { params: Params }) {
  await requireRole("MANAGER");
  const { id } = await params;
  const [template, options] = await Promise.all([
    db.changeTemplate.findUnique({ where: { id }, include: { _count: { select: { changes: true } } } }),
    getFormOptions(),
  ]);
  if (!template) notFound();
  const [t, tc] = await Promise.all([getT("changes"), getT("common")]);

  return (
    <>
      <PageHeader
        icon={FileStack}
        title={template.name}
        description={t("templates.usedFor", { count: template._count.changes })}
      >
        <LinkButton href="/changes/templates" variant="outline">
          <ArrowLeft className="size-4" /> {t("list.templates")}
        </LinkButton>
        {template.isActive ? (
          <LinkButton href={`/changes/new?template=${template.id}`} variant="outline">
            <GitPullRequestArrow className="size-4" /> {t("templates.newChange")}
          </LinkButton>
        ) : null}
        <ConfirmButton
          action={deleteChangeTemplate}
          fields={{ id: template.id }}
          title={t("templates.deleteTitle", { name: template.name })}
          description={t("templates.deleteDescription")}
          triggerVariant="outline"
          triggerSize="default"
        >
          <Trash2 className="size-4" /> {tc("delete")}
        </ConfirmButton>
      </PageHeader>
      <PageBody>
        <Card className="mx-auto max-w-3xl">
          <CardContent>
            <TemplateForm options={options} template={template} />
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
