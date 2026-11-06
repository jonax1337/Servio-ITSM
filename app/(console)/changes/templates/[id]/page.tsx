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

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const template = await db.changeTemplate.findUnique({ where: { id }, select: { name: true } });
  return { title: template?.name ?? "Change template" };
}

export default async function ChangeTemplateDetailPage({ params }: { params: Params }) {
  await requireRole("MANAGER");
  const { id } = await params;
  const [template, options] = await Promise.all([
    db.changeTemplate.findUnique({ where: { id }, include: { _count: { select: { changes: true } } } }),
    getFormOptions(),
  ]);
  if (!template) notFound();

  return (
    <>
      <PageHeader
        icon={FileStack}
        title={template.name}
        description={`Used for ${template._count.changes} change${template._count.changes === 1 ? "" : "s"}.`}
      >
        <LinkButton href="/changes/templates" variant="outline">
          <ArrowLeft className="size-4" /> Templates
        </LinkButton>
        {template.isActive ? (
          <LinkButton href={`/changes/new?template=${template.id}`} variant="outline">
            <GitPullRequestArrow className="size-4" /> New change from template
          </LinkButton>
        ) : null}
        <ConfirmButton
          action={deleteChangeTemplate}
          fields={{ id: template.id }}
          title={`Delete “${template.name}”?`}
          description="Changes already created from it keep their content; they just lose the link to the template."
          triggerVariant="outline"
          triggerSize="default"
        >
          <Trash2 className="size-4" /> Delete
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
