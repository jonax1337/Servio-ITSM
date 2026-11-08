import type { Metadata } from "next";
import { GitPullRequestArrow } from "lucide-react";
import { db } from "@/lib/db";
import { getFormOptions } from "@/lib/data/options";
import { getParam, type SearchParams } from "@/lib/query";
import { hasRole, requireUser } from "@/lib/session";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ChangeForm } from "@/components/changes/change-form";
import { TemplatePicker, type PickableTemplate } from "@/components/changes/templates/template-picker";
import type { CustomFieldDef } from "@/lib/custom-fields";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("changes");
  return { title: t("new.title") };
}
export const dynamic = "force-dynamic";

export default async function NewChangePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const me = await requireUser();
  const t = await getT("changes");
  const [options, customFieldDefs, templates] = await Promise.all([
    getFormOptions(),
    db.customFieldDef.findMany({
      where: { entityType: "CHANGE", active: true },
      orderBy: { order: "asc" },
    }),
    db.changeTemplate.findMany({
      where: { isActive: true },
      include: { service: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
  ]);

  const templateId = getParam(sp, "template");
  const template = templates.find((t) => t.id === templateId);
  const pickable: PickableTemplate[] = templates.map((t) => ({
    id: t.id,
    name: t.name,
    summary: t.summary,
    type: t.type,
    serviceName: t.service?.name ?? null,
  }));

  return (
    <>
      <PageHeader
        icon={GitPullRequestArrow}
        title={t("new.title")}
        description={t("new.description")}
      />
      <PageBody className="mx-auto grid max-w-3xl gap-4">
        <TemplatePicker
          templates={pickable}
          selected={pickable.find((t) => t.id === templateId)}
          canManage={hasRole(me.role, "MANAGER")}
        />
        <Card>
          <CardContent>
            <ChangeForm
              key={template?.id ?? "blank"}
              options={options}
              currentUserId={me.id}
              customFieldDefs={customFieldDefs as CustomFieldDef[]}
              template={template}
            />
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
