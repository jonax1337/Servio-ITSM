import type { Metadata } from "next";
import { FileStack } from "lucide-react";
import { getFormOptions } from "@/lib/data/options";
import { requireRole } from "@/lib/session";
import { PageHeader, PageBody } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { TemplateForm } from "@/components/changes/templates/template-form";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("changes");
  return { title: t("templates.newTitle") };
}
export const dynamic = "force-dynamic";

export default async function NewChangeTemplatePage() {
  await requireRole("MANAGER");
  const [options, t] = await Promise.all([getFormOptions(), getT("changes")]);

  return (
    <>
      <PageHeader
        icon={FileStack}
        title={t("templates.newTitle")}
        description={t("templates.newDescription")}
      />
      <PageBody>
        <Card className="mx-auto max-w-3xl">
          <CardContent>
            <TemplateForm options={options} />
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
